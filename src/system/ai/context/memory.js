import { memories } from '../../db/index.js';
import { takeTopWithin } from '../tokens.js';
import { dot, embedReady } from '../embed.js';
import { rankQueued, rerankReady } from '../rerank.js';
import { rootIdOf } from '../../accounts.js';
import * as bond from '../../bond.js';

export const CATEGORIES = {
  fact: '事实', emotion: '情绪', pending: '待办',
  pattern: '模式', relation: '关系', profile: '画像',
};
export const RANKS = ['S', 'A', 'B', 'C'];

// 记忆挂在角色身上，不再分全局 / 会话（见 schema 迁移 3）。
// charId 留空的是老数据，对所有角色都生效。
export const belongsTo = (m, charId) => !m.charId || m.charId === charId;

// personaId 决定一条记忆属于谁。规则：
//  - 不同根账号之间完全隔离，一条都不给
//  - 同一个根下面，大号的记忆对小号也可见（角色还是同一个角色，它记得那些事），
//    但会被标成「关于某某」，而不是「关于你现在在聊的这个人」
export function listFor(charId, personaId) {
  const root = personaId ? rootIdOf(personaId) : null;
  return memories.where(m => {
    if (!belongsTo(m, charId)) return false;
    if (!root) return true;                       // 没给身份就不过滤，给调用方兜底
    if (!m.personaId) return true;                // 迁移前的老记忆，当作大号的
    return rootIdOf(m.personaId) === root;
  });
}

// 记忆一律原样注入，不标「这条是关于谁的」。
// 试过标，结果适得其反：一旦点名大号，模型就开始琢磨眼前这人是不是大号。
// 记忆内容本来就是第三人称、带着名字的（「阿园喜欢…」），
// 谁是谁靠内容自己说清楚，比外加一个标签可靠。

// 向量检索：S 级照旧钉死（身份级的事实，不该由相似度决定进不进），
// 剩下的预算交给语义相似度挑。关键词命中的直接算满分并进。
// queryVec 由 build() 提前算好传进来 —— 这一层是同步的，不能在这里发请求。
/**
 * 按相似度排好序的候选，**不套预算也不截断到最终条数**。
 * 重排要的是一批候选，不是已经挑完的结果，所以单拎出来。
 */
export function vectorPool(charId, scanText, queryVec, opts = {}) {
  const personaId = opts.personaId || null;
  const floor = typeof opts.threshold === 'number' ? opts.threshold : 0.22;
  const text = String(scanText || '').toLowerCase();

  // S 级不再逐条召回 —— 它们已经压进关系底色常驻了（见 bond.js）。
  // 从前 S 级是每轮钉死全量注入的，于是随口问一句今天吃什么，
  // 满眼也都是那几件大事。
  const all = listFor(charId, personaId).filter(m => m.rank !== 'S');

  const scored = all.map(m => {
    const kws = (m.keywords || []).filter(Boolean);
    const hit = kws.length > 0 && kws.some(k => text.includes(String(k).toLowerCase()));
    const sim = m.vec?.length ? dot(queryVec, m.vec) : -1;
    // 关键词命中是明确信号，不要被相似度压下去
    return { m, score: hit ? Math.max(1, sim) : sim, hit };
  }).filter(x => x.hit || x.score >= floor);

  scored.sort((a, b) => b.score - a.score);
  const limit = opts.limit > 0 ? opts.limit : Infinity;   // 0 = 全都要
  return (limit === Infinity ? scored : scored.slice(0, limit)).map(x => x.m);
}

export function selectByVector(charId, scanText, budget, queryVec, opts = {}) {
  const pool = vectorPool(charId, scanText, queryVec, {
    ...opts, limit: opts.topK > 0 ? opts.topK : 0,
  });
  return takeTopWithin(pool, budget, lineOf);
}

// S/A 全注入; B 在扫描窗口里命中关键词才进; C 只存档不注入
// 没有向量接口时的退路。同样不收 S 级
export function select(charId, scanText, budget, personaId) {
  const text = String(scanText || '').toLowerCase();
  const pool = listFor(charId, personaId).filter(m => {
    if (m.rank === 'A') return true;
    if (m.rank !== 'B') return false;
    const kws = (m.keywords || []).filter(Boolean);
    return kws.length > 0 && kws.some(k => text.includes(String(k).toLowerCase()));
  });

  const weight = { A: 1, B: 2 };
  pool.sort((a, b) =>
    (weight[a.rank] ?? 3) - (weight[b.rank] ?? 3)
    || (b.updatedAt || 0) - (a.updatedAt || 0));

  return takeTopWithin(pool, budget, lineOf);
}

// 召回那一段的定位是**候选**，不是必须用上的事实。
//
// 从前的抬头写着「请自然地运用这些信息」—— 那是在命令模型用上它们，
// 于是每一条召回噪音都被硬塞进回复。检索精度再调也治不好这个：
// 检索本来就不可能完美，能改的是检索结果的定位。
const HEAD = `[相关记忆]
The following are your relevant memories, ordered by relevance, for reference.
When none of them fits the present situation, disregard this section.`;

// 写给模型看的标签用类别 id。原先是 [S/事实] —— S 对模型没有任何含义，
// 它不知道 S 比 A 重要在哪儿、该怎么用。类别 id 与 task.memory-* 里列的那六个
// 名字是同一套，两边对得上。
const LABEL = m => (CATEGORIES[m.category] ? m.category : (m.category || 'memory'));

/**
 * 这条记忆是什么时候的事。
 *
 * 召回从前只给类别和正文。一条三个月前的事和昨天的事长得一模一样，
 * 模型没法分先后，也没法知道「她说她在准备考试」是不是早就过去了。
 * 日期是客观事实，不是替它作判断（第 16 条），该给。
 *
 * 用本地时区手工拼，不走 toISOString —— 那是 UTC，晚上记的事会串到前一天。
 */
export function dayOf(m) {
  const t = Number(m?.createdAt) || 0;
  if (!t) return '';
  const d = new Date(t);
  const two = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export const lineOf = m => {
  const day = dayOf(m);
  return `【${LABEL(m)}${day ? ' ' + day : ''}】${m.content}`;
};

/**
 * 这一轮召回哪几条。S 级不再逐条进来 —— 它们已经压进关系底色了（见 bond.js）。
 * 排序就是相关度从高到低，最相关的在最上面。
 */
export function recall(ctx) {
  const { settings, char, scanText, budgets, queryVec, persona } = ctx;
  if (!settings.memoryEnabled) return [];
  const personaId = persona?.id || null;
  const useVec = settings.memoryVector === true && embedReady() && queryVec?.length;
  const { items } = useVec
    ? selectByVector(char?.id, scanText, budgets.memory, queryVec, {
      personaId,
      topK: settings.memoryTopK,
      threshold: typeof settings.memoryThreshold === 'number' ? settings.memoryThreshold : 0.22,
    })
    : select(char?.id, scanText, budgets.memory, personaId);
  return items;
}

/**
 * 带重排的那一档。默认关着，关着就是原样走 recall。
 *
 * 顺序是：向量粗筛一批候选 -> 重排模型按相关度重排 -> 再套上下文预算。
 * 粗筛那一步要放宽（候选条数由用户填），不然重排只能在已经挑剩的几条里
 * 分高下，等于白花一次请求。
 *
 * 重排挂了就退回纯向量那一档 —— 排不出名次不该让这一轮发不出去。
 */
export async function recallAsync(ctx) {
  const s = ctx.settings || {};
  const useVec = s.memoryVector === true && embedReady() && ctx.queryVec?.length;
  if (!useVec || s.rerankOn !== true || !rerankReady()) return recall(ctx);

  const pool = vectorPool(ctx.char?.id, ctx.scanText, ctx.queryVec, {
    personaId: ctx.persona?.id || null,
    threshold: typeof s.memoryThreshold === 'number' ? s.memoryThreshold : 0.22,
    limit: Math.max(0, Math.round(Number(s.rerankCandidates) || 0)),
  });
  if (pool.length < 2) return recall(ctx);

  try {
    const topN = s.memoryTopK > 0 ? s.memoryTopK : 0;
    const order = await rankQueued(ctx.char?.id || 'x', ctx.scanText,
      pool.map(m => m.content || ''), { topN });
    const ranked = order.map(o => pool[o.index]).filter(Boolean);
    if (!ranked.length) return recall(ctx);
    return takeTopWithin(ranked, ctx.budgets.memory, lineOf).items;
  } catch (err) {
    console.warn('[rerank]', err.message || err);
    return recall(ctx);
  }
}

export const recallText = items =>
  (items && items.length ? `${HEAD}\n${items.map(lineOf).join('\n')}` : '');

// 深度。0 表示留在设定区，N ≥ 1 表示插进对话历史倒数第 N 条之前。
// 默认 1：召回是每轮都变的，放在最前面会让后面所有稳定内容的 prompt
// 缓存每轮作废；而且离当前对话越近，模型越不容易忽略它。
export const depthOf = s => {
  const n = Math.round(Number(s?.memoryDepth) ?? 1);
  return Number.isFinite(n) && n >= 0 ? n : 1;
};

// 设定区里的那一份。深度大于 0 时这里不出东西，改由 buildHistory 插进对话。
export function build(ctx) {
  if (depthOf(ctx.settings) > 0) return '';
  const items = ctx.recall || recall(ctx);
  const text = recallText(items);
  return text ? '\n\n' + text : '';
}

export const meta = {
  id: 'memory', label: '本轮相关记忆',
  desc: '按相关度召回的条目。默认插在对话末尾附近，不在设定区',
};

// ---- 关系底色 ----
//
// 常驻的那一层。它不随每一轮变化，所以留在设定区，位置由注入顺序决定。

export function buildBond(ctx) {
  const text = bond.textOf(ctx.char, ctx.persona?.id);
  return text ? `\n\n[你们之间的关系]\n${text}` : '';
}

export const metaBond = {
  id: 'bond', label: '关系底色',
  desc: '由关系转折级记忆压成的几句现状，常驻',
};
