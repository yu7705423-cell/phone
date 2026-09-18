// 带权重的抽取，外加一点「刚抽过的先缓缓」的记性。
//
// 随机事件要用它，吃饭要用它，以后再有什么要随机挑一个的都用它。
// 单拎出来是因为三件事每次都得一起做，分开写迟早走岔：
//
//   1. **按权重抽**。不是均匀抽 —— 常见的事本来就该常发生。
//   2. **刚抽过的压一压**。同一件事连着出现三次就假了。
//   3. **压一压，不是封杀**。喜欢的菜本来就该常吃，问十次全是同一道才不对；
//      所以罚分随着时间自己退回去，而不是把它从池子里踢出来。
//
// 随机源可以从外面传进来。默认是 Math.random，测试里换成定死的序列，
// 于是「抽中了什么」这件事本身是可测的 —— 这也是本项目的一贯做法：
// **数字不是模型的活**（见 ARCHITECTURE 4.678），随机数更不是。

const clamp0 = n => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * 刚抽过的那几个，权重打几折。
 *
 * recent 是抽中过的 id，**新的在前**。排在第 0 位的（上一次刚抽中）罚得最狠，
 * 越往后罚得越轻，退出 cooldown 个之后就完全恢复。
 * 罚分永远大于 0：压一压，不是封杀。
 */
export function penalty(id, recent = [], cooldown = 0) {
  if (!cooldown || !recent.length) return 1;
  const i = recent.indexOf(id);
  if (i < 0 || i >= cooldown) return 1;
  return (i + 1) / (cooldown + 1);
}

/**
 * 抽一个。
 *
 * items    候选。每个至少要有 id。
 * weightOf 这一项本来多重，默认读 item.weight，没写就是 1。
 * recent   最近抽中过的 id，新的在前。
 * cooldown 往回压这么多个。0 表示不压。
 * rng      返回 [0, 1) 的随机数。
 *
 * 全都是 0 权重就返回 null —— 没有「随便给一个」这种兜底，
 * 那样会把「这个格子是空的」悄悄变成「抽到了一个不该抽的」。
 */
export function pick(items, { weightOf, recent = [], cooldown = 0, rng = Math.random } = {}) {
  const w = typeof weightOf === 'function' ? weightOf : (it => it.weight);
  let total = 0;
  const rows = [];
  for (const it of items || []) {
    const base = clamp0(w(it) ?? 1);
    if (!base) continue;
    const weight = base * penalty(it.id, recent, cooldown);
    if (!weight) continue;
    total += weight;
    rows.push({ it, weight });
  }
  if (!total) return null;

  let r = rng() * total;
  for (const row of rows) {
    r -= row.weight;
    if (r < 0) return row.it;
  }
  return rows[rows.length - 1].it;   // 浮点误差兜底
}

/**
 * 掷一次，看这件事发不发生。chance 是概率，超出 [0,1] 会被夹回来 ——
 * 那是算术，不是给用户设的上限。
 */
export function roll(chance, rng = Math.random) {
  const p = Math.min(1, Math.max(0, Number(chance) || 0));
  return rng() < p;
}

/**
 * 距上次越久越该来一次。days 是距上次过去了几天，slope 是每多一天加多少。
 * 当天刚发生过就是基础概率本身。
 */
export function overdue(base, days, slope = 0.35) {
  const d = Math.max(0, (Number(days) || 0) - 1);
  return Math.min(1, Math.max(0, (Number(base) || 0) * (1 + slope * d)));
}

/**
 * 一个有惯性的慢变量，用来做「大运」这种走势。
 *
 * 每次挪一小步，而且记着上一次在哪儿 —— 直接每天重掷一个随机数的话，
 * 今天大吉明天大凶，那不叫运势，那叫噪声。
 *
 * keep 越大越粘着上一次；span 是随机那一下能推多远；range 是上下界。
 */
export function drift(cur, { keep = 0.7, span = 1.2, range = 2, rng = Math.random } = {}) {
  const now = Number(cur) || 0;
  const push = (rng() * 2 - 1) * span;
  const next = now * keep + push;
  return Math.max(-range, Math.min(range, Math.round(next * 100) / 100));
}
