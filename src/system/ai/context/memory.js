import { memories } from '../../db/index.js';
import { takeTopWithin } from '../tokens.js';
import { dot, embedReady } from '../embed.js';
import { rankQueued, rerankReady } from '../rerank.js';
import { rootIdOf } from '../../accounts.js';
import { gramsOf, idfOf, sim as textSim, covers } from '../../textsim.js';
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

/**
 * 这件事离现在多久。
 *
 * 召回从前只给一个裸日期，「多久以前」要模型自己算 —— 而日期相减和
 * 距离、点数、金额一样不是模型的活（第 16 条），算错了它也不知道。
 * 算好摆进去，它就不会把半年前的事说成前几天。
 */
export function agoText(m, now = Date.now()) {
  const t = Number(m?.createdAt) || 0;
  if (!t) return '';
  const days = Math.floor((now - t) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const y = Math.round(days / 365);
  return y <= 1 ? 'about a year ago' : `${y} years ago`;
}

/**
 * 一条记忆写成一行。
 *
 * 从前是 `【fact 2026-03-01】正文`。类别 id 那一段是白给的 —— 模型不知道
 * 拿 pattern 该怎么办，它占位置却不改变任何行为。现在类别改成分栏（见
 * recallText），行里只留日期与「多久以前」这两样看得懂的。
 */
export const lineOf = m => {
  const day = dayOf(m);
  const ago = agoText(m);
  const when = day ? `${day}${ago ? ` (${ago})` : ''} ` : '';
  return `- ${when}${m.content}`;
};

// ---- 综合打分 ----
//
// 从前挑记忆只看一个维度：这条与最近几句话像不像。人脑不是这么取记忆的。
// 下面这几项各算一份，加权求和 —— 全部本地算，一次接口都不多打。
//
//   线索    与当前这几句话的关联。三路取最大：字面命中关键词、向量相似度
//           （配了才有）、本地二元组相似度（零成本那一档，见 textsim.js）
//   新近    离现在多久。半衰期衰减，锚点取「记下来」与「上次被想起」里更近的
//   强度    被想起过多少次。取对数 —— 线性会正反馈成死循环，老出现的越来越
//           容易出现
//   分量    这件事当时的情绪强度。提取时给的 weight，没有就按类别与等级估
//   未了结  还没兑现的约定、还没有结果的事。人对未竟之事就是记得更牢
//   时段    与记下来时是同一个时段。深夜更容易想起深夜说过的话
//   手写    自己动手加的那条，比自动提取的可信
//   最早    这段关系最开头的那几条。第一次见面、第一次说喜欢，地位本来就特殊
//   疲劳    刚刚几轮里已经注入过的，这一轮压下去。不会连着五轮翻同一件事
//
// **权重给了默认值，也都能改**（第 13 条）。不给旋钮的话，「她更该记得
// 什么」这件事就成了我替用户定的。
export const WEIGHTS = {
  cue: 1, recent: 0.35, strength: 0.25, weight: 0.3, open: 0.5,
  slot: 0.15, manual: 0.2, first: 0.15, fatigue: 0.6,
};

// 新近度的半衰期（天）与疲劳的冷却（分钟）
const HALF_LIFE = 45;
const COOLDOWN = 20;
// 本地那一档的线索门槛。低到只挡完全不沾边的，剩下的交给排序
const LOCAL_FLOOR = 0.04;

const weightsOf = s => ({ ...WEIGHTS, ...(s?.memoryWeights || {}) });

// 没有 weight 字段的老数据按类别与等级估一个。情绪与关系那两类天生分量重
const RANK_W = { S: 2, A: 1.2, B: 0.8, C: 0.4 };
const CAT_W = { emotion: 1.4, relation: 1.4, pending: 1.2, fact: 1, profile: 1, pattern: 0.8 };
export function weightOf(m) {
  const w = Number(m?.weight);
  if (Number.isFinite(w) && w > 0) return Math.min(2, w);
  return Math.min(2, (RANK_W[m?.rank] ?? 1) * (CAT_W[m?.category] ?? 1) / 1.2);
}

export const isOpen = m => m?.category === 'pending' && !/已完结/.test(m?.content || '');

const hourOf = t => (t ? new Date(t).getHours() : -1);

/**
 * 一条记忆这一轮值多少分。回来的 parts 是给「召回解释」看的 ——
 * 调不出好结果的时候，要能看见是哪一项把它顶上来或压下去的。
 */
export function scoreOf(m, ctx) {
  const { now = Date.now(), text = '', queryVec = null, idf = null, grams = null, w } = ctx;
  const kws = (m.keywords || []).filter(Boolean);
  const hit = kws.length > 0 && kws.some(k => text.includes(String(k).toLowerCase()));
  const vec = queryVec && m.vec?.length ? Math.max(0, dot(queryVec, m.vec)) : 0;
  const bi = grams ? covers(gramsOf(m.content || ''), grams, idf) : 0;
  const cue = Math.max(hit ? 1 : 0, vec, bi);

  const touched = Math.max(Number(m.createdAt) || 0, Number(m.lastUsedAt) || 0);
  const days = touched ? Math.max(0, (now - touched) / 86400000) : 999;
  const recent = 2 ** (-days / HALF_LIFE);

  const used = Math.max(0, Number(m.useCount) || 0);
  const strength = Math.log1p(used) / Math.log1p(10);

  const since = m.lastUsedAt ? (now - Number(m.lastUsedAt)) / 60000 : Infinity;
  const fatigue = since < COOLDOWN ? 1 - since / COOLDOWN : 0;

  const h1 = hourOf(m.createdAt);
  const h2 = hourOf(now);
  const slot = h1 >= 0 ? (Math.min(Math.abs(h1 - h2), 24 - Math.abs(h1 - h2)) <= 2 ? 1 : 0) : 0;

  const parts = {
    cue, recent, strength,
    weight: weightOf(m) / 2,
    open: isOpen(m) ? 1 : 0,
    slot,
    manual: m.source === 'manual' ? 1 : 0,
    first: m.early ? 1 : 0,
    fatigue,
  };
  const total = Object.keys(parts).reduce(
    (n, k) => n + parts[k] * (k === 'fatigue' ? -w[k] : w[k]), 0);
  return { total, parts, cue };
}

/**
 * 候选池。**两条来路。**
 *
 * 一条是线索命中的 —— 这是从前唯一的一条。另一条是「不需要谁提起也该
 * 上场的」：还没了结的事、钉住的那几条。人想起一件事，常常不是因为
 * 对方刚好提到了它。
 */
function poolFor(charId, personaId, ctx) {
  const all = listFor(charId, personaId).filter(m => m.rank !== 'S' && !m.supersededBy);
  // 这段关系最早的那几条，给一点永久加成
  const early = new Set(all.slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(0, 5).map(m => m.id));
  const floor = ctx.floor;
  const out = [];
  for (const m of all) {
    const row = early.has(m.id) ? { ...m, early: true } : m;
    const s = scoreOf(row, ctx);
    if (s.cue >= floor || isOpen(m) || m.pinned) out.push({ m: row, ...s });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

/**
 * 同一件事只出一条。
 *
 * **去冗余就是去矛盾**：互相打架的两条几乎必然在说同一件事，也就是
 * 字面高度接近，一定落在同一簇里。挑分高的那条出来，另一条留在库里。
 */
function dedupe(rows, limit) {
  const out = [];
  for (const r of rows) {
    const g = gramsOf(r.m.content || '');
    if (out.some(x => textSim(g, gramsOf(x.m.content || '')) >= limit)) {
      r.dropped = 'same';
      continue;
    }
    out.push(r);
  }
  return out;
}

// 上一轮召回的账。给「召回解释」那一页看，不进 prompt。
//
// 用函数取，不直接导出变量：sdk 那一层是 `{ ...memoryCtx }` 摊平进去的，
// 摊的那一下就把值定死了，后面再怎么变外面也看不见。
let last = null;
export const lastRecall = () => last;

/** 这一轮的候选与打分上下文。recall 与带重排的那一档共用。 */
export function candidates(ctx) {
  const { settings, char, scanText, queryVec, persona } = ctx;
  const personaId = persona?.id || null;
  const useVec = settings.memoryVector === true && embedReady() && queryVec?.length;
  const all = listFor(char?.id, personaId);
  const sctx = {
    now: Date.now(),
    text: String(scanText || '').toLowerCase(),
    queryVec: useVec ? queryVec : null,
    grams: gramsOf(scanText || ''),
    idf: idfOf(all.map(m => m.content || '')),
    // 两档的门槛不是一个量级：向量那档是余弦相似度，本地这档是「这条记忆
    // 有多少字落在刚才那段话里」，后者天生小得多（对上两三个字就算有关系）。
    // 本地档主要靠排序挑，门槛只负责把八竿子打不着的挡在池子外面
    floor: useVec
      ? (typeof settings.memoryThreshold === 'number' ? settings.memoryThreshold : 0.22)
      : LOCAL_FLOOR,
    w: weightsOf(settings),
    mode: useVec ? 'vector' : 'local',
  };
  return { rows: poolFor(char?.id, personaId, sctx), sctx };
}

// 记一笔这一轮的账，给「召回解释」那一页看。不进 prompt。
function note(ctx, sctx, rows, items, mode) {
  const chosen = new Set(items.map(m => m.id));
  last = {
    at: Date.now(), charId: ctx.char?.id || '',
    scanText: String(ctx.scanText || '').slice(0, 200),
    mode: mode || sctx.mode, weights: sctx.w, total: rows.length,
    rows: rows.slice(0, 30).map(x => ({
      id: x.m.id, content: x.m.content, score: x.total, parts: x.parts,
      used: chosen.has(x.m.id), dropped: x.dropped || '',
    })),
  };
}

/**
 * 这一轮召回哪几条。S 级不再逐条进来 —— 它们已经压进关系底色了（见 bond.js）。
 */
export function recall(ctx) {
  const { settings, budgets } = ctx;
  if (!settings.memoryEnabled) return [];
  const { rows, sctx } = candidates(ctx);
  const kept = dedupe(rows, 0.55);
  const n = Math.max(0, Math.round(Number(settings.memoryTopK) || 0));
  const picked = n ? kept.slice(0, n) : kept;
  const { items } = takeTopWithin(picked.map(x => x.m), budgets.memory, lineOf);
  note(ctx, sctx, rows, items);
  return items;
}

/**
 * 带重排的那一档。默认关着，关着就是原样走 recall。
 *
 * 顺序是：本地打分出一批候选 -> 重排模型按相关度重排 -> 去冗余 -> 套预算。
 * 粗筛那一步要放宽（候选条数由用户填），不然重排只能在已经挑剩的几条里
 * 分高下，等于白花一次请求。
 *
 * 重排挂了就退回本地那一档 —— 排不出名次不该让这一轮发不出去。
 */
export async function recallAsync(ctx) {
  const s = ctx.settings || {};
  if (!s.memoryEnabled) return [];
  if (s.rerankOn !== true || !rerankReady()) return recall(ctx);

  const { rows, sctx } = candidates(ctx);
  const cap = Math.max(0, Math.round(Number(s.rerankCandidates) || 0));
  const pool = (cap ? rows.slice(0, cap) : rows).map(x => x.m);
  if (pool.length < 2) return recall(ctx);

  try {
    const topN = s.memoryTopK > 0 ? s.memoryTopK : 0;
    const order = await rankQueued(ctx.char?.id || 'x', ctx.scanText,
      pool.map(m => m.content || ''), { topN });
    const ranked = order.map(o => pool[o.index]).filter(Boolean);
    if (!ranked.length) return recall(ctx);
    // 重排只管相关度，去冗余那一步照样要走 —— 打架的两条它一样会都留着
    const kept = dedupe(ranked.map(m => ({ m })), 0.55).map(x => x.m);
    const { items } = takeTopWithin(kept, ctx.budgets.memory, lineOf);
    note(ctx, sctx, rows, items, 'rerank');
    return items;
  } catch (err) {
    console.warn('[rerank]', err.message || err);
    return recall(ctx);
  }
}

// 召回那一段的定位是**候选**，不是必须用上的事实。
//
// 从前的抬头写着「请自然地运用这些信息」—— 那是在命令模型用上它们，
// 于是每一条召回噪音都被硬塞进回复。检索精度再调也治不好这个：
// 检索本来就不可能完美，能改的是检索结果的定位。
//
// 「冲突时以日期新的为准」是**解析规则**，不是替角色作判断（第 16 条）：
// 同一件事有两种说法时按哪一条算，依据的是日期这个客观事实。
// 不写这一句，两条打架的记忆一起进来，模型只能瞎猜，或者两句都顺着说。
const HEAD = `[相关记忆]
Notes that may bear on the present conversation, for reference. Ignore any that
do not fit. Where two entries conflict, the one with the later date is current.`;

// 按**客观性质**分三栏，不按相关度平铺。
//
// 十二行长得一模一样地摊在那里，模型看到的是十二条平级事实，只能平均用力。
// 分栏本身就是轻重：没了结的事天然最先被注意到（人对未竟之事就是这样）。
//
// **这不是替角色排优先级。** 第 16 条删掉过的那一段「冲突时的取舍」排的是
// 人设 > 世界设定 > 其余，那是替用户决定他自己写的几份设定谁让谁；
// 这里分的是同一批记忆按它们自身的性质归栏，栏目名都是事实陈述。
const GROUPS = [
  { id: 'open', head: 'Still unresolved:', has: isOpen },
  { id: 'stable', head: 'Always true:', has: m => ['fact', 'profile', 'pattern'].includes(m.category) },
  { id: 'past', head: 'That happened:', has: () => true },
];

export function recallText(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  const rest = list.slice();
  const out = [];
  for (const g of GROUPS) {
    const mine = [];
    for (let i = rest.length - 1; i >= 0; i--) {
      if (g.has(rest[i])) mine.unshift(rest.splice(i, 1)[0]);
    }
    if (mine.length) out.push(`${g.head}\n${mine.map(lineOf).join('\n')}`);
  }
  return `${HEAD}\n\n${out.join('\n\n')}`;
}

/**
 * 这几条真的被送出去了，记一笔。
 *
 * 两处要用：**强度**（被想起过越多次越容易再想起，这是提取练习效应）
 * 与**疲劳**（刚翻出来过的，接下来几轮压下去，不会连着五轮说同一件事）。
 * 从前一笔都不记，所以同样那几条会一轮一轮重复注入，而三个月前那条
 * 永远轮不到。
 *
 * 只在请求真的发出去之后叫 —— 拼好了又没发成不算想起过。
 */
export function markRecalled(items) {
  const at = Date.now();
  (items || []).forEach(m => {
    const row = memories.get(m.id);
    if (row) memories.update(m.id, { useCount: (Number(row.useCount) || 0) + 1, lastUsedAt: at });
  });
}

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
