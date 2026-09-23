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
//
// chatId：只在某个群里生效的记忆（`scopeChat`，群自己的开关关着时记下的）
// 只在那个群里拿得到。不给 chatId 就一律不给 —— 私聊、朋友圈、日程这些
// 地方都不该知道「只留在群里」的事（见 ARCHITECTURE 4.162）。
export const inScope = (m, chatId) => !m.scopeChat || m.scopeChat === chatId;

export function listFor(charId, personaId, chatId = '') {
  const root = personaId ? rootIdOf(personaId) : null;
  return memories.where(m => {
    if (!belongsTo(m, charId)) return false;
    if (!inScope(m, chatId)) return false;
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
  // 挂了日子的待办，把那一天也写上：这件事什么时候到，是客观事实
  const due = m.dueAt ? ` (due ${m.dueAt})` : '';
  return `- ${when}${m.content}${due}`;
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

/**
 * 还没了结的事。
 *
 * 挂了日子的，**过了那一天就不再算**。一条「下周三面试」放到三个月后
 * 还每轮往上顶，角色问一句「面试准备得怎么样」就露馅了。过期的改由
 * 「记忆体检」那一页提出来等人复查（标已完结，或者改个日子）。
 */
export const DUE_GRACE = 3;
export function isOpen(m, now = Date.now()) {
  if (m?.category !== 'pending' || /已完结/.test(m?.content || '')) return false;
  const due = dueTime(m);
  return !due || now <= due + DUE_GRACE * 86400000;
}

/** 挂的那个日子。按当天结束算 —— 「周三」那天当天不算过期。 */
export function dueTime(m) {
  const d = String(m?.dueAt || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0;
  const t = new Date(`${d}T23:59:59`).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * 过了期还没了结的那几条。体检页列出来等人处理。
 *
 * charId 留空表示不挑角色，全都要 —— listFor 的空值语义是「只要没绑角色的
 * 那些老数据」，正好相反，所以这里不走它。
 */
export const overdue = (charId = '') =>
  memories.where(m => m.category === 'pending'
    && (!charId || !m.charId || m.charId === charId)
    && !m.supersededBy && !/已完结/.test(m.content || '')
    && dueTime(m) && Date.now() > dueTime(m) + DUE_GRACE * 86400000);

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
  // 钉住的、忌讳的、近期那一档都已经常驻了，不再来挤这几个名额。
  // 不排除的话它们占两份位置，而召回本来就只有几个名额
  const skip = ctx.skip instanceof Set ? ctx.skip : null;
  const all = listFor(charId, personaId, ctx.chat?.id)
    .filter(m => m.rank !== 'S' && !m.supersededBy && !m.pinned && !m.taboo
      && !(skip && skip.has(m.id)));
  // 这段关系最早的那几条，给一点永久加成
  const early = new Set(all.slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(0, 5).map(m => m.id));
  const floor = ctx.floor;
  const out = [];
  for (const m of all) {
    const row = early.has(m.id) ? { ...m, early: true } : m;
    const s = scoreOf(row, ctx);
    if (s.cue >= floor || isOpen(m)) out.push({ m: row, ...s });
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
  const { settings, char, scanText, queryVec, persona, skip } = ctx;
  const personaId = persona?.id || null;
  const useVec = settings.memoryVector === true && embedReady() && queryVec?.length;
  const all = listFor(char?.id, personaId, ctx.chat?.id);
  const sctx = {
    chat: ctx.chat || null,
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
    // 近期那一档已经常驻了，别再挑同样几条来占名额
    skip: skip instanceof Set ? skip : null,
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
/**
 * 保底名额。
 *
 * 光按分数挑会有两种偏食：
 *
 *   **稳定事实分普遍更高**（新近、强度都占优），于是「她是什么样的人」
 *   把「那天发生了什么」全挤掉。可人说话时正是靠后者点睛 ——
 *   「你上次说你怕打雷」比「你是个怕打雷的人」动人得多。
 *
 *   **关于她的比关于你的多**（对话里她说得多），于是角色永远在讲自己。
 *   而恋爱里最动人的一下，是她记得你的事。
 *
 * 所以各留一个名额：挑完之后要是一条都没有，就把分最低的那条换下来。
 */
const EPISODIC = new Set(['emotion', 'relation', 'pending']);
function quota(picked, pool, n) {
  if (!n || picked.length < n) return picked;
  const out = picked.slice();
  const want = [
    { has: r => EPISODIC.has(r.m.category), pick: r => EPISODIC.has(r.m.category) },
    { has: r => r.m.about === 'user', pick: r => r.m.about === 'user' },
  ];
  for (const q of want) {
    if (out.some(q.has)) continue;
    const cand = pool.find(r => q.pick(r) && !out.includes(r));
    if (!cand) continue;
    // 换下分最低、而且不是另一个保底名额占着的那一条
    for (let i = out.length - 1; i >= 0; i--) {
      if (want.some(o => o !== q && o.has(out[i]) && out.filter(o.has).length === 1)) continue;
      out.splice(i, 1, cand);
      break;
    }
  }
  return out;
}

export function recall(ctx) {
  const { settings, budgets } = ctx;
  if (!settings.memoryEnabled) return [];
  const { rows, sctx } = candidates(ctx);
  const kept = dedupe(rows, 0.55);
  const n = Math.max(0, Math.round(Number(settings.memoryTopK) || 0));
  const picked = quota(n ? kept.slice(0, n) : kept, kept, n);
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

// ---- 一直记着的那几条 ----
//
// 关系底色只吃 S 级，而 S 级的定义明确排除了日常。于是「不要叫她全名」
// 「她怕黑」「十一点必须睡」这类全是 A 级，要靠每轮召回碰运气 ——
// **大事记得，小事一次次冒犯**，恋爱里最伤的恰恰是后者。
//
// 所以给一条别的路：任意一条记忆都可以钉住，钉住的常驻，不再去挤召回
// 那几个名额（poolFor 里把它们排除掉了，不然等于占两份）。
//
// 忌讳是同一层的另一半。**记得不要提，和记得一样重要** —— 前任、某次
// 吵架、某个她讨厌的称呼。这一段是用户自己钉的设定，不是内置提示词在
// 替角色作判断（第 16 条管的是后者）。

/** 钉住的与忌讳的。上限是默认值不是封顶，填 0 就是全都要（第 13 条）。 */
export function pinnedOf(charId, personaId, cap = 8, chatId = '') {
  const all = listFor(charId, personaId, chatId)
    .filter(m => !m.supersededBy && (m.pinned || m.taboo))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const n = Math.max(0, Math.round(Number(cap) || 0));
  const keep = n ? all.slice(0, n) : all;
  return {
    keep: keep.filter(m => !m.taboo),
    taboo: keep.filter(m => m.taboo),
    over: n ? Math.max(0, all.length - n) : 0,
  };
}

export function buildPinned(ctx) {
  const cap = ctx.settings?.pinnedMax;
  const { keep, taboo } = pinnedOf(ctx.char?.id, ctx.persona?.id,
    cap === undefined ? 8 : cap, ctx.chat?.id);
  if (!keep.length && !taboo.length) return '';
  const out = [];
  if (keep.length) out.push(keep.map(m => `- ${m.content}`).join('\n'));
  if (taboo.length) {
    out.push('Do not raise the following yourself. If the other party raises one,'
      + ' you may respond to it.\n'
      + taboo.map(m => `- ${m.content}`).join('\n'));
  }
  return `\n\n[一直记着]\n${out.join('\n\n')}`;
}

// ---- 最近记下的那几条 ----
//
// 召回的候选池只有两条来路：**线索命中的**，和**还没了结的**
//（见 poolFor）。昨天说了「一直在哭」，今天开口是「早」——
// 一个词都对不上，那条记忆连候选池都进不去。打分里那个 recent 因子
// 救不了它：候选池里没有它，分数无从谈起。
//
// 所以另开一档：**最近记下的这几条，不问相关不相关，一律带上。**
// 人对昨天的事本来就不需要谁提起。
//
// 它和另外三档各管各的：
//   关系底色  S 级压成的几句现状，讲的是「你们是什么关系」
//   一直记着  钉住的与忌讳的，用户自己指定，永久
//   最近记下  按时间取，不问内容，滚动更新
//   相关记忆  按这一轮的话去检索，命中才来

/** 最近记下的几条。上限是默认值不是封顶，填 0 就是不带（第 13 条）。 */
export function recentOf(charId, personaId, cap = 5, chatId = '') {
  const n = Math.max(0, Math.round(Number(cap) || 0));
  if (!n) return [];
  return listFor(charId, personaId, chatId)
    // S 级在关系底色里，钉住与忌讳在「一直记着」里，都不必再来一遍
    .filter(m => m.rank !== 'S' && !m.supersededBy && !m.pinned && !m.taboo)
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, n);
}

export function buildRecent(ctx) {
  if (!ctx.settings?.memoryEnabled) return '';
  const cap = ctx.settings?.memoryRecent;
  const rows = recentOf(ctx.char?.id, ctx.persona?.id, cap === undefined ? 5 : cap, ctx.chat?.id);
  if (!rows.length) return '';
  const now = ctx.now || Date.now();
  const lines = rows.map(m => `- ${agoText(m, now)}　${m.content}`);
  return `\n\n[最近记下的]\n${lines.join('\n')}\n`
    + 'These are the most recent things you noted about the two of you, '
    + 'newest first. They are here because they are recent, not because '
    + 'they bear on what was just said.';
}

export const metaRecent = {
  id: 'recent', label: '最近记下的',
  desc: '最近几条记忆，不问相关不相关一律带上。条数在「用量与上限」里，0 为不带',
};

export const metaPinned = {
  id: 'pinned', label: '一直记着',
  desc: '钉住的记忆与忌讳的话题，每轮常驻。在记忆条目上单独设置',
};

export const metaBond = {
  id: 'bond', label: '关系底色',
  desc: '由关系转折级记忆压成的几句现状，常驻',
};
