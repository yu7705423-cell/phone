// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 出行第一批：一次出行这个对象、两个方向的提议、阶段现算、钱只在账本里。
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
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  return { a: a.id, chat: chat.id, me: me.id };
});
const T = (fn, ...args) => page.evaluate(async ([f, rest]) => {
  const t = await import('/src/system/trip.js');
  // eslint-disable-next-line no-new-func
  return new Function('t', '...a', `return (${f})(t, ...a)`)(t, ...rest);
}, [fn.toString(), args]);
// openApp(app,'/') 对已经打开的 app 会保留原来的栈（nav.js 有意如此），
// 所以回根页要自己退一下
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
const dateAt = d => {
  const x = new Date(Date.now() + d * 86400000);
  const p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

// ---- 1 阶段是算出来的，不是存的 ----
const tid = await T((t, chatId) => t.create({ chatId, title: '京都', place: '京都' }).id, ids.chat);
check(await T((t, id) => t.phaseOf(t.get(id)), tid) === 'talking', '刚建出来是商量中');
// 没填日期不让定 —— 定了之后买票、攒钱、提醒全都要日期
const noDate = await T((t, id) => {
  try { t.book(id); return 'ok'; } catch (e) { return String(e.message); }
}, tid);
check(/出发日期/.test(noDate), `没填日期不让定（${noDate}）`);

await T((t, id, from, to) => t.update(id, { from, to }), tid, dateAt(3), dateAt(7));
await T((t, id) => t.book(id), tid);
check(await T((t, id) => t.phaseOf(t.get(id)), tid) === 'soon', '定了且日子没到是待出发');
check(await T((t, id) => t.daysUntil(t.get(id)), tid) === 3, '还有 3 天，是算出来的');
check(await T((t, id) => t.nights(t.get(id)), tid) === 5, '五天，是算出来的');

// 日子到了，同一行不改任何字段，阶段自己变
await T((t, id, from, to) => t.update(id, { from, to }), tid, dateAt(-1), dateAt(2));
check(await T((t, id) => t.phaseOf(t.get(id)), tid) === 'going', '日子到了自己变成进行中');
check(await T((t, id) => t.dayIndex(t.get(id)), tid) === 2, '今天是第 2 天');
await T((t, id, from, to) => t.update(id, { from, to }), tid, dateAt(-9), dateAt(-5));
check(await T((t, id) => t.phaseOf(t.get(id)), tid) === 'done', '过去了自己变成已结束');
check(await T((t, id) => t.get(id).state, tid) === 'booked',
  '这三步里存下来的 state 一个字没动');

// 日子填反了自动掉个个儿
await T((t, id, a, b) => t.update(id, { from: a, to: b }), tid, dateAt(9), dateAt(5));
const flipped = await T((t, id) => [t.get(id).from, t.get(id).to], tid);
check(flipped[0] < flipped[1], `日子填反了自动调换（${JSON.stringify(flipped)}）`);

// ---- 1b [旅行：…] 真的从模型回复里切得出来 ----
//
// 原先这一份直接调 trip.propose，绕过了切分那一层 —— 于是「这个词没加进
// reply.js 的标记白名单」一直没暴露出来，直到第四批加攻略时才发现。
const cut = await page.evaluate(async ([chatId, charId]) => {
  const r = await import('/src/system/ai/reply.js');
  const parts = r.splitReply('[旅行：小樽 | 冬天]');
  const out = parts.map(p => r.materialize(p,
    { chatId, role: 'char', authorId: charId, status: 'done' }, null)).filter(Boolean);
  return { kind: out[0]?.kind, where: out[0]?.where, when: out[0]?.when };
}, [ids.chat, ids.a]);
check(cut.kind === 'trip' && cut.where === '小樽' && cut.when === '冬天',
  `[旅行：地点 | 时间] 切得出来，两段都对（${JSON.stringify(cut)}）`);
await page.evaluate(async ([chatId]) => {
  const db = await import('/src/system/db/index.js');
  db.messagesOf(chatId).filter(m => m.kind === 'trip').forEach(m => db.messages.remove(m.id));
}, [ids.chat]);

// ---- 2 角色提议 -> 你答应 -> 建出一行 ----
await T((t, id) => t.remove(id), tid);
const propose = await page.evaluate(async ([chatId, charId]) => {
  const t = await import('/src/system/trip.js');
  return t.propose({ chatId, role: 'char', authorId: charId, where: '北海道', when: '下个月' }).id;
}, [ids.chat, ids.a]);
await go('chat', `/chat/${ids.chat}`);
let body = await txt();
check(/北海道/.test(body) && /点击回应/.test(body), '角色提的那条在会话里，写着点击回应');
await page.evaluate(() => document.querySelector('.bubble-trip').click());
await page.waitForTimeout(600);
check(/同行/.test(await txt()) && /不同行/.test(await txt()), '点开是同行或不同行');
await page.evaluate(() => {
  [...document.querySelectorAll('.sheet .list-item')].find(e => e.innerText.includes('同行')).click();
});
await page.waitForTimeout(700);
let rows = await T((t, chatId) => t.listOf(chatId).map(r => `${r.title}/${r.proposedBy}/${r.agreed}`), ids.chat);
check(JSON.stringify(rows) === JSON.stringify(['北海道/char/true']),
  `答应之后建出一行，记着是它提的（${JSON.stringify(rows)}）`);
check(/同意一同前往北海道/.test(await txt()), '会话里落了一行提示');
await page.screenshot({ path: `${OUT}/trip-chat.png` });

// 提示行删掉就当没答应过，那一行也跟着没
const noticeId = await page.evaluate(async ([chatId]) => {
  const db = await import('/src/system/db/index.js');
  return db.messagesOf(chatId).filter(m => m.settledKind === 'trip').slice(-1)[0].id;
}, [ids.chat]);
await page.evaluate(async ([id]) => {
  const r = await import('/src/system/ai/reply.js');
  const db = await import('/src/system/db/index.js');
  r.onNoticeRemoved ? r.onNoticeRemoved(id) : null;
  db.messages.remove(id);
}, [noticeId]);
await page.waitForTimeout(400);

// ---- 3 你在 app 里提：建一行 + 落一条消息，角色答应时不再建第二行 ----
await T((t, chatId) => t.listOf(chatId).forEach(r => t.remove(r.id)), ids.chat);
await go('travel', '/new');
await page.evaluate(() => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const ins = [...document.querySelectorAll('.page input')];
  set.call(ins[0], '大阪');
  ins[0].dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll('.btn, button')]
  .find(b => b.innerText.trim() === '新建').click());
await page.waitForTimeout(900);
rows = await T((t, chatId) => t.listOf(chatId).length, ids.chat);
check(rows === 1, `app 里新建出一行（${rows}）`);
const msgWhere = await page.evaluate(async ([chatId]) => {
  const db = await import('/src/system/db/index.js');
  const m = db.messagesOf(chatId).filter(x => x.kind === 'trip').slice(-1)[0];
  return { where: m.where, role: m.role, tripId: !!m.tripId };
}, [ids.chat]);
check(msgWhere.where === '大阪' && msgWhere.role === 'user' && msgWhere.tripId,
  `同时往会话里发了一条提议，并挂着那一行（${JSON.stringify(msgWhere)}）`);

// 角色写 [同行]：**不能建出第二行**
await page.evaluate(async ([chatId, charId]) => {
  const t = await import('/src/system/trip.js');
  const target = t.pendingFrom(chatId, 'user');
  t.settle(target.id, true);
}, [ids.chat, ids.a]);
await page.waitForTimeout(400);
rows = await T((t, chatId) => t.listOf(chatId).map(r => `${r.title}/${r.agreed}`), ids.chat);
check(JSON.stringify(rows) === JSON.stringify(['大阪/true']),
  `角色答应只是把那一行标成答应了，没有建出第二行（${JSON.stringify(rows)}）`);

// ---- 4 注入：有出行才占位置，写的是算出来的数 ----
const tid2 = await T((t, chatId) => t.listOf(chatId)[0].id, ids.chat);
let ctx = await page.evaluate(async ([chatId]) => {
  const b = await import('/src/system/ai/context/trip.js');
  const db = await import('/src/system/db/index.js');
  return b.build({ chat: db.chats.get(chatId) });
}, [ids.chat]);
check(/这次出行/.test(ctx) && /大阪/.test(ctx), '注入里写了这次出行');
await T((t, id, from) => { t.update(id, { from, to: from }); t.book(id); }, tid2, dateAt(5));
ctx = await page.evaluate(async ([chatId]) => {
  const b = await import('/src/system/ai/context/trip.js');
  const db = await import('/src/system/db/index.js');
  return b.build({ chat: db.chats.get(chatId) });
}, [ids.chat]);
check(/5 days from now/.test(ctx), `还有几天是算好了摆进去的（${ctx.replace(/\n/g, ' | ')}）`);
await T((t, id) => t.drop(id), tid2);
ctx = await page.evaluate(async ([chatId]) => {
  const b = await import('/src/system/ai/context/trip.js');
  const db = await import('/src/system/db/index.js');
  return b.build({ chat: db.chats.get(chatId) });
}, [ids.chat]);
check(ctx === '', '取消之后一个字都不占');
await T((t, id) => t.undrop(id), tid2);

// ---- 5 钱只在账本里 ----
check(await T((t, id) => t.savingOn(id), tid2) === null, '没绑账本时攒钱那一栏是空的，不自己记一个数');
await go('travel', `/trip/${tid2}`);
check(/还没有账本/.test(await txt()), '详情页写明了要先绑一本账，并给了入口');

const saving = await page.evaluate(async ([chatId, tripId]) => {
  const ledger = await import('/src/system/ledger.js');
  const t = await import('/src/system/trip.js');
  const bk = ledger.create({ name: '我们的账', chatId });
  ledger.ensureJoint(bk.id);
  const joint = ledger.defaultFor(bk.id, ledger.JOINT);
  ledger.add({ bookId: bk.id, accountId: joint.id, amount: 3000, note: '攒钱' });
  t.update(tripId, { budget: 5000 });
  // 买了一张票：一条流水，挂着 tripId
  ledger.add({ bookId: bk.id, accountId: joint.id, amount: -1200, note: '机票', tripId });
  const s = t.savingOn(tripId);
  return { have: s.have, need: s.need, short: s.short, spent: t.spentOn(tripId),
    n: t.entriesOf(tripId).length };
}, [ids.chat, tid2]);
check(saving.have === 1800 && saving.spent === 1200 && saving.need === 3800 && saving.short === 2000,
  `攒钱那三个数全是从账本折出来的（${JSON.stringify(saving)}）`);

await go('travel', `/trip/${tid2}`);
body = await txt();
check(/情侣账户/.test(body) && /本次支出/.test(body) && /尚缺/.test(body), '详情页把那三个数摆出来了');
await page.screenshot({ path: `${OUT}/trip-page.png` });

// 账本里把那笔删掉，这边的数字自己就对了 —— 不存一个「已花多少」
await page.evaluate(async ([tripId]) => {
  const ledger = await import('/src/system/ledger.js');
  const t = await import('/src/system/trip.js');
  t.entriesOf(tripId).forEach(e => ledger.drop(e.id));
}, [tid2]);
check(await T((t, id) => t.spentOn(id), tid2) === 0,
  '账本里那笔删了，本次支出自己回到 0（因为它本来就不是存的）');

// ---- 6 列表按阶段分组 ----
await go('travel', '/');
body = await txt();
check(/商量中|待出发/.test(body) && /大阪/.test(body), '列表里按阶段分组列出来了');

// ---- 7 备份带得走 ----
const rt = await page.evaluate(async ([chatId]) => {
  const b = await import('/src/system/backup.js');
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/trip.js');
  const blob = await b.build();
  db.trips.all().forEach(r => db.trips.remove(r.id));
  const gone = t.listOf(chatId).length;
  await b.restore(blob);
  return { gone, back: t.listOf(chatId).map(r => r.title) };
}, [ids.chat]);
check(rt.gone === 0 && JSON.stringify(rt.back) === JSON.stringify(['大阪']),
  `备份来回一趟，出行还在（${JSON.stringify(rt)}）`);

// ---- 8 角色卡上的开关 ----
check(await page.evaluate(async ([charId]) => {
  const db = await import('/src/system/db/index.js');
  const caps = await import('/src/system/ai/capabilities.js');
  const char = db.characters.get(charId);
  const cap = caps.CAPS.find(c => c.id === 'trip');
  const on1 = cap.on({ char, msgs: [], settings: db.settings.get() });
  db.characters.update(charId, { canTrip: false });
  const off = cap.on({ char: db.characters.get(charId), msgs: [], settings: db.settings.get() });
  db.characters.update(charId, { canTrip: true });
  return on1 && !off;
}, [ids.a]), '角色卡上关掉之后，这一条一个字都不进提示词');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
