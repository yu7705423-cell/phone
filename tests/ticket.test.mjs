// 出行第二批：搜真实价格、买票扣共同账户、要抢的那几种这一批先不卖。
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

// 模型在网络那一层假掉。记下每次请求用的是哪一套预设与什么 system
let calls = [];
let reply = null;
await page.route('**/v1/messages', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  calls.push({ sys: String(body.system || ''), model: body.model });
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] }) });
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const ledger = await import('/src/system/ledger.js');
  const t = await import('/src/system/trip.js');
  const svc = await import('/src/system/ai/services.js');
  svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  const bk = ledger.create({ name: '我们的账', chatId: chat.id });
  ledger.ensureJoint(bk.id);
  const joint = ledger.defaultFor(bk.id, ledger.JOINT);
  ledger.add({ bookId: bk.id, accountId: joint.id, amount: 5000, note: '存入' });
  const tr = t.create({ chatId: chat.id, title: '京都', place: '京都', kind: t.TRIP });
  const show = t.create({ chatId: chat.id, title: '某乐队巡演', place: '东京',
    venue: '东京巨蛋', kind: t.SHOW });
  return { a: a.id, chat: chat.id, bk: bk.id, joint: joint.id, tr: tr.id, show: show.id };
});
const T = (fn, ...args) => page.evaluate(async ([f, rest]) => {
  const t = await import('/src/system/trip.js');
  const ledger = await import('/src/system/ledger.js');
  // eslint-disable-next-line no-new-func
  return new Function('t', 'ledger', '...a', `return (${f})(t, ledger, ...a)`)(t, ledger, ...rest);
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

// ---- 1 没配联网接口：说清楚，并且退回估算那一档 ----
await go(`/tickets/${ids.tr}`);
let body = await txt();
check(/尚未配置会联网搜索的接口/.test(body), '没配联网接口时如实说明');
check(/由模型估算/.test(body), '按钮写的是「由模型估算」，不假装在联网');

reply = { tickets: [
  { title: '往返机票', seat: '经济舱', face: 2400, note: '含税' },
  { title: '往返机票', seat: '公务舱', face: 9800, note: '含税' },
] };
calls = [];
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.trim() === '由模型估算').click());
await page.waitForTimeout(1400);
check(calls.length === 1, `估算也是一次请求（${calls.length}）`);
check(/no access to the\s+web/.test(calls[0].sys), '走的是估算那一份模板');
let rows = await T((t, l, id) => t.ticketsOf(id).map(x => `${x.seat}/${x.face}/${x.src}`), ids.tr);
check(JSON.stringify(rows) === JSON.stringify(['经济舱/2400/guess', '公务舱/9800/guess']),
  `两条都进来了，来源记成估算（${JSON.stringify(rows)}）`);
body = await txt();
check(/模型估算/.test(body), '列表里每一条都标着来源');

// ---- 2 配上联网接口：走搜索那一份，且带回客观数字 ----
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  svc.setSearch({ provider: 'anthropic', apiKey: 'k', model: 'web' });
});
await page.waitForTimeout(300);
const ready = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  return svc.searchReady();
});
check(ready, '联网预设配好了');

reply = { tickets: [{
  title: '某乐队巡演 东京巨蛋', at: '2026-11-08 18:00', seat: '内场 A',
  face: 1580, capacity: 46000, demand: 380000, share: 0.08, heat: 0.9,
  saleAt: '2026-10-01 10:00', note: '官方售票',
}, {
  title: '某乐队巡演 东京巨蛋', at: '2026-11-08 18:00', seat: '看台 D',
  face: 380, capacity: 46000, demand: 380000, share: 0.45, heat: 0.3,
  saleAt: '2026-10-01 10:00', note: '官方售票',
}] };
calls = [];
await go(`/tickets/${ids.show}`);
body = await txt();
check(/不是实时票价/.test(body), '联网这一档写明了不是实时票价');
check(/演出票/.test(body), '看演出这次出行默认找演出票');
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.trim() === '联网检索').click());
await page.waitForTimeout(1400);
check(calls.length === 1, `联网检索也是一次请求（${calls.length}）`);
check(/verified against\s+the web/.test(calls[0].sys), '走的是联网那一份模板');
check(/how many want them/i.test(calls[0].sys) && !/\{\{|is yes/.test(calls[0].sys),
  '场馆容量与想看人数一并问回来，模板里没有写坏的条件句');
check(/Do not state any probability/.test(calls[0].sys),
  '**不问概率**：只要查得到的数，抢不抢得到是本地算的');

const tks = await T((t, l, id) => t.ticketsOf(id).map(x => ({
  seat: x.seat, face: x.face, cap: x.capacity, dem: x.demand, share: x.share,
  need: x.need, src: x.src })), ids.show);
check(tks.length === 2 && tks[0].cap === 46000 && tks[0].dem === 380000
  && tks[0].share === 0.08 && tks[0].need === true && tks[0].src === 'search',
  `客观数字原样存下来了（${JSON.stringify(tks[0])}）`);
body = await txt();
check(/场馆容量 46000 人，想看 380000 人/.test(body), '界面把场馆容量与想看人数摆出来了');
check(/本档约占 8%/.test(body), '这一档占多少票也摆出来了');
// 概率显示的是**本地算出来的**那个。模型给的那一份请求里压根没问（见上一条）
check(/抢到的概率 \d/.test(body), '列表里带着本地算出来的概率');
await page.screenshot({ path: `${OUT}/ticket-show.png` });

// ---- 3 要抢的这一批不卖 ----
const btns = await page.evaluate(() => [...document.querySelectorAll('.list-item button')]
  .map(b => b.innerText.trim()).filter(Boolean));
check(!btns.includes('购买') && btns.includes('抢票'),
  `演出票走抢票，不是直接购买（${JSON.stringify(btns)}）`);
check(!/下一批|这一批/.test(body), '界面上不出现「这一批」这种开发用语');

// ---- 4 买一张：从共同账户扣，落一条带 tripId 的流水 ----
await go(`/tickets/${ids.tr}`);
const before = await T((t, l, bk, j) => l.balanceOf(bk, j), ids.bk, ids.joint);
await page.evaluate(() => {
  const li = [...document.querySelectorAll('.list-item')].find(e => e.innerText.includes('经济舱'));
  [...li.querySelectorAll('button')].find(b => b.innerText.trim() === '购买').click();
});
await page.waitForTimeout(600);
body = await txt();
check(/2 张，共/.test(body), '先说清楚买几张、一共多少钱');
await page.evaluate(() => [...document.querySelectorAll('.overlay button')]
  .find(b => b.innerText.trim() === '购买').click());
await page.waitForTimeout(800);
const after = await T((t, l, bk, j, id) => ({
  bal: l.balanceOf(bk, j),
  spent: t.spentOn(id),
  n: t.entriesOf(id).length,
  cat: t.entriesOf(id)[0]?.category,
  st: t.ticketsOf(id).find(x => x.seat === '经济舱').state,
}), ids.bk, ids.joint, ids.tr);
check(before - after.bal === 4800 && after.spent === 4800 && after.n === 1,
  `2400 × 2 从共同账户扣掉了（${JSON.stringify(after)}，之前 ${before}）`);
check(after.cat === 'transit', `记进账本已有的「交通」那一类，不另开一类（${after.cat}）`);
check(after.st === 'bought', '票转成已购买');

// ---- 5 余额不足不让买 ----
const poor = await T((t, l, id) => {
  const tk = t.ticketsOf(id).find(x => x.seat === '公务舱');
  try { t.buyTicket(id, tk.id); return 'ok'; } catch (e) { return String(e.message); }
}, ids.tr);
check(/余额不足/.test(poor), `买不起就是买不起（${poor}）`);
check(await T((t, l, id) => t.spentOn(id), ids.tr) === 4800, '买不起那一下没有动账本');

// ---- 6 退票：账本里那一笔一并撤销 ----
await T((t, l, id) => {
  const tk = t.ticketsOf(id).find(x => x.seat === '经济舱');
  t.refundTicket(id, tk.id);
}, ids.tr);
const back = await T((t, l, bk, j, id) => ({
  bal: l.balanceOf(bk, j), spent: t.spentOn(id), n: t.entriesOf(id).length }),
  ids.bk, ids.joint, ids.tr);
check(back.bal === before && back.spent === 0 && back.n === 0,
  `退票之后钱回来了，账本里那一笔也没了（${JSON.stringify(back)}）`);

// ---- 7 没有账本就不让买 ----
const noBook = await page.evaluate(async ([chatId]) => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const t = await import('/src/system/trip.js');
  const me = acc.roots()[0];
  const a2 = db.characters.create({ name: '另一个', persona: 'x' });
  const c2 = db.chats.create({ characterIds: [a2.id], personaId: me.id });
  const tr2 = t.create({ chatId: c2.id, title: '某地', place: '某地' });
  t.addTickets(tr2.id, [{ kind: 'flight', title: '票', face: 100, qty: 1 }], 'manual');
  const tk = t.ticketsOf(tr2.id)[0];
  try { t.buyTicket(tr2.id, tk.id); return 'ok'; } catch (e) { return String(e.message); }
}, [ids.chat]);
check(/还没有账本/.test(noBook), `没绑账本时说清楚去哪儿绑（${noBook}）`);

// ---- 8 再搜一次是追加，不是重掷 ----
reply = { tickets: [{ title: '新干线', seat: '指定席', face: 13000 }] };
await go(`/tickets/${ids.tr}`);
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.trim() === '联网检索').click());
await page.waitForTimeout(1400);
check(await T((t, l, id) => t.ticketsOf(id).length, ids.tr) === 3,
  '再搜一次是往后加，上一次的两条还在');

// ---- 9 详情页那一行摘要 ----
await go(`/trip/${ids.tr}`);
body = await txt();
check(/3 条备选/.test(body), '详情页写着有几条备选');

// ---- 10 备份带得走 ----
const rt = await page.evaluate(async ([id]) => {
  const b = await import('/src/system/backup.js');
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/trip.js');
  const blob = await b.build();
  db.trips.all().forEach(r => db.trips.remove(r.id));
  await b.restore(blob);
  return t.ticketsOf(id).length;
}, [ids.tr]);
check(rt === 3, `备份来回一趟，票还在（${rt}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
