import { trips, chats, characters, messages } from './db/index.js';
import * as accounts from './accounts.js';
import * as ledger from './ledger.js';
import * as clock from './time.js';

// 一次出行。
//
// ---- 为什么它要自己一个数据域 ----
//
// 情侣空间那一节立过一条：**会话里发生过的事不另存一份**（礼物、位置、
// 一起听、约定都是消息，不是记录）。这一条对出行不成立 ——
// 一次出行是一个跨很多轮、有自己状态的东西：定了没、票买了没、攒够没、
// 出发了没。这几样从消息里折不出来，所以它得有自己的一行。
//
// **但凡折得出来的，一律不存。** 现在是第几阶段（还在商量 / 快到了 /
// 正在路上 / 结束了）由日期现算，不存字段 —— 存了就要有人负责在日子过去时
// 把它改掉，而那个人迟早会漏。这和余额不入库是同一条理由。
//
// 钱同理：**这次出行花了多少，是账本里那几笔流水的和**，不在这一行里记一个数。
//
// ---- 一次出行挂在一段会话上 ----
//
// 「一起去」这件事长在关系上，和情侣空间同一个理由：人设不同关系就不同，
// 不必再拿 人设 × 角色 拼一张表。
//
// ---- 三种出行是同一个对象 ----
//
// 旅行、看演出、看比赛，`kind` 不同而已。看演唱会不一定要去外地，
// 去外地也可能就是为了看那一场；拆成两个数据域只会两边各写一遍同样的
// 日期、预算、票。

export const TRIP = 'trip';     // 旅行
export const SHOW = 'show';     // 看演出
export const MATCH = 'match';   // 看比赛
export const KINDS = [
  { id: TRIP, label: '旅行', icon: 'compass', what: '目的地' },
  { id: SHOW, label: '看演出', icon: 'music', what: '演出' },
  { id: MATCH, label: '看比赛', icon: 'star', what: '赛事' },
];
export const kindOf = id => KINDS.find(k => k.id === id) || KINDS[0];

// 存下来的状态只有三种。别的都是算出来的
export const TALKING = 'talking';   // 还在商量
export const BOOKED = 'booked';     // 定了
export const DROPPED = 'dropped';   // 不去了

// 现算出来的阶段。**不存**，见开头那一段
export const SOON = 'soon';         // 定了，还没到日子
export const GOING = 'going';       // 正在路上
export const DONE = 'done';         // 过去了

export const PHASES = {
  [TALKING]: '商量中',
  [SOON]: '待出发',
  [GOING]: '进行中',
  [DONE]: '已结束',
  [DROPPED]: '已取消',
};

const trim = (v, n) => String(v ?? '').trim().slice(0, n);

// ---- 日期 ----
//
// 存 'YYYY-MM-DD' 这样的字符串，不存时间戳。一次出行说的是「十月三号那天」，
// 那是个日历上的日子，不是某个时刻 —— 存时间戳就要挑一个时区，
// 而出发地和目的地的时区还不是同一个。

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = v => DATE.test(String(v || ''));

/** 今天，按用户自己那一头算。 */
export function today() {
  const d = new Date(clock.now());
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** a 和 b 差几天。都是 'YYYY-MM-DD'。 */
export function daysBetween(a, b) {
  if (!isDate(a) || !isDate(b)) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// ---- 取 ----

export const get = id => trips.get(id);

/** 这段会话上的全部出行，新的在前。 */
export const listOf = chatId => trips.byIndex(chatId)
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

export const all = () => trips.all()
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

/**
 * 现在到哪一步了。存的状态只有三种，剩下的按日期算。
 *
 * 没填日期的「已定」仍然算 soon —— 定了但还没挑日子是常有的事，
 * 不能因为日期空着就说它结束了。
 */
export function phaseOf(row) {
  if (!row) return null;
  if (row.state === DROPPED) return DROPPED;
  if (row.state !== BOOKED) return TALKING;
  const now = today();
  const from = isDate(row.from) ? row.from : '';
  const to = isDate(row.to) ? row.to : from;
  if (!from) return SOON;
  if (now < from) return SOON;
  if (now > to) return DONE;
  return GOING;
}

/** 还有几天出发。已经出发或没填日期都返回 null。 */
export function daysUntil(row) {
  if (phaseOf(row) !== SOON || !isDate(row?.from)) return null;
  return daysBetween(today(), row.from);
}

/** 正在路上的话，今天是第几天（从 1 数起）。 */
export function dayIndex(row) {
  if (phaseOf(row) !== GOING || !isDate(row?.from)) return null;
  return (daysBetween(row.from, today()) || 0) + 1;
}

/** 一共几天。没填到期日就按一天算。 */
export function nights(row) {
  if (!isDate(row?.from)) return 0;
  if (!isDate(row?.to)) return 1;
  return Math.max(1, (daysBetween(row.from, row.to) || 0) + 1);
}

/**
 * 这段会话里眼下要紧的那一次。商量中与待出发按日期先后，进行中排最前。
 * 注入与角色手机那类「一句话摘要」读它，不必自己挑。
 */
export function currentOf(chatId) {
  const live = listOf(chatId).filter(r => {
    const p = phaseOf(r);
    return p === TALKING || p === SOON || p === GOING;
  });
  const rank = { [GOING]: 0, [SOON]: 1, [TALKING]: 2 };
  return live.sort((a, b) => {
    const d = rank[phaseOf(a)] - rank[phaseOf(b)];
    if (d) return d;
    return String(a.from || '9999').localeCompare(String(b.from || '9999'));
  })[0] || null;
}

// ---- 改 ----

export function create({ chatId, kind = TRIP, title, place = '', venue = '',
  from = '', to = '', note = '', proposedBy = 'me', agreed = false } = {}) {
  if (!chats.get(chatId)) throw new Error('这段对话已经不在了');
  const t = trim(title, 40);
  if (!t) throw new Error('请填写名称');
  return trips.create({
    chatId,
    kind: KINDS.some(k => k.id === kind) ? kind : TRIP,
    title: t,
    place: trim(place, 40),
    venue: trim(venue, 40),
    from: isDate(from) ? from : '',
    to: isDate(to) ? to : '',
    note: trim(note, 200),
    zone: '',        // 目的地时区。空着表示出行期间不改变角色那边的时刻
    state: TALKING,
    proposedBy: proposedBy === 'char' ? 'char' : 'me',
    agreed: agreed === true,
    plan: [],        // 攻略条目（批 4）
    tickets: [],     // 票（批 2、3）
    budget: 0,
    createdAt: Date.now(),
  });
}

export function update(id, patch) {
  const row = trips.get(id);
  if (!row) return null;
  const next = { ...patch };
  if ('title' in next) next.title = trim(next.title, 40);
  if ('place' in next) next.place = trim(next.place, 40);
  if ('venue' in next) next.venue = trim(next.venue, 40);
  if ('note' in next) next.note = trim(next.note, 200);
  if ('from' in next) next.from = isDate(next.from) ? next.from : '';
  if ('to' in next) next.to = isDate(next.to) ? next.to : '';
  if ('budget' in next) next.budget = Math.max(0, Number(next.budget) || 0);
  if ('zone' in next) next.zone = trim(next.zone, 40);
  // 日子反了就掉个个儿，不报错 —— 两个日期选择器谁先谁后是很容易点反的
  const from = 'from' in next ? next.from : row.from;
  const to = 'to' in next ? next.to : row.to;
  if (isDate(from) && isDate(to) && to < from) { next.from = to; next.to = from; }
  return trips.update(id, next);
}

export const remove = id => trips.remove(id);

/**
 * 定下来。**没填出发日期不让定** —— 「已定」这个状态底下挂着买票、
 * 攒钱、出发提醒，全都要日期；定了却没有日期，那几样一律算不出来。
 */
export function book(id) {
  const row = trips.get(id);
  if (!row) return null;
  if (!isDate(row.from)) throw new Error('请先填写出发日期');
  return trips.update(id, { state: BOOKED });
}

export const undoBook = id => trips.update(id, { state: TALKING });
export const drop = id => trips.update(id, { state: DROPPED });
export const undrop = id => trips.update(id, { state: TALKING });

/** 对方答应了没有。角色在会话里写 [同行] 就是这一下。 */
export const agree = (id, yes = true) => trips.update(id, { agreed: yes === true });

// ---- 这次出行花了多少 ----
//
// **不在这一行里记一个数。** 花费就是账本里挂着这次出行的那几笔流水的和 ——
// 记一个数的话，进账本改一笔或删一笔，这边那个数就悄悄错了，
// 而且没有任何人会发现。和余额不入库是同一条理由。

/** 账本里这次出行的那几笔。靠流水上的 tripId 认。 */
export function entriesOf(id) {
  const row = trips.get(id);
  const book = row && ledger.bookOfChat(row.chatId);
  if (!book) return [];
  return ledger.allEntries(book.id).filter(e => e.tripId === id);
}

/** 已经花掉多少（正数）。 */
export function spentOn(id) {
  return entriesOf(id).reduce((n, e) => n + (e.amount < 0 ? -e.amount : 0), 0);
}

/**
 * 攒钱那一栏。**钱只有一处：账本的共同账户。**
 *
 * 没绑账本就返回 null，界面据此引导去绑一本 —— 不在行程里另记一个
 * 「已攒多少」，那样同一笔钱会有两处，迟早对不上。
 */
export function savingOn(id) {
  const row = trips.get(id);
  if (!row) return null;
  const book = ledger.bookOfChat(row.chatId);
  if (!book) return null;
  const joint = ledger.defaultFor(book.id, ledger.JOINT);
  if (!joint) return { book, joint: null, have: 0, need: row.budget || 0, short: row.budget || 0 };
  const have = ledger.balanceOf(book.id, joint.id);
  const need = Math.max(0, (row.budget || 0) - spentOn(id));
  return { book, joint, have, need, short: Math.max(0, need - have) };
}

// ---- 票 ----
//
// 一张票内嵌在出行那一行里（和角色手机的备忘录一样：不多，而且总是跟着
// 一次出行一起读、一起删）。
//
// ---- 候选票和已买的票是同一个对象 ----
//
// 搜回来的是候选（found），买下来变成 bought，没抢到变成 missed。
// 分成两个数组会立刻出现「同一张票在两边各有一份」的问题。
//
// ---- 存的是客观数字，不是概率 ----
//
// `capacity`（场馆能坐多少）、`demand`（多少人想看）、`share`（这一档占
// 多少票）、`heat`（这一档多抢手）**全部来自搜索，是查得到的事实**。
//
// **抢不抢得到的概率不存，也不问模型。** 它由这几个数在本地算出来
// （第三批）。理由和随机事件那一条一样：点数、距离、金额不是模型的活，
// 供需比同理 —— 交给模型给一个「百分之十二」，它给的是它的印象，不是算术。
//
// 46000 人的场、38 万人想看，内场那一档占 8% 的票却吸走三成的人，
// 于是三千多张票对十来万人。**抢不到是这几个数算出来的结果**，
// 不是谁拍的一个数。
//
// ---- 价是什么时候的价 ----
//
// `src` 记这一条哪儿来的：联网搜的、模型估的、还是手填的。
// `foundAt` 记搜到的时刻。**界面必须把这两样写出来** —— 搜出来的是模型
// 看到的网页上的数字，不是实时票价，这个 app 也不订票。装成订票系统
// 是不诚实的。

export const FLIGHT = 'flight';   // 机票
export const TRAIN = 'train';     // 车票
export const ENTRY = 'entry';     // 门票
export const SHOW_TICKET = 'showticket';   // 演出票
export const MATCH_TICKET = 'matchticket'; // 比赛票

// `cat` 是记进账本时归哪一类。**用账本已有的那十类，不为出行另开一类** ——
// 记账那一页的月度统计按类分，多一类只会让「交通」少一块
export const TICKET_KINDS = [
  { id: FLIGHT, label: '机票', icon: 'compass', grab: false, cat: 'transit' },
  { id: TRAIN, label: '车票', icon: 'compass', grab: false, cat: 'transit' },
  { id: ENTRY, label: '门票', icon: 'bookmark', grab: false, cat: 'fun' },
  { id: SHOW_TICKET, label: '演出票', icon: 'music', grab: true, cat: 'fun' },
  { id: MATCH_TICKET, label: '比赛票', icon: 'star', grab: true, cat: 'fun' },
];
export const ticketKindOf = id =>
  TICKET_KINDS.find(k => k.id === id) || TICKET_KINDS[0];

// 这次出行默认找哪几种票
export const KINDS_FOR = {
  [TRIP]: [FLIGHT, TRAIN, ENTRY],
  [SHOW]: [SHOW_TICKET, FLIGHT, TRAIN],
  [MATCH]: [MATCH_TICKET, FLIGHT, TRAIN],
};

export const FOUND = 'found';
export const BOUGHT = 'bought';
export const MISSED = 'missed';
export const GIVENUP = 'givenup';

export const SEARCHED = 'search';   // 联网搜出来的
export const GUESSED = 'guess';     // 普通接口估的
export const MANUAL = 'manual';     // 手填的

const num = (v, max = 1e9) => Math.min(max, Math.max(0, Number(v) || 0));
const rate = v => Math.min(1, Math.max(0, Number(v) || 0));

export const ticketsOf = id => (get(id)?.tickets || []);
export const ticketOf = (id, tid) => ticketsOf(id).find(t => t.id === tid) || null;

/** 加几张候选票。**追加不覆盖**：再搜一次是往后加，不是把上一次的抹掉。 */
export function addTickets(id, rows, src = SEARCHED) {
  const row = get(id);
  if (!row) return [];
  const at = Date.now();
  const clean = (rows || []).map((r, i) => ({
    id: `tk_${at.toString(36)}_${i}`,
    kind: TICKET_KINDS.some(k => k.id === r?.kind) ? r.kind : FLIGHT,
    title: trim(r?.title, 60),
    from: trim(r?.from, 30),
    to: trim(r?.to, 30),
    at: trim(r?.at, 20),
    seat: trim(r?.seat, 30),
    face: num(r?.face),
    qty: Math.max(1, Math.round(Number(r?.qty) || 2)),
    // 抢票那几个客观数字
    capacity: Math.round(num(r?.capacity)),
    demand: Math.round(num(r?.demand)),
    share: rate(r?.share),
    heat: rate(r?.heat),
    // 这两个数是查来的还是编的。**编的也要**：查不到就算不出概率，
    // 那一页只能写「无法计算」，整个抢票就废了。编可以，瞒不行 ——
    // 界面上照实标着「虚拟」，用户看得见这一局是按什么数算的。
    // 没联网那一档整批都是编的，不必问模型
    numsMade: src === GUESSED ? true : !!r?.numsMade,
    saleAt: trim(r?.saleAt, 20),
    need: r?.need === true,
    note: trim(r?.note, 80),
    state: FOUND,
    tries: 0,        // 抢了几次。余票由它算出来，不另存（见 system/grab.js）
    paid: 0,
    entryId: '',
    src,
    foundAt: at,
  })).filter(t => t.title);
  if (!clean.length) return [];
  trips.update(id, { tickets: [...ticketsOf(id), ...clean] });
  return clean;
}

export const updateTicket = (id, tid, patch) => trips.update(id, {
  tickets: ticketsOf(id).map(t => (t.id === tid ? { ...t, ...patch } : t)),
});

export const removeTicket = (id, tid) => trips.update(id, {
  tickets: ticketsOf(id).filter(t => t.id !== tid),
});

/** 这张票一共要多少钱。加价买的时候传一个倍数（第三批用）。 */
export const costOf = (t, times = 1) =>
  Math.round(num(t?.face) * Math.max(1, t?.qty || 1) * Math.max(1, times) * 100) / 100;

/**
 * 买一张。
 *
 * **钱从共同账户扣，扣不动就不让买**（ledger.affordable 那道关）。
 * 落的是账本里一条带 tripId 的流水 —— 花费不在票上记一个数，
 * 和「这次花了多少」是同一条理由。
 *
 * 需要抢的那几种这一批不从这里走：见 grabRequired。
 */
export function buyTicket(id, tid, { times = 1 } = {}) {
  const row = get(id);
  const t = ticketOf(id, tid);
  if (!row || !t) throw new Error('这张票已经不在了');
  if (t.state === BOUGHT) throw new Error('这张票已经买过了');

  const book = ledger.bookOfChat(row.chatId);
  if (!book) throw new Error('这段对话还没有账本，先在「记账」中绑定一本');
  const joint = ledger.defaultFor(book.id, ledger.JOINT);
  if (!joint) throw new Error('这本账上还没有共同账户');

  const cost = costOf(t, times);
  if (!cost) throw new Error('这张票没有价格，请先填写');
  if (ledger.strictOn(book) && ledger.balanceOf(book.id, joint.id) < cost) {
    throw new Error('共同账户余额不足，需要先存入');
  }

  const entry = ledger.add({
    bookId: book.id, accountId: joint.id, amount: -cost,
    category: ticketKindOf(t.kind).cat, tripId: id,
    note: `${ticketKindOf(t.kind).label} ${t.title}`.slice(0, 40),
  });
  updateTicket(id, tid, { state: BOUGHT, paid: cost, entryId: entry.id });
  return entry;
}

/** 退掉。账本里那一笔一并撤销 —— 留着的话票没了钱还是花出去的。 */
export function refundTicket(id, tid) {
  const t = ticketOf(id, tid);
  if (!t) return null;
  if (t.entryId) ledger.drop(t.entryId);
  return updateTicket(id, tid, { state: FOUND, paid: 0, entryId: '' });
}

/** 这张票要不要抢。票种说要抢、而且搜到了供需数字，才算数。 */
export const grabRequired = t =>
  !!t && (t.need || ticketKindOf(t.kind).grab);

// ---- 出行期间，人真的在那儿 ----
//
// 一次出行走到「进行中」的时候，角色那边的时刻、日期、星期都该按目的地算。
// 这几样全走 `clock.charZone(char)` 一个口子（time.js 那一句），
// 所以**只要那一个函数认得出「这个角色正在路上」，六处调用方一起对**。
//
// ---- 为什么目的地时区要自己选 ----
//
// 「京都在哪个时区」是个客观事实，模型答得出来。但那要多打一次接口，
// 而这件事一次出行只发生一次、选一下就好 —— 和汇率自己填是同一条理由。
//
// **空着就是不改。** 没选目的地时区的出行，进行中也不动角色那边的时刻：
// 国内出行本来就不该换，而「默认换成某个时区」是在替用户拿主意。

/** 这个角色此刻正在进行中的那一次出行。没有就返回 null。 */
export function goingFor(charId) {
  if (!charId) return null;
  for (const row of trips.all()) {
    if (row.state !== BOOKED) continue;
    if (phaseOf(row) !== GOING) continue;
    const chat = chats.get(row.chatId);
    if (chat && (chat.characterIds || []).includes(charId)) return row;
  }
  return null;
}

/**
 * 出行期间该用哪个时区。没在路上、或者那次出行没选目的地时区，都返回空 ——
 * 返回空时调用方走原来那一套（角色卡上的时区，再没有就跟设备）。
 */
export function zoneAway(char) {
  const row = char && goingFor(char.id);
  return (row && row.zone) || '';
}

/**
 * 今天这一天的攻略。**出行期间「今天」由它接管**（见 ai/context/day.js）。
 *
 * 返回的是算出来的，不写库：哪一天是第几天由日期算，条目本来就存着。
 * 出行一结束，这里返回 null，角色自己的日程原样回来 —— 不需要谁去收拾。
 */
export function dayPlanFor(charId) {
  const row = goingFor(charId);
  if (!row) return null;
  const n = dayIndex(row);
  if (!n) return null;
  const order = SLOTS.map(s => s.id);
  const items = planOf(row.id)
    .filter(p => (p.day || 0) === n)
    .sort((a, b) => (order.indexOf(a.slot) - order.indexOf(b.slot)) || (a.at - b.at));
  return { trip: row, day: n, days: nights(row), items };
}

/** 去过了没有。出行期间在攻略页上勾。 */
export const togglePlanDone = (id, pid) => {
  const p = planItemOf(id, pid);
  return p ? updatePlan(id, pid, { done: !p.done }) : null;
};

// ---- 攻略 ----
//
// 一条攻略条目内嵌在出行那一行里，和票一样。
//
// ---- 排到哪一天是一个数字 ----
//
// `day` 存的是**第几天**（1 起），不是日期。理由和出行那一行存
// 'YYYY-MM-DD' 而不是时间戳是一回事的反面：这里要的恰恰是相对位置。
// 出发日期一改，整份攻略跟着挪，不必逐条改日期 —— 而改出发日期这件事，
// 在定下来之前是常事。
//
// `day` 为 0 表示还没排进哪一天。**这是常态不是缺失**：两个人一人想起一个
// 地方先记下来，排进哪天是后面的事。
//
// ---- 谁加的要记着 ----
//
// `by` 记这一条是你加的、角色在对话里提的、还是检索出来的。
// 「一起做攻略」这件事，看得见谁加了什么才成立 —— 一份分不出谁是谁的清单
// 和一个人列的没有区别。

export const SPOT = 'spot';     // 景点
export const MEAL = 'meal';     // 吃饭
export const STAY = 'stay';     // 住
export const MOVE = 'move';     // 路上
export const OTHER = 'other';   // 其余

export const PLAN_KINDS = [
  { id: SPOT, label: '景点', icon: 'compass' },
  { id: MEAL, label: '餐饮', icon: 'cup' },
  { id: STAY, label: '住宿', icon: 'home' },
  { id: MOVE, label: '交通', icon: 'map' },
  { id: OTHER, label: '其他', icon: 'bookmark' },
];
export const planKindOf = id => PLAN_KINDS.find(k => k.id === id) || PLAN_KINDS[0];

// 时段沿用「一天」那一套的五档。同一件事只有一套说法
export const SLOTS = [
  { id: '', label: '不限' },
  { id: 'morning', label: '上午' },
  { id: 'noon', label: '中午' },
  { id: 'afternoon', label: '下午' },
  { id: 'evening', label: '晚上' },
];
export const slotLabel = id => (SLOTS.find(s => s.id === id) || SLOTS[0]).label;

export const BY_ME = 'me';
export const BY_CHAR = 'char';
export const BY_SEARCH = 'search';

export const planOf = id => (get(id)?.plan || []);
export const planItemOf = (id, pid) => planOf(id).find(p => p.id === pid) || null;

const planRow = (r, i, at, by, src) => ({
  id: `pl_${at.toString(36)}_${i}`,
  title: trim(r?.title, 40),
  kind: PLAN_KINDS.some(k => k.id === r?.kind) ? r.kind : SPOT,
  day: Math.max(0, Math.round(Number(r?.day) || 0)),
  slot: SLOTS.some(s => s.id === r?.slot) ? r.slot : '',
  place: trim(r?.place, 40),
  price: Math.max(0, Number(r?.price) || 0),
  open: trim(r?.open, 30),
  note: trim(r?.note, 80),
  by, src,
  done: false,
  at,
});

/** 加几条。**追加不覆盖**，和票、备忘录同一条规矩。 */
export function addPlan(id, rows, { by = BY_ME, src = MANUAL } = {}) {
  const row = get(id);
  if (!row) return [];
  const at = Date.now();
  const have = new Set(planOf(id).map(p => p.title));
  const clean = (rows || [])
    .map((r, i) => planRow(r, i, at, by, src))
    .filter(p => p.title && !have.has(p.title) && (have.add(p.title) || true));
  if (!clean.length) return [];
  trips.update(id, { plan: [...planOf(id), ...clean] });
  return clean;
}

export const updatePlan = (id, pid, patch) => trips.update(id, {
  plan: planOf(id).map(p => (p.id === pid ? { ...p, ...patch } : p)),
});

export const removePlan = (id, pid) => trips.update(id, {
  plan: planOf(id).filter(p => p.id !== pid),
});

/**
 * 按天分组。第 0 组是还没排进哪一天的。
 * 每一天里按时段排，同一时段按加进来的先后。
 */
export function planByDay(id) {
  const row = get(id);
  if (!row) return [];
  const order = SLOTS.map(s => s.id);
  const days = Math.max(1, nights(row));
  const bucket = n => planOf(id)
    .filter(p => (p.day || 0) === n)
    .sort((a, b) => (order.indexOf(a.slot) - order.indexOf(b.slot)) || (a.at - b.at));
  const out = [{ day: 0, items: bucket(0) }];
  for (let d = 1; d <= days; d += 1) out.push({ day: d, items: bucket(d) });
  // 天数改短之后，排在后面那几天的条目不能凭空消失
  const over = planOf(id).filter(p => (p.day || 0) > days);
  if (over.length) out.push({ day: -1, items: over });
  return out;
}

/**
 * 攻略合计。**按两个人算** —— 门票、餐费这些是按人头的。
 * 票款不在其中：那一笔在账本里，各有各的地方（见 spentOn）。
 */
export const planCost = id => Math.round(
  planOf(id).reduce((n, p) => n + (p.price || 0), 0) * 2 * 100) / 100;

// ---- 会话里那条提议 ----
//
// 和请客、转账同构：一条消息带着状态，收到的那一方表态，表完态落一行提示，
// 提示行被删就当没表过态（见 4.675）。区别只有一个 —— **答应了要建一行**，
// 因为出行是个会活很久的东西，不是一条消息就完了。

export const PENDING = 'pending';
export const JOINED = 'joined';
export const REFUSED = 'refused';

export function namesOf(chat) {
  const persona = (chat && accounts.get(chat.personaId)) || accounts.current();
  const char = characters.get((chat?.characterIds || [])[0]);
  return { me: persona?.name || '我', char: char?.name || '角色' };
}

// 上下文里的写法。模型读到的和它自己该写的是同一套格式
function contentOf({ where, when, state }) {
  const head = `[旅行：${where}${when ? ` | ${when}` : ''}]`;
  if (state === JOINED) return `${head}（已同意）`;
  if (state === REFUSED) return `${head}（未同意）`;
  return head;
}

/** 模型写的那一行拆成两段：竖线前是去哪儿，后面是什么时候。 */
export function parse(body) {
  const t = String(body || '').trim();
  if (!t) return null;
  const i = t.search(/[|｜]/);
  return i < 0
    ? { where: trim(t, 40), when: '' }
    : { where: trim(t.slice(0, i), 40), when: trim(t.slice(i + 1), 40) };
}

/** 提一次。谁提的看 role。 */
export function propose({ chatId, role, authorId, where, when = '', extra = {} }) {
  const w = trim(where, 40);
  if (!w) throw new Error('请填写目的地');
  const msg = messages.create({
    chatId, role, authorId, kind: 'trip',
    where: w, when: trim(when, 40), trip: PENDING,
    content: contentOf({ where: w, when, state: PENDING }),
    status: 'done', ...extra,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

/** 这段对话里，某一方提的、还等着对方表态的最近一条。 */
export function pendingFrom(chatId, role) {
  const list = messages.byIndex(chatId)
    .filter(m => m.kind === 'trip' && m.role === role && m.trip === PENDING)
    .sort((a, b) => a.createdAt - b.createdAt);
  return list[list.length - 1] || null;
}

/**
 * 同行 / 不去。
 *
 * 答应了要有一行出行 —— 那一行才是后面买票、攒钱挂的地方。**但不一定是新建的**：
 *
 *   角色提的    会话里只有一条消息，答应之后才建那一行
 *   你在 app 里提的  行已经在了（提议消息上带着 tripId），这一下只是标成「答应了」
 *
 * 分不清这两种就会建出第二行来：app 里一行，角色答应时再一行，
 * 同一次出行出现两次，而且两边各记各的票。
 */
export function settle(msgId, join, extra = {}) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'trip' || m.trip !== PENDING) return null;

  const state = join ? JOINED : REFUSED;
  messages.update(msgId, {
    trip: state,
    content: contentOf({ where: m.where, when: m.when, state }),
  });

  const chat = chats.get(m.chatId);
  const { me, char } = namesOf(chat);
  const charId = (chat?.characterIds || [])[0] || m.authorId;
  const byUser = m.role !== 'user';          // 表态的人和提议的人相反
  const who = byUser ? me : char;

  // 这条提议上已经挂着一行了吗（你在 app 里提的那种）
  const had = m.tripId && trips.get(m.tripId) ? m.tripId : '';
  let tripId = had;
  let made = false;
  if (join) {
    if (had) {
      agree(had, true);
    } else {
      const row = create({
        chatId: m.chatId,
        title: m.where,
        place: m.where,
        note: m.when ? `约定的时间：${m.when}` : '',
        proposedBy: m.role === 'user' ? 'me' : 'char',
        agreed: true,
      });
      tripId = row.id;
      made = true;
      messages.update(msgId, { tripId });
    }
  }

  const notice = messages.create({
    chatId: m.chatId,
    role: byUser ? 'user' : 'char',
    authorId: byUser ? 'me' : charId,
    kind: 'notice', settledId: msgId, settledKind: 'trip', tripId, tripMade: made,
    content: `[${who}${join ? '同意一同前往' : '未同意前往'}${m.where}]`,
    status: 'done', ...extra,
  });
  chats.update(m.chatId, { lastMessageAt: Date.now() });
  return notice;
}

/**
 * 提示行被删掉就当这次表态没发生过。和转账、礼物、约定同一条规矩。
 *
 * **只删这一下自己建出来的那一行。** 你在 app 里先建好、角色后来答应的那种，
 * 那一行不是这次表态建的，删掉就等于删了你自己建的行程 —— 只把它改回
 * 「还没答应」。tripMade 记的就是这个区别。
 */
export function unsettle(noticeId) {
  const n = messages.get(noticeId);
  const m = n && messages.get(n.settledId);
  if (!m || m.kind !== 'trip') return false;
  if (n.tripMade && n.tripId && trips.get(n.tripId)) {
    trips.remove(n.tripId);
    messages.update(m.id, { tripId: '' });
  } else if (n.tripId && trips.get(n.tripId)) {
    agree(n.tripId, false);
  }
  messages.update(m.id, {
    trip: PENDING,
    content: contentOf({ where: m.where, when: m.when, state: PENDING }),
  });
  return true;
}

// ---- 注入 ----
//
// **只在有一次活着的出行时才占那一段。** 没有出行的时候一个字都不写 ——
// 「你们没有出行计划」对模型没有任何用处，只是每轮都花掉几十个 token。

export function context(chatId) {
  const row = currentOf(chatId);
  if (!row) return null;
  const phase = phaseOf(row);
  const k = kindOf(row.kind);
  // 进行中才带今天的安排。时段与「去过了没有」一并写出来 ——
  // 去过的不删掉，删了它下午还会再提一次
  const n = dayIndex(row);
  const order = SLOTS.map(s => s.id);
  const plan = n ? planOf(row.id)
    .filter(p => (p.day || 0) === n)
    .sort((a, b) => (order.indexOf(a.slot) - order.indexOf(b.slot)) || (a.at - b.at))
    .map(p => `${p.slot ? `${slotLabel(p.slot)} ` : ''}${p.title}`
      + `${p.done ? '（已去过）' : ''}`)
    : [];
  return {
    plan,
    kind: k.label,
    title: row.title,
    place: row.place,
    venue: row.venue,
    phase: PHASES[phase],
    from: row.from,
    to: row.to,
    days: nights(row),
    until: daysUntil(row),
    dayIndex: dayIndex(row),
    agreed: row.agreed,
    note: row.note,
  };
}

/** 角色卡上的开关。和别的能力一样，默认开着。 */
export const onFor = char => !!char && char.canTrip !== false;
