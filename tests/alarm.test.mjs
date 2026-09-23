// 闹钟：时刻怎么拼、到点怎么响、桥不在时怎么退、票的虚拟数怎么标。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);
const txt = () => page.evaluate(() => (document.querySelector('.app-layer') || document.body).innerText);

// ---- 1 拼时刻 ----
const t1 = await page.evaluate(async () => {
  const a = await import('/src/system/alarm.js');
  const at = a.at('2026-09-30', '07:30');
  const d = new Date(at);
  return {
    good: at > 0 && d.getHours() === 7 && d.getMinutes() === 30 && d.getDate() === 30,
    noTime: a.at('2026-09-30', ''),
    noDate: a.at('', '07:30'),
    bad: a.at('9月30', '七点半'),
    short: a.at('2026-09-30', '7:05') > 0,
    future: a.isFuture(Date.now() + 60000),
    past: a.isFuture(Date.now() - 60000),
    native: a.available(),
  };
});
check(t1.good, '日期加时刻拼得出一个准确到分钟的时刻');
check(!t1.noTime && !t1.noDate && !t1.bad, '缺一半或者写得不对就是 0，不猜');
check(t1.short, '7:05 这种一位数的小时也认');
check(t1.future && !t1.past, '过去的时刻不算数');
check(!t1.native, '浏览器里没有系统闹钟这座桥');

// ---- 2 桥不在时怎么退 ----
const t2 = await page.evaluate(async () => {
  const a = await import('/src/system/alarm.js');
  const t = await import('/src/system/todo.js');
  const db = await import('/src/system/db/index.js');
  const row = t.addMine('去取快递');
  const soon = Date.now() + 3600000;
  const r1 = await a.reschedule(row.id, soon);
  const after = db.todos.get(row.id);
  const r2 = await a.schedule(t.addMine('已经过去的').id);
  return { r1, remindAt: after.remindAt === soon, alarmId: after.alarmId || '',
    upcoming: a.upcoming().length, r2 };
});
check(t2.r1.native === false && t2.r1.reason === 'nobridge',
  `桥不在就照实说没排进系统（${JSON.stringify(t2.r1)}）`);
check(t2.remindAt && !t2.alarmId, '时刻照样存下来了，但没有系统闹钟的编号');
check(t2.upcoming === 1, '「即将到时」里数得到它');
check(t2.r2.reason === 'past', '没填时刻的排不了，如实回一个原因');

// ---- 3 到点自己响 ----
const t3 = await page.evaluate(async () => {
  const a = await import('/src/system/alarm.js');
  const t = await import('/src/system/todo.js');
  const db = await import('/src/system/db/index.js');
  const row = t.addMine('该吃药了');
  db.todos.update(row.id, { remindAt: Date.now() - 1000 });
  const due1 = a.due().map(x => x.text);
  a.markRung(row.id);
  const due2 = a.due().length;
  // 做完的不再响
  const row2 = t.addMine('做完的那条');
  db.todos.update(row2.id, { remindAt: Date.now() - 1000 });
  t.setState(row2.id, t.DONE);
  const due3 = a.due().some(x => x.id === row2.id);
  return { due1, due2, due3 };
});
check(t3.due1.includes('该吃药了'), `到点的挑得出来（${JSON.stringify(t3.due1)}）`);
check(t3.due2 === 0, '响过一次就不再响');
check(!t3.due3, '已经做完的不响');

// ---- 4 界面 ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('todo', '/alarm');
});
await page.waitForTimeout(800);
let body = await txt();
check(/系统闹钟/.test(body) && /两边对账/.test(body), '系统闹钟页把状态与对账摆出来了');
check(/不可用/.test(body), '浏览器里如实写着不可用，不假装');
check(/去取快递/.test(body), '即将到时的那条列出来了');

// ---- 5 票的虚拟数 ----
const t5 = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const trip = await import('/src/system/trip.js');
  const grab = await import('/src/system/grab.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '同行' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  const row = trip.create({ chatId: chat.id, title: '一场演出' });
  // 联网那一档：模型说这两个数是自己编的
  const [a] = trip.addTickets(row.id, [{
    title: '查到的那场', kind: 'showticket', face: 500, qty: 1,
    capacity: 5000, demand: 40000, share: 1, heat: 1, numsMade: true,
  }], trip.SEARCHED);
  const [b] = trip.addTickets(row.id, [{
    title: '真查到的', kind: 'showticket', face: 500, qty: 1,
    capacity: 5000, demand: 40000, share: 1, heat: 1, numsMade: false,
  }], trip.SEARCHED);
  // 没联网那一档：整批都是编的，不必问模型
  const [g] = trip.addTickets(row.id, [{
    title: '估出来的', kind: 'showticket', face: 500, qty: 1,
    capacity: 3000, demand: 20000, share: 1, heat: 1,
  }], trip.GUESSED);
  return {
    made: a.numsMade, real: b.numsMade, guess: g.numsMade,
    oddsWorks: !!grab.oddsOf(row.id, a.id),
    trip: row.id, ticket: a.id,
  };
});
check(t5.made === true && t5.real === false, '模型说编的就记成编的，说查到的就记成查到的');
check(t5.guess === true, '没联网那一档整批算编的，不必问模型');
check(t5.oddsWorks, '编出来的数照样算得出概率 —— 这正是要它的原因');

await page.evaluate(async ([tripId, ticketId]) => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('travel', `/grab/${tripId}/${ticketId}`);
}, [t5.trip, t5.ticket]);
await page.waitForTimeout(800);
body = await txt();
check(/（虚拟）/.test(body), `抢票页上每个数旁边标着虚拟（${(body.match(/[^\n]*虚拟[^\n]*/) || [])[0]}）`);
check(/这一概率同样是虚拟的/.test(body), '概率那一行说清了它也是虚拟的');
check(!/无法计算/.test(body), '不再是「无法计算」那一版');

// ---- 6 prompt 里要得对 ----
const t6 = await page.evaluate(async () => {
  const { template } = await import('/src/system/ai/templates.js');
  return { web: template('task.trip-tickets'), guess: template('task.trip-tickets-guess') };
});
check(/numsMade/.test(t6.web) && /leave neither at 0/.test(t6.web),
  '联网那一份要求两个数都填，并说明哪个是编的');
check(/capacity/.test(t6.guess) && /leave none at 0/.test(t6.guess),
  '不联网那一份也把四个数要回来');
check(!/do not estimate one/.test(t6.web), '「不要估算」那句已经去掉了');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
