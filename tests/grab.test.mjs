// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 出行第三批：抢票。概率是算出来的，票会被抢光，加价跟着供需比走。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
let calls = 0;
await page.route('**/v1/messages', async route => { calls += 1; await route.abort(); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const ledger = await import('/src/system/ledger.js');
  const t = await import('/src/system/trip.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  const bk = ledger.create({ name: '我们的账', chatId: chat.id });
  ledger.ensureJoint(bk.id);
  const joint = ledger.defaultFor(bk.id, ledger.JOINT);
  ledger.add({ bookId: bk.id, accountId: joint.id, amount: 200000, note: '存入' });
  const show = t.create({ chatId: chat.id, title: '某乐队巡演', place: '东京',
    venue: '东京巨蛋', kind: t.SHOW });
  // 一场两档：38 万人抢 4.6 万张
  t.addTickets(show.id, [
    { kind: 'showticket', title: '某乐队巡演', at: '2026-11-08 18:00', seat: '内场 A',
      face: 1580, qty: 2, capacity: 46000, demand: 380000, share: 0.08, heat: 0.9, need: true },
    { kind: 'showticket', title: '某乐队巡演', at: '2026-11-08 18:00', seat: '看台 D',
      face: 380, qty: 2, capacity: 46000, demand: 380000, share: 0.45, heat: 0.3, need: true },
  ], 'search');
  // 一场不紧张的：500 人的场，600 人想看
  const small = t.create({ chatId: chat.id, title: '小型现场', place: '本地',
    venue: 'livehouse', kind: t.SHOW });
  t.addTickets(small.id, [
    { kind: 'showticket', title: '小型现场', at: '2026-10-05 20:00', seat: '站票',
      face: 200, qty: 2, capacity: 500, demand: 600, share: 1, heat: 0.5, need: true },
  ], 'search');
  const tks = t.ticketsOf(show.id);
  return { a: a.id, chat: chat.id, bk: bk.id, joint: joint.id,
    show: show.id, small: small.id,
    inner: tks.find(x => x.seat === '内场 A').id,
    stand: tks.find(x => x.seat === '看台 D').id,
    tiny: t.ticketsOf(small.id)[0].id };
});
const G = (fn, ...args) => page.evaluate(async ([f, rest]) => {
  const g = await import('/src/system/grab.js');
  const t = await import('/src/system/trip.js');
  const ledger = await import('/src/system/ledger.js');
  // eslint-disable-next-line no-new-func
  return new Function('g', 't', 'ledger', '...a', `return (${f})(g, t, ledger, ...a)`)(g, t, ledger, ...rest);
}, [fn.toString(), args]);
const go = async r => {
  await page.evaluate(async ([y]) => {
    const n = await import('/src/system/nav.js');
    n.openApp('travel', y);
    if (y === '/') n.popToRoot();
  }, [r]);
  await page.waitForTimeout(700);
};
const txt = () => page.evaluate(() => document.body.innerText);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 供需比算出来的概率 ----
const inner = await G((g, t, l, s, i) => g.oddsOf(s, i), ids.show, ids.inner);
const stand = await G((g, t, l, s, i) => g.oddsOf(s, i), ids.show, ids.stand);
check(inner.pool === 2944, `内场放票 46000 × 0.8 × 8% = ${inner.pool} 张`);
check(stand.pool === 16560, `看台放票 = ${stand.pool} 张`);
// 想看的人按 share × (0.5 + heat) 在两档之间分
check(inner.rivals + stand.rivals === 380000,
  `38 万人分到两档里，不多不少（${inner.rivals} + ${stand.rivals}）`);
check(inner.rivals > 85000 && inner.rivals < 95000,
  `内场虽然只占 8% 的票，却吸走约 ${inner.rivals} 人（heat 高）`);
check(inner.p1 < 0.04 && inner.p1 > 0.03,
  `内场一场下来抢到的概率 ${(inner.p1 * 100).toFixed(1)}% —— 抢不到是算术`);
check(stand.p1 > inner.p1, `看台好抢一些（${(stand.p1 * 100).toFixed(1)}%）`);
check(!inner.easy && !stand.easy, '这一场两档都要抢');

const tiny = await G((g, t, l, s, i) => g.oddsOf(s, i), ids.small, ids.tiny);
check(tiny.easy === false && tiny.ratio > 1 && tiny.p1 > 0.6,
  `500 人的场 600 人想看：概率 ${(tiny.p1 * 100).toFixed(0)}%，不至于抢不到`);

// 点满八次的累计概率正好是一场下来那个数
const cum = 1 - (1 - inner.each) ** 8;
check(Math.abs(cum - inner.p1) < 1e-9,
  `每次 ${(inner.each * 100).toFixed(2)}%，点满八次累计正好等于一场下来那个数`);

// ---- 2 搜不到人数就不算概率，也不拿默认值凑 ----
const blind = await G((g, t, l, s) => {
  const row = t.addTickets(s, [{ kind: 'showticket', title: '无从得知', face: 100, need: true }], 'search');
  return g.oddsOf(s, row[0].id);
}, ids.show);
check(blind === null, '没有场馆容量与想看人数时返回空，不编一个概率出来');

// ---- 3 票会被抢光：不是限制次数 ----
const drain = await G((g, t, l, s, i) => {
  const out = [];
  for (let k = 0; k < 10; k += 1) {
    const r = g.grabOnce(s, i, { random: () => 0.999 });   // 每次都抢不中
    out.push(r.left);
    if (r.reason === 'soldout') break;
  }
  return { out, st: t.ticketOf(s, i).state };
}, ids.show, ids.inner);
check(drain.out[0] < inner.pool && drain.out.every((v, k, arr) => k === 0 || v <= arr[k - 1]),
  `每抢一次余票就少一些（${drain.out.join(' -> ')}）`);
check(drain.out[drain.out.length - 1] === 0 && drain.st === 'missed',
  '抢到票没了为止，状态转成未购得');

// ---- 4 抢中就扣钱 ----
const got = await G((g, t, l, s, i, bk, j) => {
  g.retry(s, i);
  t.updateTicket(s, i, { tries: 0 });
  const was = l.balanceOf(bk, j);
  const r = g.grabOnce(s, i, { random: () => 0 });          // 必中
  return { r, was, now: l.balanceOf(bk, j), st: t.ticketOf(s, i).state,
    paid: t.ticketOf(s, i).paid, n: t.entriesOf(s).length };
}, ids.show, ids.inner, ids.bk, ids.joint);
check(got.r.ok && got.st === 'bought' && got.was - got.now === 3160 && got.paid === 3160,
  `抢中当场从共同账户扣 1580 × 2（${JSON.stringify(got)}）`);
check(got.n === 1, '账本里落了一笔');

// ---- 5 余额不够就不让抢 ----
const broke = await G((g, t, l, s, i, bk, j) => {
  t.refundTicket(s, i);
  g.retry(s, i);
  t.updateTicket(s, i, { tries: 0 });
  const bal = l.balanceOf(bk, j);
  l.add({ bookId: bk, accountId: j, amount: -(bal - 100), note: '花光' });
  try { g.grabOnce(s, i, { random: () => 0 }); return 'ok'; }
  catch (e) { return String(e.message); }
}, ids.show, ids.inner, ids.bk, ids.joint);
check(/余额不足/.test(broke), `抢之前先看钱够不够（${broke}）`);
check(await G((g, t, l, s, i) => t.ticketOf(s, i).tries, ids.show, ids.inner) === 0,
  '被拦下的那一次不算一次尝试，余票没动');

// ---- 6 加价：倍数跟着供需比走 ----
const times = await G((g) => [
  g.resaleTimes(1.0), g.resaleTimes(1.5), g.resaleTimes(10), g.resaleTimes(30.6), g.resaleTimes(1000),
]);
check(times[0] === 1, '供需持平不加价');
check(times[1] > 1 && times[1] < 1.5, `一点五倍超额只加一成多（${times[1]} 倍）`);
check(times[3] > 6 && times[3] < 9, `三十倍超额开到 ${times[3]} 倍，是天价那一档`);
check(times[4] === 20, '再高也钳在 20 倍，那已经是买不起而不是买得贵');
check(times[1] < times[2] && times[2] < times[3], '倍数随供需比单调上升');

const resale = await G((g, t, l, s, i, bk, j) => {
  l.add({ bookId: bk, accountId: j, amount: 200000, note: '存入' });
  const was = l.balanceOf(bk, j);
  const miss = g.buyResale(s, i, { random: () => 0.99 });   // 被人先买走
  const balAfterMiss = l.balanceOf(bk, j);
  const hit = g.buyResale(s, i, { random: () => 0 });
  return { miss, balAfterMiss, was, now: l.balanceOf(bk, j), hit,
    paid: t.ticketOf(s, i).paid };
}, ids.show, ids.inner, ids.bk, ids.joint);
check(!resale.miss.ok && resale.balAfterMiss === resale.was,
  '转售没买到不扣钱');
check(resale.hit.ok && resale.paid === Math.round(1580 * 2 * resale.hit.times * 100) / 100,
  `买到了按倍数扣（${resale.hit.times} 倍，共 ${resale.paid}）`);

// ---- 7 开售时刻：没到点抢不了 ----
const sale = await G((g, t, l, s) => {
  const soon = new Date(Date.now() + 3600000).toISOString().slice(0, 16).replace('T', ' ');
  const row = t.addTickets(s, [{ kind: 'showticket', title: '未开售的一场', face: 500,
    capacity: 1000, demand: 5000, share: 1, heat: 0.5, saleAt: soon, need: true }], 'search');
  const id = row[0].id;
  const open = g.saleOpen(t.ticketOf(s, id));
  let err = '';
  try { g.grabOnce(s, id, { random: () => 0 }); } catch (e) { err = String(e.message); }
  return { open, err, until: g.untilSale(t.ticketOf(s, id)) };
}, ids.show);
check(sale.open === false && /尚未开售/.test(sale.err), '开售时刻没到就抢不了');
check(sale.until > 3500000 && sale.until <= 3600000, `倒计时算得出来（${Math.round(sale.until / 1000)} 秒）`);
check(await G((g, t, l, s) => {
  const id = t.ticketsOf(s).find(x => x.title === '未开售的一场').id;
  return g.saleOpen({ ...t.ticketOf(s, id), saleAt: '' });
}, ids.show), '搜不到开售时刻的按随时可买处理');

// ---- 8 全程不调接口 ----
check(calls === 0, `抢票这一整套一次接口都没调（${calls}）`);

// ---- 9 界面：把算出来的数摆出来，不写形容 ----
await G((g, t, l, s, i) => { t.refundTicket(s, i); g.retry(s, i); t.updateTicket(s, i, { tries: 0 }); },
  ids.show, ids.inner);
await go(`/grab/${ids.show}/${ids.inner}`);
let body = await txt();
check(/本档放票/.test(body) && /约 2944 张/.test(body), '摆出本档放票数');
check(/抢这一档的人/.test(body) && /按想看 380000 人分摊/.test(body), '摆出抢的人数与依据');
check(/一场下来 3\.\d%/.test(body), '摆出一场下来抢到的概率');
check(/不是估计值/.test(body), '写明这个数是算出来的');
check(!/很难|不好抢|几乎抢不到/.test(body), '不写「很难抢」这种形容');
await page.screenshot({ path: `${OUT}/grab.png` });

await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.trim() === '抢票').click());
await page.waitForTimeout(4200);
body = await txt();
check(/本档剩余|已购得|已售罄|未能购得|支付未在时限内/.test(body), '抢一次之后把结果写在记录里');

// ---- 10 票列表里点得进来 ----
await go(`/tickets/${ids.show}`);
body = await txt();
check(/抢到的概率/.test(body), '列表里每一条也带着算出来的概率');
const grabBtn = await page.evaluate(() => [...document.querySelectorAll('.list-item button')]
  .filter(b => b.innerText.trim() === '抢票').length);
check(grabBtn >= 2, `演出票那几条都有抢票入口（${grabBtn} 个）`);

// ---- 11 自己输入要查什么 ----
body = await txt();
check(/检索内容/.test(body), '有一个自己填检索内容的输入框');
const filled = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.field-label')];
  const f = labels.find(x => x.innerText.includes('检索内容'));
  return f?.parentElement?.querySelector('input')?.value || '';
});
check(/某乐队巡演/.test(filled) && /东京巨蛋/.test(filled),
  `默认填的是这次出行上已有的信息（${filled}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
