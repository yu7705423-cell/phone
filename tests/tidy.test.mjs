// 两件：表情多选归类、抢票一次跑完整场。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);
const txt = () => page.evaluate(() => document.querySelector('.app-layer').innerText);

// ---- 表情：先造八个，散在两组里 ----
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const st = await import('/src/system/stickers.js');
  for (let i = 0; i < 5; i++) db.stickers.create({ name: `甲${i}`, url: `https://x/${i}.png`, group: '默认', useCount: 0 });
  for (let i = 0; i < 3; i++) db.stickers.create({ name: `乙${i}`, url: `https://y/${i}.png`, group: '旧组', useCount: 0 });
  st.addGroup('新组');
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat', '/stickers');
});
await page.waitForTimeout(800);
check(/整理分组/.test(await txt()), '管理页上有「整理分组」这个入口');

await page.getByText('整理分组', { exact: true }).first().click();
await page.waitForTimeout(500);
let body = await txt();
check(/整理分组 · 已选 0/.test(body), `进了整理模式，标题写着选了几个（${body.split('\n')[0]}）`);
check(/全选/.test(body), '每个分组旁边有全选');

// 全选「旧组」那三个
await page.evaluate(() => {
  const head = [...document.querySelectorAll('.stk-group-head')].find(e => e.innerText.startsWith('旧组'));
  head.querySelector('button').click();
});
await page.waitForTimeout(400);
check(/已选 3/.test(await txt()), `按分组全选（${(await txt()).split('\n')[0]}）`);
const litUp = await page.locator('.stk-cell.is-picked').count();
check(litUp === 3, `选中的三个在界面上标出来了（${litUp} 个）`);

// 再点一个「默认」组里的
await page.evaluate(() => {
  const wrap = [...document.querySelectorAll('.list-wrap')]
    .find(e => e.querySelector('.stk-group-head')?.innerText.startsWith('默认'));
  wrap.querySelectorAll('.stk-cell')[0].click();
});
await page.waitForTimeout(400);
check(/已选 4/.test(await txt()), '单个点选也累加');

// 移入「新组」
await page.getByText('移入分组', { exact: true }).first().click();
await page.waitForTimeout(500);
await page.evaluate(() => {
  [...document.querySelectorAll('.chip')].find(c => c.innerText.trim() === '新组').click();
});
await page.waitForTimeout(600);
const after = await page.evaluate(async () => {
  const st = await import('/src/system/stickers.js');
  return { xin: st.inGroup('新组').length, jiu: st.inGroup('旧组').length, mo: st.inGroup('默认').length };
});
check(after.xin === 4 && after.jiu === 0 && after.mo === 4,
  `四个都挪过去了（${JSON.stringify(after)}）`);
check(!/整理分组 · 已选/.test(await txt()), '移完退出整理模式');

// ---- 抢票：一次跑完 ----
const g = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const trip = await import('/src/system/trip.js');
  const grab = await import('/src/system/grab.js');
  const L = await import('/src/system/ledger.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '同行者' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  const b = L.create({ name: '共同', chatId: chat.id });
  const acct = L.ensureJoint(b.id);
  L.add({ bookId: b.id, accountId: acct.id, amount: 500000, category: 'salary', at: Date.now() });
  const row = trip.create({ chatId: chat.id, title: '看一场演出' });
  // 三个月后才开售，容量与想看人数都有 —— 逐次点击要等三个月
  const saleAt = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 16).replace('T', ' ');
  const [t] = trip.addTickets(row.id, [{
    title: '某场演出', kind: 'showticket', face: 680, qty: 2,
    capacity: 12000, demand: 90000, share: 0.3, heat: 0.7, saleAt,
  }]);
  return { trip: row.id, ticket: t.id, chat: chat.id,
    open: grab.saleOpen(t), odds: grab.oddsOf(row.id, t.id) };
});
check(!g.open && !!g.odds, `票还没开售，但账算得出来（${JSON.stringify(g.odds && {pool:g.odds.pool, rivals:g.odds.rivals})}）`);

const r = await page.evaluate(async ([tripId, ticketId]) => {
  const grab = await import('/src/system/grab.js');
  let threw = '';
  try { grab.grabOnce(tripId, ticketId); } catch (e) { threw = e.message; }
  // 一定抢得到的那一版：骰子永远是 0
  const sure = grab.simulate(tripId, ticketId, { random: () => 0 });
  const trip = await import('/src/system/trip.js');
  return { threw, sure, state: trip.ticketOf(tripId, ticketId).state, bought: trip.BOUGHT };
}, [g.trip, g.ticket]);
check(/尚未开售/.test(r.threw), '逐次点击仍然要等开售时刻');
check(r.sure.ok && r.sure.tries === 1, `模拟不等开售，第一次就中（${JSON.stringify(r.sure)}）`);
check(r.state === r.bought, '中了就落成已购得');

const r2 = await page.evaluate(async ([chatId]) => {
  const db = await import('/src/system/db/index.js');
  const trip = await import('/src/system/trip.js');
  const grab = await import('/src/system/grab.js');
  const row = trip.create({ chatId, title: '再看一场' });
  const [t] = trip.addTickets(row.id, [{
    title: '很难抢的那场', kind: 'showticket', face: 100, qty: 1,
    capacity: 3000, demand: 300000, share: 1, heat: 1,
  }]);
  // 骰子永远是 1：一次都中不了，只能一直抢到售罄
  const bad = grab.simulate(row.id, t.id, { random: () => 1 });
  const left = grab.oddsOf(row.id, t.id)?.left;
  return { bad, left, state: trip.ticketOf(row.id, t.id).state, missed: trip.MISSED,
    tries: trip.ticketOf(row.id, t.id).tries };
}, [g.chat]);
check(!r2.bad.ok && r2.bad.tries > 1, `抢不到的那种会一路抢到售罄（试了 ${r2.bad.tries} 次）`);
check(r2.left === 0 && r2.state === r2.missed, '售罄之后余票归零，状态落成没抢到');
check(r2.tries === r2.bad.tries, '每一次都如实记在票上，和逐次点击是同一套账');

// 界面上那个按钮。上面两张一张已购得、一张已售罄，都不该再显示它，
// 所以另开一张还没动过的
const fresh = await page.evaluate(async ([chatId]) => {
  const trip = await import('/src/system/trip.js');
  const row = trip.create({ chatId, title: '第三场' });
  const [t] = trip.addTickets(row.id, [{
    title: '还没抢过的那场', kind: 'showticket', face: 300, qty: 1,
    capacity: 8000, demand: 40000, share: 1, heat: 1,
    saleAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16).replace('T', ' '),
  }]);
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('travel', `/grab/${row.id}/${t.id}`);
  return { trip: row.id, ticket: t.id };
}, [g.chat]);
await page.waitForTimeout(800);
let gbody = await txt();
check(/立即模拟抢票/.test(gbody), `抢票页上有这个按钮（${gbody.slice(0, 60).replace(/\n/g, ' ')}）`);
check(/天后开售/.test(gbody), '逐次点击那个按钮仍然写着还有多久开售');

// 已经买到的那张不该再显示它
await page.evaluate(async ([tripId, ticketId]) => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('travel', `/grab/${tripId}/${ticketId}`);
}, [g.trip, g.ticket]);
await page.waitForTimeout(700);
check(!/立即模拟抢票/.test(await txt()), '已经买到的那张不再显示模拟');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
