// 点头像看心声。
//
// 心声只挂在一轮里的一条上（多半是最后一条），可这一轮每条都有头像。从前只认自己身上那一份，
// 点到同一轮别的几条的头像什么都不出来 —— 一轮三到五条，多半点到的就是空的那几个。
// 现在点这一轮哪一条的头像都展开这一轮的心声；这一轮确实没有时说一句为什么。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now(), innerMode: 'inline' });
  const say = (content, extra = {}) => db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content, status: 'done', ...extra });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '在吗', status: 'done' });
  say('在', { turnId: 't1' }); say('怎么了', { turnId: 't1' }); say('说吧', { turnId: 't1', inner: '其实一直在等' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '没事', status: 'done' });
  say('好', { turnId: 't2' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
  return { chat: chat.id };
});
await page.waitForTimeout(900);
const faces = page.locator('.msg:not(.is-mine) .msg-face');
const inner = () => page.locator('.inner-voice').count();

await faces.nth(0).click();
await page.waitForTimeout(500);
ok('点这一轮第一条的头像（心声挂在最后一条上）：展开', (await inner()) === 1, await inner());
ok('心声显示在挂着它的那一条下面', await page.locator('.msg', { hasText: '说吧' }).locator('.inner-voice').count() === 1);
await faces.nth(1).click();
await page.waitForTimeout(500);
ok('再点同一轮另一条的头像：收起', (await inner()) === 0, await inner());

await faces.nth(3).click();
await page.waitForTimeout(500);
ok('这一轮没有心声：提示一句，不是没反应', /这一轮没有心声/.test(await page.locator('.toast').allInnerTexts().then(a => a.join(' '))));

await page.evaluate(async id => (await import('/src/system/db/index.js')).db.chats.update(id, { innerMode: 'off' }), ids.chat);
await page.waitForTimeout(3200);
await faces.nth(3).click();
await page.waitForTimeout(500);
ok('心声没开：提示去哪里开', /心声未开启.*互动/.test(await page.locator('.toast').allInnerTexts().then(a => a.join(' '))));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
