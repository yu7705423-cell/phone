// 心声「打开一页」那一档（ARCHITECTURE 4.274）：点头像打开一页，上面是这一轮的，下面是以前的每一条
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
  db.settings.set({ innerStyle: 'card' });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now(), innerMode: 'inline' });
  const say = (content, extra = {}) => db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content, status: 'done', ...extra });
  say('第一轮第一句', { turnId: 't1', createdAt: Date.now() - 30000 });
  say('第一轮第二句', { turnId: 't1', inner: '第一轮的心声', createdAt: Date.now() - 29000 });
  say('第二轮第一句', { turnId: 't2', createdAt: Date.now() - 2000 });
  say('第二轮第二句', { turnId: 't2', inner: '第二轮的心声', createdAt: Date.now() - 1000 });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
  return { chat: chat.id };
});
await page.waitForTimeout(900);
// 点第二轮第一条的头像（心声挂在第二条上）
await page.locator('.msg', { hasText: '第二轮第一句' }).locator('.ph-face').first().click();
await page.waitForTimeout(700);
const card = await page.evaluate(() => document.querySelector('.inner-postcard')?.innerText || '');
ok('打开一张卡，上面是谁', /阿岚/.test(card), card.slice(0, 80));
ok('卡上是这一轮的心声和那一句', /第二轮的心声/.test(card) && /第二轮第二句/.test(card), card.slice(0, 200));
ok('底下写着第几张', /2 \/ 2/.test(card), card);
await page.locator('.inner-postcard-nav[aria-label="上一张"]').click();
await page.waitForTimeout(300);
const card2 = await page.evaluate(() => document.querySelector('.inner-postcard')?.innerText || '');
ok('翻到上一张：以前那一条', /第一轮的心声/.test(card2) && /1 \/ 2/.test(card2), card2);
const inline = await page.evaluate(() => document.querySelectorAll('.inner-voice').length);
ok('这一档不在气泡下面展开', inline === 0, String(inline));
await page.locator('.inner-layer').click({ position: { x: 5, y: 5 } });
await page.waitForTimeout(300);
ok('点纸外面收起', await page.evaluate(() => !document.querySelector('.inner-layer')), '');
// 淡色小字那一档照旧在气泡下面
await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ innerStyle: 'quiet' }));
await page.waitForTimeout(300);
await page.locator('.msg', { hasText: '第二轮第二句' }).locator('.ph-face').first().click();
await page.waitForTimeout(600);
const inline2 = await page.evaluate(() => [...document.querySelectorAll('.inner-voice')].map(x => x.textContent));
ok('淡色小字那一档在气泡下面展开', inline2.length === 1 && inline2[0] === '第二轮的心声', JSON.stringify(inline2));
ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
