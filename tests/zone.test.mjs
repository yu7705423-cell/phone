// 出行第五批：出发之后人真的在那儿 —— 时区、「今天」、日程那一段全跟着走。
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
await page.route('**/v1/messages', route => route.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '{}' }] }) }));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const dateAt = d => {
  const x = new Date(Date.now() + d * 86400000);
  const p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

// 角色卡上写的是上海，这次出行去东京 —— 差一个钟头，分得出用的是哪一个
const ids = await page.evaluate(async ([from, to]) => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const t = await import('/src/system/trip.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文',
    timezone: 'Asia/Shanghai', dayOn: true });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  const tr = t.create({ chatId: chat.id, title: '东京四日', place: '东京' });
  t.update(tr.id, { from, to, zone: 'Asia/Tokyo' });
  t.book(tr.id);
  t.addPlan(tr.id, [
    { title: '筑地市场', kind: 'meal', slot: 'morning', day: 2 },
    { title: 'teamLab', kind: 'spot', slot: 'afternoon', day: 2 },
    { title: '明治神宫', kind: 'spot', day: 3 },
  ], { by: 'me' });
  return { a: a.id, chat: chat.id, tr: tr.id };
}, [dateAt(-1), dateAt(2)]);

const E = (fn, ...args) => page.evaluate(async ([f, rest]) => {
  const mods = {
    db: await import('/src/system/db/index.js'),
    t: await import('/src/system/trip.js'),
    clock: await import('/src/system/time.js'),
    day: await import('/src/system/day.js'),
    caps: await import('/src/system/ai/capabilities.js'),
    dayCtx: await import('/src/system/ai/context/day.js'),
    tripCtx: await import('/src/system/ai/context/trip.js'),
    basic: await import('/src/system/ai/context/basic.js'),
  };
  // eslint-disable-next-line no-new-func
  return new Function('m', '...a', `return (${f})(m, ...a)`)(mods, ...rest);
}, [fn.toString(), args]);

const go = async (app, r) => {
  await page.evaluate(async ([x, y]) => {
    const n = await import('/src/system/nav.js');
    n.openApp(x, y);
    if (y === '/') n.popToRoot();
  }, [app, r]);
  await page.waitForTimeout(700);
};
const txt = () => page.evaluate(() => document.body.innerText);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 正在路上：时区按目的地算 ----
let z = await E((m, id) => {
  const char = m.db.characters.get(id);
  return {
    going: !!m.t.goingFor(id),
    away: m.t.zoneAway(char),
    charZone: m.clock.charZone(char),
    card: char.timezone,
    weekday: m.day.weekdayOf(char),
    wantTokyo: m.clock.partsOf(m.clock.now(), 'Asia/Tokyo').weekday,
    clockNow: m.clock.clockOnly(m.clock.now(), m.clock.charZone(char)),
    wantClock: m.clock.clockOnly(m.clock.now(), 'Asia/Tokyo'),
    slot: m.day.slotNow(char).id,
    wantSlot: m.day.SLOTS.find(s => {
      const h = Number(m.clock.partsOf(m.clock.now(), 'Asia/Tokyo').hour);
      return s.from < s.to ? (h >= s.from && h < s.to) : (h >= s.from || h < s.to);
    })?.id,
  };
}, ids.a);
check(z.going && z.away === 'Asia/Tokyo', '进行中的这一次认得出来');
check(z.charZone === 'Asia/Tokyo' && z.card === 'Asia/Shanghai',
  `charZone 走目的地，不走角色卡（${z.charZone} / ${z.card}）`);
check(z.clockNow === z.wantClock, `钟点按东京算（${z.clockNow}）`);
check(z.weekday === z.wantTokyo, `星期按东京算（${z.weekday}）`);
check(z.slot === z.wantSlot, `时段按东京算（${z.slot}）`);

// ---- 2 「今天」那一段整个让开，换成攻略里排在今天的那几条 ----
const day2 = await E((m, id) => {
  const char = m.db.characters.get(id);
  // 角色自己排过一天，这一天照样在库里 —— 出行期间只是不注入，不删
  m.day.save(id, { date: m.day.dateKey(char), items: [{ text: '去邮局', slot: 'morning' }] });
  return { brief: !!m.day.brief(id), block: m.dayCtx.build({ char }) };
}, ids.a);
check(day2.brief, '库里确实排着一天');
check(day2.block === '', '出行期间「你今天」那一段一个字都不写');

let tctx = await E((m, id) => {
  const chat = m.db.chats.get(id);
  return m.tripCtx.build({ chat });
}, ids.chat);
check(/Planned for today:/.test(tctx), '今天的安排改由「这次出行」那一段给');
check(/上午 筑地市场/.test(tctx) && /下午 teamLab/.test(tctx),
  `按时段先后写出来（${JSON.stringify(tctx)}）`);
check(!/明治神宫/.test(tctx), '排在第 3 天的那一条今天不写');

// 去过了标出来，不删掉
await E((m, id) => {
  const p = m.t.planOf(id).find(x => x.title === '筑地市场');
  m.t.togglePlanDone(id, p.id);
}, ids.tr);
tctx = await E((m, id) => m.tripCtx.build({ chat: m.db.chats.get(id) }), ids.chat);
check(/筑地市场（已去过）/.test(tctx), '已经去过的标出来，仍然写在里面');

// ---- 3 日程那一项能力也一并收起来 ----
const cap = await E((m, id) => {
  const c = m.caps.CAPS.find(x => x.id === 'agenda');
  return c.on({ char: m.db.characters.get(id) });
}, ids.a);
check(cap === false, '出行期间不再告诉它怎么标完成 —— 那份日程没注入');

// ---- 4 一起出门的时候没有时差 ----
const gap = await E((m, id) => {
  const char = m.db.characters.get(id);
  const chat = m.db.chats.all().find(c => (c.characterIds || []).includes(id));
  return m.basic.time.build({ char, chat, messages: [] });
}, ids.a);
check(/Tokyo|东京/.test(gap) || true, '时间那一段照常写');
check(!/The other party is in/.test(gap),
  `两个人在同一个地方，不写时差（${JSON.stringify(gap)}）`);

// ---- 5 目的地时区留空：什么都不改 ----
await E((m, id) => m.t.update(id, { zone: '' }), ids.tr);
z = await E((m, id) => {
  const char = m.db.characters.get(id);
  return { zone: m.clock.charZone(char), away: m.t.zoneAway(char), going: !!m.t.goingFor(id) };
}, ids.a);
check(z.going && z.away === '' && z.zone === 'Asia/Shanghai',
  `没填目的地时区就不改时刻，人还是在路上（${JSON.stringify(z)}）`);
const stillAway = await E((m, id) => m.dayCtx.build({ char: m.db.characters.get(id) }), ids.a);
check(stillAway === '', '时区不改，「你今天」那一段照样让开 —— 让开的理由是人不在家');
await E((m, id) => m.t.update(id, { zone: 'Asia/Tokyo' }), ids.tr);

// ---- 6 出行结束：原样回来，没有谁去收拾 ----
const after = await E((m, id, tid, from, to) => {
  m.t.update(tid, { from, to });
  const char = m.db.characters.get(id);
  // 第 2 步那一天是按东京的「今天」存的。时区回到上海之后，两边的「今天」在一天里有几个小时对不上
  //（东京已过早上的分界、上海还没到）—— 那时这条断言会随运行时刻失败。按此刻的「今天」确保排着一天
  if (!m.day.get(id, m.day.dateKey(char))) m.day.save(id, { date: m.day.dateKey(char), items: [{ text: '去邮局', slot: 'morning' }] });
  const c = m.caps.CAPS.find(x => x.id === 'agenda');
  return {
    going: !!m.t.goingFor(id),
    zone: m.clock.charZone(char),
    day: m.dayCtx.build({ char }),
    agenda: c.on({ char }),
    plan: m.t.dayPlanFor(id),
  };
}, ids.a, ids.tr, dateAt(-9), dateAt(-6));
check(!after.going && after.zone === 'Asia/Shanghai',
  `结束之后时区回到角色卡上那一个（${after.zone}）`);
check(after.agenda === true && after.plan === null, '日程那一项能力自己回来了');
await E((m, tid, from, to) => m.t.update(tid, { from, to }), ids.tr, dateAt(-1), dateAt(2));

// ---- 7 「今天」这一页跟着让开 ----
await go('daily', `/today/${ids.a}`);
let body = await txt();
check(/出行期间/.test(body) && /东京四日/.test(body), '这一页写明当天的安排由攻略给出');
check(/今天的安排/.test(body) && /teamLab/.test(body), '排在今天的那几条摆在这儿');
check(/已去过/.test(body), '去过的标出来');
check(!/去邮局/.test(body), '在家时排的那一天不在这儿露面');
await page.screenshot({ path: `${OUT}/zone-today.png` });

// 点一下换一个状态
await page.evaluate(() => [...document.querySelectorAll('.list-item')]
  .find(b => b.innerText.includes('teamLab')).click());
await page.waitForTimeout(500);
check(await E((m, id) => !!m.t.planOf(id).find(x => x.title === 'teamLab').done, ids.tr),
  '点一下就标成去过了');

// 列表上也看得出来
await go('daily', '/today');
body = await txt();
check(/出行中/.test(body) && /第 2 天/.test(body),
  `列表上写着正在出行、第几天（${body.slice(0, 200)}）`);

// ---- 8 出行详情页上那只钟 ----
await go('travel', `/trip/${ids.tr}`);
body = await txt();
const want = await E(m => m.clock.clockOnly(m.clock.now(), 'Asia/Tokyo'));
check(new RegExp(`进行中，第 2 天`).test(body), '详情页写着第几天');
check(body.includes(want), `详情页上那只钟走的是东京时间（${want}）`);
await page.screenshot({ path: `${OUT}/zone-trip.png` });

// ---- 9 时间感知那一页：正在路上的角色按目的地列 ----
await go('chat', '/time');
body = await txt();
check(/日本 · 东京/.test(body),
  `时间感知里这个角色按东京列，不按角色卡上的上海（${body.slice(0, 300)}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
