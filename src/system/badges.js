import { chats, characters, messagesOf } from './db/index.js';
import * as accounts from './accounts.js';
import { createStore } from './store.js';
import { notify } from './notify.js';
import * as group from './group.js';

/**
 * 互动标识。见 ARCHITECTURE 4.164
 *
 * **全部在本地按聊天记录算，一次接口都不调。** 连续互发、相识多久、说了多少、
 * 深夜聊了多少、通话与一起听的时长、隐藏成就、节日限定、亲密度等级、群里的周榜。
 *
 * ---- 存在哪儿 ----
 *
 * 统计存在会话自己身上（`chat.stats`），解锁过的存在 `chat.unlocked`、
 * 限定款存在 `chat.limited`、互相颁发的存在 `chat.awards`。不另开数据域：
 * 这些东西离了那段会话没有意义，挂在会话上，备份、删除、导出全跟着会话走。
 *
 * ---- 怎么算 ----
 *
 * **增量**。聊了两万条的会话，每次打开都从头数一遍会卡。`upTo` 记着算到哪条了，
 * 之后只看比它新的。第一次（或者点「重新统计」）才整段过一遍。
 * 删消息、改消息不回头改统计 —— 那是已经发生过的事；要对齐就重新统计。
 *
 * **不在渲染里算**。算完要写回会话，渲染里写库会引出一轮又一轮的重画。
 * 会话页在消息条数变化时、后台 tick 每一轮、拼提示词之前各同步一次，
 * 界面只读 `chat.stats`。
 *
 * ---- 一天怎么算 ----
 *
 * 按这台设备的本地日期。一天里你和对方都至少发过一条，这一天才算「互发」。
 * 提示行（notice）不算谁说的话；报错的那几条不算。
 */

// 统计格式改了就提一下版本号，旧的整段重算
const VERSION = 2;

const pad = n => String(n).padStart(2, '0');
/** 本地日期的天序号。跨时区出差时按当时设备所在的时区算，和人感觉到的「今天」一致 */
export const dayNo = t => {
  const d = new Date(t);
  return Math.floor((t - d.getTimezoneOffset() * 60000) / 86400000);
};
const mdOf = t => { const d = new Date(t); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** 「1998-03-12」「3月12日」「03/12」都认，认不出返回空 */
export function birthdayMd(raw) {
  const m = String(raw || '').match(/(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?\s*$/);
  if (!m) return '';
  const mo = Number(m[1]), d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${pad(mo)}-${pad(d)}` : '';
}

// ---- 标识表 ----
//
// 名字和说明都是界面文案（第 7 条：书面语）。`hint` 是解锁之前显示的那一句 ——
// 隐藏成就不写条件，只写一个方向；解锁后才给 `desc`。

export const STREAK_TIERS = [
  { at: 3, form: 'spark', name: '火苗' },
  { at: 7, form: 'flame', name: '火焰' },
  { at: 30, form: 'torch', name: '火把' },
  { at: 100, form: 'star', name: '星' },
  { at: 365, form: 'sun', name: '太阳' },
];

/** 成长类：数值到了就升一级，界面上写明下一级要多少 */
export const TIERS = [
  { id: 'known', icon: 'calendar', name: '相识', unit: '天',
    steps: [100, 365, 1000], of: (s, now) => (s.first ? dayNo(now) - dayNo(s.first) + 1 : 0) },
  { id: 'count', icon: 'boat', name: '消息', unit: '条',
    steps: [1000, 10000], names: ['小船', '巨轮'], icons: ['boat', 'ship'], of: s => s.n || 0 },
  { id: 'call', icon: 'phone', name: '通话', unit: '小时',
    steps: [1, 10, 50], of: s => Math.floor((s.callSec || 0) / 3600) },
  { id: 'listen', icon: 'headphone', name: '一起听', unit: '小时',
    steps: [1, 10], of: s => Math.floor((s.listenSec || 0) / 3600) },
];

export const ACHIEVEMENTS = [
  { id: 'night3', icon: 'moon', name: '凌晨三点', hint: '与夜晚有关',
    desc: '在凌晨三点到四点之间互发过消息' },
  { id: 'burst', icon: 'sparkle', name: '连珠炮', hint: '与速度有关',
    desc: '一分钟内同一方连续发出十条消息' },
  { id: 'collide', icon: 'heart', name: '撞车', hint: '与默契有关',
    desc: '同一分钟内双方发出了同一个表情' },
  { id: 'firstCall', icon: 'phone', name: '第一通电话', hint: '与声音有关',
    desc: '第一次接通电话' },
  { id: 'longCall', icon: 'clock', name: '长谈', hint: '与声音有关',
    desc: '单次通话超过一小时' },
  { id: 'pact10', icon: 'bookmark', name: '守约', hint: '与承诺有关',
    desc: '完成的约定达到十个' },
  { id: '520', icon: 'wallet', name: '五二零', hint: '与数字有关',
    desc: '一笔转账的金额正好是 520' },
  { id: 'greet7', icon: 'sun', name: '早安晚安', hint: '与问候有关',
    desc: '连续七天互道早安与晚安' },
  { id: 'letters5', icon: 'mail', name: '书信往来', hint: '与纸笔有关',
    desc: '双方各寄出五封信' },
  { id: 'rescue', icon: 'flame', name: '救火', hint: '与火有关',
    desc: '火花熄灭的第二天，由对方先开口并互发，火花接续' },
  { id: 'owl', icon: 'moon', name: '夜谈', hint: '与夜晚有关',
    desc: '消息满两百条，其中零点到五点之间的占两成以上' },
];

/** 节日与纪念日限定。互发的那一天正好是这一天，就得到当年那一枚 */
export const LIMITED = [
  { id: 'newyear', name: '新年第一天', md: () => '01-01' },
  { id: 'valentine', name: '情人节', md: () => '02-14' },
  { id: 'xmas', name: '圣诞节', md: () => '12-25' },
  { id: 'bdayChar', name: '对方的生日', md: ctx => ctx.charBday },
  { id: 'bdayMe', name: '我的生日', md: ctx => ctx.myBday },
  { id: 'anniv', name: '相识纪念日', md: ctx => ctx.anniv },
];

export const achievementOf = id => ACHIEVEMENTS.find(a => a.id === id) || null;
export const limitedOf = id => LIMITED.find(x => x.id === id.split(':')[0]) || null;

/** 任何一种解锁记录（成就、档位、限定）写成一句给人看的名字 */
export function labelOf(id) {
  const a = achievementOf(id);
  if (a) return `${a.name}（${a.desc}）`;
  const lim = id.includes(':') ? limitedOf(id) : null;
  if (lim) return `${id.split(':')[1]} ${lim.name}`;
  const m = String(id).match(/^([a-z]+)-(\d+)$/);
  if (!m) return '';
  if (m[1] === 'streak') {
    const x = STREAK_TIERS.find(t => t.at === Number(m[2]));
    return x ? `连续互发 ${x.at} 天：${x.name}` : '';
  }
  const tier = TIERS.find(t => t.id === m[1]);
  if (!tier) return '';
  const i = tier.steps.indexOf(Number(m[2]));
  return tier.names?.[i] ? `${tier.names[i]}（${tier.name} ${m[2]} ${tier.unit}）` : `${tier.name} ${m[2]} ${tier.unit}`;
}

// ---- 统计 ----

const blank = () => ({
  v: VERSION, upTo: 0, edge: [],
  n: 0, nU: 0, nC: 0, first: 0, late: 0,
  day: null, lastBoth: null, streak: 0, best: 0, rescued: 0,
  callSec: 0, calls: 0, listenSec: 0, pacts: 0, letters: { u: 0, c: 0 },
  greet: null, greetRun: 0, greetLast: null,
  stick: { u: null, c: null }, burst: { u: [], c: [] },
});

const MORNING = /早安|早上好|good\s*morning/i;
const NIGHT = /晚安|good\s*night/i;

function bdayCtx(chat) {
  const inGroup = group.isGroup(chat);
  const char = inGroup ? null : characters.get((chat.characterIds || [])[0]);
  const me = accounts.get(chat.personaId) || accounts.current();
  return { charBday: birthdayMd(char?.birthday), myBday: birthdayMd(me?.birthday) };
}

/** 过一条消息。返回这一条让哪些东西解锁了 */
function step(st, m, got, ctx) {
  const t = Number(m.createdAt) || 0;
  // 约定完成那一行是提示行，只拿来数约定
  if (m.kind === 'notice') {
    if (m.settledKind === 'pact') { st.pacts += 1; if (st.pacts >= 10) got('pact10', t); }
    return;
  }
  if (m.status === 'error' || (m.role !== 'user' && m.role !== 'char')) return;
  const side = m.role === 'user' ? 'u' : 'c';
  const opp = side === 'u' ? 'c' : 'u';

  st.n += 1;
  st[side === 'u' ? 'nU' : 'nC'] += 1;
  if (!st.first) st.first = t;
  const K = dayNo(t);
  if (!st.day || st.day.key !== K) st.day = { key: K, u: false, c: false, first: side, h3u: false, h3c: false };
  st.day[side] = true;

  const hour = new Date(t).getHours();
  if (hour < 5) st.late += 1;
  if (hour === 3) {
    st.day[`h3${side}`] = true;
    if (st.day.h3u && st.day.h3c) got('night3', t);
  }

  // 连续互发。断了正好一天、今天又是对方先开的口，算接上（余烬被救起来了）
  if (st.day.u && st.day.c && st.lastBoth !== K) {
    const gap = st.lastBoth === null ? null : K - st.lastBoth;
    if (gap === 1) st.streak += 1;
    else if (gap === 2 && st.day.first === 'c') { st.streak += 1; st.rescued += 1; got('rescue', t); }
    else st.streak = 1;
    st.lastBoth = K;
    st.best = Math.max(st.best, st.streak);
    STREAK_TIERS.forEach(x => { if (st.streak >= x.at) got(`streak-${x.at}`, t); });
    // 限定款：互发的那一天正好是那个日子
    const md = mdOf(t);
    const year = new Date(t).getFullYear();
    const anniv = new Date(st.first).getFullYear() < year ? mdOf(st.first) : '';
    const c = { ...ctx, anniv };
    LIMITED.forEach(x => { if (x.md(c) && x.md(c) === md) got(`${x.id}:${year}`, t, 'limited'); });
  }

  // 早安晚安：同一天里四句都有（你的早安、对方的早安、你的晚安、对方的晚安）
  const text = String(m.content || '');
  if (!st.greet || st.greet.key !== K) st.greet = { key: K, mu: false, mc: false, nu: false, nc: false, done: false };
  if (MORNING.test(text)) st.greet[`m${side}`] = true;
  if (NIGHT.test(text)) st.greet[`n${side}`] = true;
  const g = st.greet;
  if (!g.done && g.mu && g.mc && g.nu && g.nc) {
    g.done = true;
    st.greetRun = st.greetLast === K - 1 ? st.greetRun + 1 : 1;
    st.greetLast = K;
    if (st.greetRun >= 7) got('greet7', t);
  }

  // 一分钟十条
  const b = st.burst[side];
  b.push(t);
  if (b.length > 10) b.shift();
  if (b.length === 10 && t - b[0] <= 60000) got('burst', t);

  // 同一分钟里双方发了同一个表情
  if (m.kind === 'sticker' && m.stickerId) {
    const o = st.stick[opp];
    if (o && o.id === m.stickerId && t - o.at <= 60000) got('collide', t);
    st.stick[side] = { id: m.stickerId, at: t };
  }

  if (m.kind === 'call' && m.outcome === 'done' && Number(m.seconds) > 0) {
    st.callSec += Number(m.seconds);
    st.calls += 1;
    got('firstCall', t);
    if (Number(m.seconds) >= 3600) got('longCall', t);
  }
  if (m.kind === 'listen') st.listenSec += Number(m.seconds) || 0;
  if (m.kind === 'transfer' && Number(m.amount) === 520) got('520', t);
  if (m.kind === 'letter') {
    st.letters[side] += 1;
    if (st.letters.u >= 5 && st.letters.c >= 5) got('letters5', t);
  }
  if (st.n >= 200 && st.late / st.n >= 0.2) got('owl', t);
}

/** 按当前统计把成长类的档位补上（相识天数这种不靠消息推进，要按今天算） */
function tierUnlocks(st, got, now) {
  for (const tier of TIERS) {
    const v = tier.of(st, now);
    tier.steps.forEach(x => { if (v >= x) got(`${tier.id}-${x}`, now); });
  }
}

// 刚解锁的，界面拿去放动画。只放「这一次新算出来的」，整段补算出来的不放 ——
// 那些是早就发生过的事，一口气弹二十个出来没有意义
export const fresh = createStore({ items: [] });

/**
 * 同步一段会话的统计。有变化才写库。返回这一次新解锁的 id。
 * full：整段重算（「重新统计」）。
 */
export function sync(chatId, { full = false, now = Date.now() } = {}) {
  const chat = chats.get(chatId);
  if (!chat) return [];
  const redo = full || !chat.stats || chat.stats.v !== VERSION;
  const st = redo ? blank() : JSON.parse(JSON.stringify(chat.stats));
  const unlocked = redo && full ? {} : { ...(chat.unlocked || {}) };
  const limited = redo && full ? {} : { ...(chat.limited || {}) };
  const news = [];
  const got = (id, at, kind) => {
    const bag = kind === 'limited' ? limited : unlocked;
    if (bag[id]) return;
    bag[id] = at || now;
    news.push(id);
  };
  const ctx = bdayCtx(chat);
  const edge = new Set(st.edge || []);
  let moved = false;
  // 按时间排好的，二分找到从哪条开始看：后台每一轮每段会话都要问一遍，
  // 两万条的会话挨个跳过也要一两毫秒，几十段会话加起来就是一帧
  const list = messagesOf(chatId);
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((Number(list[mid].createdAt) || 0) < st.upTo) lo = mid + 1; else hi = mid;
  }
  for (let i = lo; i < list.length; i++) {
    const m = list[i];
    const t = Number(m.createdAt) || 0;
    if (t < st.upTo || (t === st.upTo && edge.has(m.id))) continue;
    step(st, m, got, ctx);
    if (t > st.upTo) { st.upTo = t; edge.clear(); }
    edge.add(m.id);
    moved = true;
  }
  st.edge = [...edge];
  tierUnlocks(st, got, now);
  if (!moved && !news.length && !redo) return [];
  chats.update(chatId, { stats: st, unlocked, limited });
  if (!redo && news.length) {
    fresh.set({ items: [...fresh.get().items, ...news.map(id => ({ chatId, id, at: now }))] });
  }
  return news;
}

export function dismissFresh(chatId) {
  fresh.set({ items: fresh.get().items.filter(x => x.chatId !== chatId) });
}

// ---- 读 ----

/** 这段对话显不显示标识（这段对话自己的开关，默认显示） */
export const shown = chat => chat?.badgeShow !== false;
/** 让角色知道（默认关：它会进提示词） */
export const aware = chat => chat?.badgeAware === true;
export const remindOn = chat => chat?.badgeRemind !== false;
export const remindHour = chat => {
  const n = Number(chat?.badgeRemindHour);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? Math.round(n) : 21;
};

export const formOf = n => [...STREAK_TIERS].reverse().find(x => n >= x.at) || null;

/**
 * 火花现在是什么样。
 *   lit    今天已经互发
 *   risk   昨天互发了，今天还没有（快断了）
 *   ember  断了正好一天：今天对方先开口、双方互发，就能接上
 *   out    熄了
 */
export function streakOf(chat, now = Date.now()) {
  const s = chat?.stats;
  if (!s || s.lastBoth === null || s.lastBoth === undefined) return { state: 'none', n: 0, best: 0, form: null };
  const gap = dayNo(now) - s.lastBoth;
  const form = formOf(s.streak);
  if (gap <= 0) return { state: 'lit', n: s.streak, best: s.best, form };
  if (gap === 1) return { state: 'risk', n: s.streak, best: s.best, form };
  if (gap === 2) return { state: 'ember', n: s.streak, best: s.best, form };
  return { state: 'out', n: 0, best: s.best, form: null };
}

/** 成长类的当前档与下一档 */
export function tiersOf(chat, now = Date.now()) {
  const s = chat?.stats || blank();
  return TIERS.map(t => {
    const v = t.of(s, now);
    const idx = t.steps.filter(x => v >= x).length - 1;
    return {
      ...t, value: v, level: idx + 1,
      label: idx >= 0 ? (t.names ? t.names[idx] : `${t.name} ${t.steps[idx]} ${t.unit}`) : '',
      iconNow: idx >= 0 && t.icons ? t.icons[idx] : t.icon,
      next: t.steps[idx + 1] ?? null,
    };
  });
}

// ---- 亲密度 ----
//
// 几项加权合成一个分数，分成六级。权重是为了「聊得久、聊得多、打过电话、
// 一起经历过事」都算数，不是为了精确 —— 它只决定头像外那一圈画多满。
// 每一级叫什么由用户自己填（`chat.levelNames`），系统不替人定义关系。
export const LEVELS = [0, 60, 200, 500, 1200, 3000];

export function scoreOf(chat, now = Date.now()) {
  const s = chat?.stats;
  if (!s) return 0;
  const known = s.first ? dayNo(now) - dayNo(s.first) : 0;
  return Math.round((s.best || 0) * 3 + (s.n || 0) / 40 + (s.callSec || 0) / 600
    + (s.listenSec || 0) / 900 + known / 10
    + Object.keys(chat.unlocked || {}).length * 8
    + Object.keys(chat.limited || {}).length * 10
    + (chat.awards || []).length * 10);
}

export function levelOf(chat, now = Date.now()) {
  const score = scoreOf(chat, now);
  let i = 0;
  while (i + 1 < LEVELS.length && score >= LEVELS[i + 1]) i += 1;
  const lo = LEVELS[i], hi = LEVELS[i + 1];
  const names = chat?.levelNames || [];
  return {
    level: i + 1, score, max: LEVELS.length,
    name: String(names[i] || '').trim() || `第 ${i + 1} 级`,
    progress: hi ? Math.min(1, (score - lo) / (hi - lo)) : 1,
    next: hi ?? null,
  };
}

// ---- 群里的周榜 ----
//
// 按自然周（周一零点起）现算，不存。话痨：这周说得最多的；团宠：这周被你
// @ 得最多的；夜猫子：这周零点到五点说得最多的。都有门槛，不够的空着。
export function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function weeklyTitles(chat, now = Date.now()) {
  const out = new Map();
  if (!group.isGroup(chat)) return out;
  const from = weekStart(now);
  const talk = new Map(), pet = new Map(), owl = new Map();
  const add = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const m of messagesOf(chat.id)) {
    if (m.createdAt < from || m.status === 'error') continue;
    if (m.role === 'char') {
      add(talk, m.authorId);
      if (new Date(m.createdAt).getHours() < 5) add(owl, m.authorId);
    } else if (m.role === 'user') (m.mentions || []).forEach(id => add(pet, id));
  }
  const top = (map, min, title) => {
    let best = null;
    map.forEach((n, id) => { if (n >= min && (!best || n > best.n)) best = { id, n }; });
    if (best) out.set(best.id, [...(out.get(best.id) || []), title]);
  };
  top(talk, 5, '话痨');
  top(pet, 2, '团宠');
  top(owl, 3, '夜猫子');
  return out;
}

// ---- 年度回顾 ----

const STOP = new Set(['我们', '你们', '他们', '她们', '什么', '一个', '这个', '那个', '没有', '就是',
  '还是', '可以', '知道', '现在', '今天', '怎么', '不是', '已经', '因为', '所以', '然后', '但是',
  '自己', '这样', '真的', '一下', '时候', '觉得', '那么', '这么', '一点', '有点', '如果', '的话']);

function topWords(texts, n = 5) {
  const count = new Map();
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  for (const raw of texts) {
    const t = String(raw || '').replace(/\[[^\]]*\]/g, ' ');
    const words = seg ? [...seg.segment(t)].filter(x => x.isWordLike).map(x => x.segment)
      : (t.match(/[一-鿿]{2}/g) || []);
    for (const w of words) {
      if (w.length < 2 || STOP.has(w) || /^[\d\s\p{P}]+$/u.test(w)) continue;
      count.set(w, (count.get(w) || 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w, k]) => ({ w, n: k }));
}

/**
 * 某一年的回顾。全部本地算。
 * words：要不要数「最常说的词」。分词是这里最慢的一步（两万条要一两百毫秒），
 * 页面先不带它画出来，再另算这一项补上。
 */
export function yearOf(chatId, year = new Date().getFullYear(), { words = true } = {}) {
  const chat = chats.get(chatId);
  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime();
  const list = messagesOf(chatId).filter(m => m.createdAt >= from && m.createdAt < to
    && m.status !== 'error' && (m.role === 'user' || m.role === 'char') && m.kind !== 'notice');
  const byDay = new Map();
  let latest = null;
  let best = 0, run = 0, lastBoth = null;
  const days = new Map();   // 天序号 -> { u, c }
  for (const m of list) {
    const k = dayNo(m.createdAt);
    byDay.set(k, (byDay.get(k) || 0) + 1);
    const d = days.get(k) || { u: false, c: false };
    d[m.role === 'user' ? 'u' : 'c'] = true;
    days.set(k, d);
    // 「最晚」指一天里最晚的钟点：凌晨四点比晚上十一点更晚
    const h = new Date(m.createdAt);
    const mins = ((h.getHours() + 19) % 24) * 60 + h.getMinutes();   // 五点为一天的开始
    if (!latest || mins > latest.mins) latest = { mins, at: m.createdAt };
  }
  [...days.keys()].sort((a, b) => a - b).forEach(k => {
    const d = days.get(k);
    if (!d.u || !d.c) return;
    run = lastBoth === k - 1 ? run + 1 : 1;
    lastBoth = k;
    best = Math.max(best, run);
  });
  let busiest = null;
  byDay.forEach((n, k) => { if (!busiest || n > busiest.n) busiest = { k, n }; });
  const inYear = at => at >= from && at < to;
  return {
    year, n: list.length,
    nU: list.filter(m => m.role === 'user').length,
    nC: list.filter(m => m.role === 'char').length,
    activeDays: byDay.size, bothDays: [...days.values()].filter(d => d.u && d.c).length,
    busiest: busiest ? { at: (busiest.k * 86400000) + new Date().getTimezoneOffset() * 60000 + 43200000, n: busiest.n } : null,
    latest: latest ? latest.at : null,
    bestStreak: best,
    words: words ? topWords(list.filter(m => m.kind === 'text').map(m => m.content)) : null,
    unlocked: Object.entries(chat?.unlocked || {}).filter(([, at]) => inYear(at)).map(([id]) => id),
    limited: Object.entries(chat?.limited || {}).filter(([, at]) => inYear(at)).map(([id]) => id),
    awards: (chat?.awards || []).filter(a => inYear(a.at)),
    note: chat?.yearNotes?.[year] || '',
  };
}

// ---- 颁发 ----

/** 记一枚颁发的标识。by：谁颁的（'me' 或角色 id），to：颁给谁 */
export function addAward(chatId, { name, reason = '', by, to, msgId = '', at = Date.now() }) {
  const chat = chats.get(chatId);
  const n = String(name || '').trim().slice(0, 24);
  if (!chat || !n) return null;
  const row = { id: `aw_${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: n, reason: String(reason || '').trim().slice(0, 80), by, to, msgId, at };
  chats.update(chatId, { awards: [...(chat.awards || []), row] });
  return row;
}

export function dropAward(chatId, awardId) {
  const chat = chats.get(chatId);
  if (!chat) return;
  chats.update(chatId, { awards: (chat.awards || []).filter(a => a.id !== awardId) });
}

// ---- 后台 ----
//
// 挂在 proactive.tick 上（二十秒到一分钟一次）：把每段会话同步一遍，
// 快断了的到点提醒一次。提醒是本地通知，不调接口。
const REMIND_KEY = 'phone.badges.reminded';

function remindedMap() {
  try { return JSON.parse(localStorage.getItem(REMIND_KEY) || '{}') || {}; } catch { return {}; }
}
function markReminded(chatId, day) {
  const m = remindedMap();
  m[chatId] = day;
  try { localStorage.setItem(REMIND_KEY, JSON.stringify(m)); } catch { /* 隐私模式会抛 */ }
}

export function tick(now = Date.now()) {
  const me = accounts.currentId();
  const today = dayNo(now);
  const reminded = remindedMap();
  for (const chat of chats.all()) {
    if ((chat.personaId || me) !== me) continue;
    sync(chat.id, { now });
    const cur = chats.get(chat.id);
    if (!shown(cur) || !remindOn(cur)) continue;
    const s = streakOf(cur, now);
    if (s.state !== 'risk' || s.n < 3) continue;
    if (new Date(now).getHours() < remindHour(cur) || reminded[chat.id] === today) continue;
    markReminded(chat.id, today);
    const name = group.isGroup(cur) ? group.titleOf(cur)
      : characters.get((cur.characterIds || [])[0])?.name || '会话';
    notify({
      title: name, icon: 'bell', appId: 'chat', payload: { route: `/chat/${cur.id}` },
      body: `连续互发 ${s.n} 天，今天尚未互发。零点之后火花熄灭。`,
    });
  }
}
