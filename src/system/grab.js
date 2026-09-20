import * as trip from './trip.js';
import * as ledger from './ledger.js';

// 抢票。
//
// ---- 概率是算出来的，不是问来的 ----
//
// 随机事件那一节立过一条：**点数、距离、金额不是模型的活**。抢不抢得到
// 同理。搜索只负责带回四个查得到的数字（见 system/trip.js 的票那一段）：
//
//     capacity  场馆能坐多少
//     demand    多少人想看
//     share     这一档占总票数的比例
//     heat      这一档比别档抢手多少
//
// 剩下的全在这个文件里算。交给模型「这场好不好抢」，它给的是它的印象，
// 换个措辞就换个答案；38 万人抢 4.6 万张票，算出来的那个数不会变。
//
// ---- 稀缺是真的，不是次数上限 ----
//
// 第 13 条说能力不设上限。所以这里**不限制点几次**，而是让票真的被抢光：
// 每抢一次，这一档的余票按供需比往下掉，掉到零就没有了。你爱点几次点几次，
// 但票是有限的 —— 这是确定性的稀缺，不是一道人为的门。
//
// ---- 为什么用模拟时间而不是真实时间 ----
//
// 现实里票是被别人按真实时间抢走的。这里按**每点一次推进一段**来算：
//
//   一、结果可复现、测得出来。按真实时间算，同一次抢票在快手机和慢手机上
//       不是一回事，而这件事和设备快慢无关。
//   二、真实抢票里决定成败的是运气和服务器，不是谁点得快。让手速起决定作用
//       反而更假。
//
// ---- 一场下来抢到的概率就是票数除以人数 ----
//
// `p1 = 这一档的票数 / 抢这一档的人数`。把它摊到窗口内的 TRIES 次尝试上，
// 使**点满为止的累计概率正好等于 p1**：点得少就低于它，点满也不会超过它。
// 于是「多点几次有用」和「热门的就是抢不到」同时成立。

// 实际放出来的比例。内部预留、工作票、套票不在公开发售里
const SALE = 0.8;

// 一档票从开抢到售罄，值得尝试的次数。**不是上限**：它是「票按这个速度
// 被抢完」的另一种写法，第 TRIES 次之后余票为零，和别人抢光了是一回事。
const TRIES = 8;

// 供需比低于这个数就不必抢了：票比想要的人多出两成，正常买得到
export const EASY = 1.2;

// 转售最高溢价。再高也没有意义，那已经是「买不起」而不是「买得贵」
const MAX_TIMES = 20;

// 转售能不能买到。**不是必中** —— 会被别人先买走，也会遇到撤单
const RESALE_HIT = 0.75;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 同一场的各档。靠「名称 + 时刻」认 —— 一场演出的几档票是分开的几条，
 * 但抢它们的是同一批人，所以人数要在这几档之间分。
 */
export const tiersOf = (tripId, t) => trip.ticketsOf(tripId)
  .filter(x => x.title === t.title && x.at === t.at && x.kind === t.kind);

/**
 * 这一档的账：多少票、多少人抢、一场下来抢到的概率、余票还有多少。
 *
 * 搜不到 capacity 或 demand 就返回 null —— **不拿默认值凑一个数**。
 * 不知道有多少人想看，就老实说不知道，界面照实写。
 */
export function oddsOf(tripId, ticketId) {
  const t = trip.ticketOf(tripId, ticketId);
  if (!t || !t.capacity || !t.demand) return null;

  const share = t.share || 1;
  const pool = Math.max(1, Math.round(t.capacity * SALE * share));

  // 想看的人按各档的抢手程度分。heat 搜不到就按票数比例平分
  const weigh = x => (x.share || 1) * (0.5 + (x.heat || 0.5));
  const tiers = tiersOf(tripId, t);
  const total = tiers.reduce((n, x) => n + weigh(x), 0) || weigh(t);
  const rivals = Math.max(1, Math.round(t.demand * (weigh(t) / total)));

  const ratio = rivals / pool;
  const p1 = clamp(pool / rivals, 0, 1);
  const tries = Math.max(0, t.tries || 0);
  const left = Math.max(0, Math.round(pool * (1 - tries / TRIES)));

  return {
    pool, rivals, ratio, p1, left, tries,
    // 每一次的概率。点满 TRIES 次，累计正好是 p1
    each: p1 >= 1 ? 1 : 1 - (1 - p1) ** (1 / TRIES),
    easy: ratio <= EASY,
    times: resaleTimes(ratio),
  };
}

/**
 * 转售溢价倍数。**跟着供需比走**，不是一个拍出来的数。
 *
 *     供需比 1.5   1.3 倍   加一点就买得到
 *     供需比 10    4.0 倍
 *     供需比 30    7.7 倍   开天价的那一档
 *
 * 用 0.6 次方而不是线性：线性的话三十倍供需比会算出三十倍票价，
 * 而真实的黄牛价是随供需上涨但涨得比它慢的。
 */
export function resaleTimes(ratio) {
  if (!(ratio > 1)) return 1;
  return Math.round(clamp(ratio ** 0.6, 1, MAX_TIMES) * 10) / 10;
}

/** 开售了没有。saleAt 空着就是随时可买（搜不到开售时刻的那些）。 */
export function saleOpen(t, now = Date.now()) {
  const raw = String(t?.saleAt || '').trim();
  if (!raw) return true;
  const ms = Date.parse(raw.replace(' ', 'T'));
  return Number.isNaN(ms) ? true : now >= ms;
}

/** 还有多久开售，毫秒。已经开售或没有开售时刻都返回 0。 */
export function untilSale(t, now = Date.now()) {
  const raw = String(t?.saleAt || '').trim();
  if (!raw) return 0;
  const ms = Date.parse(raw.replace(' ', 'T'));
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, ms - now);
}

// ---- 抢不到，有好几种抢不到 ----
//
// 真实的抢票不是一次「中/不中」。**多数人根本没走到抽签那一步**：
// 点进去一直转圈，排队排不进去，好不容易进去了提交时票已经没了。
// 只回一句「未抢到」，把这段经历里最难受的部分抹平了。
//
// 所以一次尝试分四关，每一关都可能栽在那儿：
//
//   进门   排队人数过多 / 页面响应超时   —— 连抽签的资格都没拿到
//   余票   提交的时候这一档刚好没了
//   抽签   提交成功，没中
//   支付   订单生成了，支付没在时限内完成，票被放回
//
// **每一关的概率都是从供需比算出来的**，不是拍脑袋给的定值 —— 和「抢到的
// 概率」同一个出处（见文件开头那段）。人越多，卡在门口的比例越高，这正是
// 大麦上那种「一直加载」的来历：不是网差，是同时有三十万人在点同一个按钮。
//
// 栽在哪一关都算用掉一次尝试，余票照样往下掉 —— 你卡在门口的这几秒，
// 别人买走了。这一条不能松：松了就成了「慢慢点总能点到」。

/** 挤成什么样。供需比 1 是不挤，比值越大越挤，上不封顶但收敛到 1。 */
export const pressure = ratio => (ratio > 1 ? 1 - 1 / ratio : 0);

/** 各关的失败率。系数是这几关的相对权重，乘上挤的程度。 */
const DOOR_QUEUE = 0.5;   // 挤到极致时，一半的尝试连页面都打不开
const DOOR_SLOW = 0.2;    // 再有两成是转圈转到超时
const PAY_DROP = 0.08;    // 中了也可能付不上，这一关最轻

/** 每种结果在界面上怎么说。写成购票页会说的那种话。 */
export const REASONS = {
  queue: '排队人数过多，未能进入购票页',
  slow: '页面响应超时，本次尝试未能提交',
  gone: '提交时本档已无余票',
  miss: '提交成功，未能购得',
  pay: '订单已生成，支付未在时限内完成，票已放回',
  soldout: '本档已售罄',
  got: '已购得，款项已从共同账户扣除',
};
export const reasonText = r => REASONS[r] || '未购得';

/**
 * 抢一次。
 *
 * **不调接口**，掷几次骰子而已，所以次数不设上限、也不进 EXTRA_CALLS。
 *
 * 抢中直接扣钱（和直接购买同一条路），所以**抢之前先看余额** ——
 * 抢到了却付不起，那张票要么凭空作废要么挂成第三种状态，两样都更糟。
 *
 * 返回 { ok, left, reason, stage }。stage 是栽在哪一关，界面拿它画过程。
 */
export function grabOnce(tripId, ticketId, { random = Math.random, ignoreSale = false } = {}) {
  const row = trip.get(tripId);
  const t = trip.ticketOf(tripId, ticketId);
  if (!row || !t) throw new Error('这张票已经不在了');
  if (t.state === trip.BOUGHT) throw new Error('这张票已经买到了');
  if (!ignoreSale && !saleOpen(t)) throw new Error('尚未开售');

  const odds = oddsOf(tripId, ticketId);
  if (!odds) throw new Error('未能检索到场馆容量与想看人数，无法抢票');
  if (odds.left <= 0) {
    trip.updateTicket(tripId, ticketId, { state: trip.MISSED });
    return { ok: false, left: 0, reason: 'soldout' };
  }

  // 钱不够就不抢 —— 抢中是要当场扣的
  const cost = trip.costOf(t);
  const book = ledger.bookOfChat(row.chatId);
  const joint = book && ledger.defaultFor(book.id, ledger.JOINT);
  if (!book || !joint) throw new Error('这段对话还没有共同账户，先在「记账」中建立');
  if (ledger.strictOn(book) && ledger.balanceOf(book.id, joint.id) < cost) {
    throw new Error('共同账户余额不足，需要先存入');
  }

  const tries = (t.tries || 0) + 1;
  trip.updateTicket(tripId, ticketId, { tries });

  // 这一次栽在哪一关。**先掷门口那两关** —— 多数人就是卡在这儿的。
  //
  // 掷出来的数一律「小的走运」：抽签那一关是 random() >= each 才算没中，
  // 门口这两关也照这个方向写。不统一的话，同一个 random 在这个函数里
  // 一会儿代表运气好一会儿代表运气坏，测起来和读起来都要拐一道弯。
  const jam = pressure(odds.ratio);
  const door = random();
  const passQueue = 1 - jam * DOOR_QUEUE;
  const passSlow = passQueue - jam * DOOR_SLOW;
  const stuck = door >= passQueue ? 'queue' : door >= passSlow ? 'slow' : '';

  // 余票在这一次尝试之后还剩多少。卡在门口也算，别人照样在买
  const after = oddsOf(tripId, ticketId);
  const left = after?.left ?? 0;
  const dry = () => {
    trip.updateTicket(tripId, ticketId, { state: trip.MISSED });
    return { ok: false, left: 0, reason: 'soldout', stage: 'soldout' };
  };

  if (stuck) {
    if (left <= 0) return dry();
    return { ok: false, left, reason: stuck, stage: stuck };
  }
  // 进得去，但提交的那一刻这一档刚好没了
  if (left <= 0) return { ...dry(), reason: 'gone' };

  if (random() >= odds.each) return { ok: false, left, reason: 'miss', stage: 'draw' };

  // 中了。最后还有支付这一关 —— 没付上票就放回去，不扣钱
  if (random() > 1 - jam * PAY_DROP) {
    return { ok: false, left, reason: 'pay', stage: 'pay' };
  }

  trip.buyTicket(tripId, ticketId);
  return { ok: true, left: oddsOf(tripId, ticketId)?.left ?? 0, reason: 'got', stage: 'got' };
}

/**
 * 一次跑完整场。
 *
 * 和连点「抢票」到底是同一件事，同一套概率、同一套扣款 —— 只是不必真的
 * 点上几十下，也不必等到开售时刻。**开售时刻在这里是不作数的**：
 * 一场三个月后的演出，逐次点击要等三个月才点得动，而这台手机上的三个月
 * 不会真的过去。
 *
 * 不设次数上限（第 13 条）：跑到抢到、或者本档售罄为止。这个循环一定会停，
 * 因为每跑一次余票都在掉，第 TRIES 次之后就是零。下面那个 10000 是防跑飞的
 * 保险，不是给用户的门 —— TRIES 是几十的量级，正常永远碰不到它。
 */
export function simulate(tripId, ticketId, { random = Math.random } = {}) {
  let tries = 0;
  let last = null;
  while (tries < 10000) {
    const before = oddsOf(tripId, ticketId);
    if (!before) throw new Error('未能检索到场馆容量与想看人数，无法抢票');
    if (before.left <= 0) break;
    last = grabOnce(tripId, ticketId, { random, ignoreSale: true });
    tries += 1;
    if (last.ok || last.reason === 'soldout') break;
  }
  return {
    ok: !!last?.ok, tries,
    left: last?.left ?? (oddsOf(tripId, ticketId)?.left ?? 0),
    reason: last?.ok ? 'got' : 'soldout',
  };
}

/**
 * 加价从转售买。倍数由供需比算（resaleTimes），**也不是必中** ——
 * 会被别人先买走。买不到不扣钱。
 */
export function buyResale(tripId, ticketId, { random = Math.random } = {}) {
  const t = trip.ticketOf(tripId, ticketId);
  if (!t) throw new Error('这张票已经不在了');
  if (t.state === trip.BOUGHT) throw new Error('这张票已经买到了');
  const odds = oddsOf(tripId, ticketId);
  if (!odds) throw new Error('未能检索到场馆容量与想看人数，无法估算转售价');

  if (random() >= RESALE_HIT) return { ok: false, reason: 'taken' };
  trip.buyTicket(tripId, ticketId, { times: odds.times });
  return { ok: true, reason: 'got', times: odds.times };
}

/** 不抢了。留着记录，可以再改回去。 */
export const giveUp = (tripId, ticketId) =>
  trip.updateTicket(tripId, ticketId, { state: trip.GIVENUP });

export const retry = (tripId, ticketId) =>
  trip.updateTicket(tripId, ticketId, { state: trip.FOUND });
