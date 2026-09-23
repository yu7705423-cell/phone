// 抢不到有好几种抢不到：卡在门口、提交时没了、没中、支付超时。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

const r = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const trip = await import('/src/system/trip.js');
  const grab = await import('/src/system/grab.js');
  const L = await import('/src/system/ledger.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '同行' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  const b = L.create({ name: '共同', chatId: chat.id });
  const j = L.ensureJoint(b.id);
  L.add({ bookId: b.id, accountId: j.id, amount: 9999999, category: 'salary', at: Date.now() });

  const mk = (cap, dem) => {
    const row = trip.create({ chatId: chat.id, title: 'x' });
    const [t] = trip.addTickets(row.id, [{
      title: '一场', kind: 'showticket', face: 10, qty: 1,
      capacity: cap, demand: dem, share: 1, heat: 1, numsMade: true,
    }]);
    return { trip: row.id, ticket: t.id };
  };

  const out = {};
  out.pressure = [grab.pressure(1), +grab.pressure(2).toFixed(2), +grab.pressure(10).toFixed(2)];

  // 超挤的一场，骰子永远最大（最背）：必然卡在排队
  const a = mk(1000, 300000);
  out.queue = grab.grabOnce(a.trip, a.ticket, { random: () => 1 });
  // 骰子取 0.2：过得了门口（挤到极致时门槛也只到 0.3），但抽签那关不中
  const b2 = mk(1000, 300000);
  out.miss = grab.grabOnce(b2.trip, b2.ticket, { random: () => 0.2 });
  // 不挤的一场：门口不拦，必中
  const c2 = mk(100000, 1000);
  out.got = grab.grabOnce(c2.trip, c2.ticket, { random: () => 0 });
  out.gotState = trip.ticketOf(c2.trip, c2.ticket).state;
  out.bought = trip.BOUGHT;

  // 卡在门口也算用掉一次尝试，余票照掉
  const d = mk(1000, 300000);
  const before = grab.oddsOf(d.trip, d.ticket).left;
  grab.grabOnce(d.trip, d.ticket, { random: () => 1 });
  out.left = { before, after: grab.oddsOf(d.trip, d.ticket).left,
    tries: trip.ticketOf(d.trip, d.ticket).tries };

  // 每一种都有一句给人看的话
  out.texts = ['queue', 'slow', 'gone', 'miss', 'pay', 'soldout', 'got']
    .map(k => grab.reasonText(k));

  // 一整场跑下来，会撞上不止一种
  const e = mk(2000, 400000);
  let n = 0;
  const seen = new Set();
  const rnd = () => { n = (n * 9301 + 49297) % 233280; return n / 233280; };
  for (let i = 0; i < 40; i++) {
    const got = grab.grabOnce(e.trip, e.ticket, { random: rnd });
    seen.add(got.reason);
    if (got.ok || got.reason === 'soldout') break;
  }
  out.kinds = [...seen];
  return out;
});

check(JSON.stringify(r.pressure) === JSON.stringify([0, 0.5, 0.9]),
  `挤的程度按供需比算（${JSON.stringify(r.pressure)}）`);
check(r.queue.reason === 'queue' && r.queue.stage === 'queue',
  `人挤的时候卡在排队（${JSON.stringify(r.queue.reason)}）`);
check(r.miss.reason === 'miss', `进得去也可能不中（${r.miss.reason}）`);
check(r.got.ok && r.got.reason === 'got' && r.gotState === r.bought,
  `不挤的时候抢得到（${JSON.stringify(r.got.reason)}）`);
check(r.left.after < r.left.before && r.left.tries === 1,
  `卡在门口照样用掉一次、余票照掉（${r.left.before} 到 ${r.left.after}）`);
check(r.texts.every(t => t && t.length > 3), `每种结果都有一句话（${JSON.stringify(r.texts[0])}）`);
check(!/[呀吧嘛呢啦哦咯]/.test(r.texts.join('')), '那几句是书面语');
check(r.kinds.length >= 2, `一整场下来撞上不止一种（${JSON.stringify(r.kinds)}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
