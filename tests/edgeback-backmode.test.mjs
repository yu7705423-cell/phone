// 左边缘右滑返回。用 CDP 发真的触摸事件，不是合成的 —— preventDefault 那一段
// 只有真事件才试得出来。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
const cdp = await page.context().newCDPSession(page);
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设甲' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '嗨', status: 'done' });
  return { char: a.id, chat: chat.id };
});

await page.evaluate(() => import('/src/system/db/index.js')
  .then(d => d.settings.set({ navStyle: 'back' })));
await page.waitForTimeout(500);

const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

// 一次滑动。steps 越多越像真手指
async function swipe(x0, y0, x1, y1, steps = 12, holdMs = 12) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
    await page.waitForTimeout(holdMs);
  }
  await touch('touchEnd', x1, y1);
  await page.waitForTimeout(600);
}

const go = async (app, route) => {
  await page.evaluate(([app, route]) => import('/src/system/nav.js').then(n => n.openApp(app, route)), [app, route]);
  await page.waitForTimeout(600);
};
const state = () => page.evaluate(async () => {
  const { nav } = await import('/src/system/nav.js');
  const s = nav.get();
  return { screen: s.screen, app: s.appId, stack: s.appId ? s.stacks[s.appId] : null,
    sheet: !!document.querySelector('.fullsheet'), overlay: !!document.querySelector('.overlay') };
});

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

// 1 边缘右滑 -> 退一级
await go('chat', `/chat/${ids.chat}`);
let before = await state();
await swipe(5, 500, 320, 505);
let after = await state();
check(after.stack.length === before.stack.length - 1 && after.stack.slice(-1)[0] === '/',
  `边缘右滑退了一级：${JSON.stringify(before.stack)} -> ${JSON.stringify(after.stack)}`);

// 2 不是从边缘起手 -> 不退
await go('chat', `/chat/${ids.chat}`);
before = await state();
await swipe(200, 500, 400, 505);
after = await state();
check(JSON.stringify(after.stack) === JSON.stringify(before.stack),
  `屏幕中间右滑不退（${JSON.stringify(after.stack)}）`);

// 3 从边缘竖着滑 -> 不退
await go('chat', `/chat/${ids.chat}`);
await swipe(5, 700, 8, 300);
after = await state();
check(after.stack.slice(-1)[0].startsWith('/chat/'), `边缘竖滑不退（${after.stack.slice(-1)[0]}）`);

// 4 滑得不够远 -> 弹回去，不退
await go('chat', `/chat/${ids.chat}`);
await swipe(5, 500, 60, 500);
after = await state();
check(after.stack.slice(-1)[0].startsWith('/chat/'), `只滑 55px 不退（${after.stack.slice(-1)[0]}）`);
const restored = await page.evaluate(() =>
  [...document.querySelectorAll('.page')].every(e => !e.style.transform));
check(restored, '弹回去之后位移清干净了');

// 5 整屏浮层开着 -> 关浮层，不退路由
await go('chat', `/chat/${ids.chat}`);
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.getAttribute('aria-label') === '更多')?.click());
await page.waitForTimeout(500);
before = await state();
check(before.sheet, '菜单（整屏浮层）开着');
await swipe(5, 400, 320, 405);
after = await state();
check(!after.sheet, '边缘右滑把整屏浮层关了');
check(after.stack.slice(-1)[0].startsWith('/chat/'), `路由没跟着退（${after.stack.slice(-1)[0]}）`);

// 6 底部浮层／弹窗开着 -> 完全不接
await go('chat', `/chat/${ids.chat}`);
await page.evaluate(async () => {
  const { confirm } = await import('/src/ui/overlay.js');
  window.__c = confirm({ title: '测试', message: '这是一个弹窗' });
});
await page.waitForTimeout(500);
before = await state();
check(before.overlay, '弹窗开着');
await swipe(5, 400, 320, 405);
after = await state();
check(after.overlay, '弹窗开着时边缘右滑不接这一下');
check(after.stack.slice(-1)[0].startsWith('/chat/'), `路由也没退（${after.stack.slice(-1)[0]}）`);
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.trim() === '取消')?.click());
await page.waitForTimeout(300);

// 7 根页没有返回键 -> 不接（退不出这个 app）
await go('chat', '/');
await swipe(5, 500, 320, 505);
after = await state();
check(after.screen === 'app' && after.app === 'chat',
  `根页右滑不退出 app（现在 ${after.screen}/${after.app}）`);

// 8 这一页的返回是页内的事（多选）-> 退出多选，不退路由
await go('chat', `/chat/${ids.chat}`);
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.getAttribute('aria-label') === '更多')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.fullsheet .list-item')]
    .find(e => e.innerText.startsWith('多选消息'));
  el && el.click();
});
await page.waitForTimeout(600);
const inPick = await page.evaluate(() => /已选|全选|取消/.test(document.body.innerText));
check(inPick, '进了多选');
await swipe(5, 500, 320, 505);
after = await state();
const stillPick = await page.evaluate(() => /已选|全选/.test(document.body.innerText));
check(after.stack.slice(-1)[0].startsWith('/chat/'),
  `多选时右滑没退路由（${after.stack.slice(-1)[0]}）`);
check(!stillPick, '多选时右滑退出了多选（走的是这一页自己的返回）');

// 9 只有一层 Page 接这一下：整屏浮层关掉之后路由必须还在（上面第 5 条已验），
//    这里再确认滑完之后 .page 上的位移清干净了
const clean = await page.evaluate(() =>
  [...document.querySelectorAll('.page')].every(e => !e.style.transform
    && !e.classList.contains('is-swiping') && !e.classList.contains('is-settling')));
check(clean, '滑完之后 .page 上没留下位移和过渡类');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 8).join('\n'));
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
