// 整页被浏览器推离原位之后要归位（system/viewport.js）；系统状态栏被藏起来时网页自己画一条。
//
// 手机浏览器点输入框时会把整页推上去，键盘收起后常常不推回来：聊天页上面少一截、下面空一大片。
// 这里没有真键盘，用 window.scrollTo 模拟「浏览器把整页推上去」—— 先在页面底下垫一块，让整页推得动。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ctx = await browser.newContext(mobile);
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
  // 垫一块，让整页推得动（真机上是键盘把可视区顶小了）
  const pad = document.createElement('div');
  pad.style.cssText = 'position:absolute;left:0;top:180vh;width:1px;height:1px';
  document.body.appendChild(pad);
});
await page.waitForTimeout(800);
const scrollY = () => page.evaluate(() => Math.round(window.scrollY || document.scrollingElement.scrollTop));

// 正在输入：浏览器把整页推上去，不动它
await page.locator('.composer-input').focus();
await page.evaluate(() => window.scrollTo(0, 300));
await page.waitForTimeout(200);
ok('正在输入时：浏览器推上去的位置不动（输入框要露在键盘上面）', (await scrollY()) === 300, await scrollY());

// 键盘收起（失焦）：归位
await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(500);
ok('键盘收起后：整页回到原位', (await scrollY()) === 0, await scrollY());

// 没在输入时被推开（切屏、旋转之后常见）：也归位
await page.evaluate(() => window.scrollTo(0, 200));
await page.waitForTimeout(300);
ok('没在输入时整页被推开：立刻归位', (await scrollY()) === 0, await scrollY());

const chatTop = await page.evaluate(() => Math.round(document.querySelector('.navbar').getBoundingClientRect().top));
ok('聊天页顶栏贴着顶端', chatTop === 0, chatTop);
await ctx.close();

// ---- 状态栏 ----
const statusbar = async init => {
  const c = await browser.newContext(mobile);
  const p = await c.newPage();
  if (init) await p.addInitScript(init);
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  const n = await p.locator('.statusbar').count();
  await c.close();
  return n;
};
ok('手机浏览器里：不画状态栏（系统自己有）', (await statusbar(null)) === 0);
ok('安卓安装包（系统状态栏藏起来了）：自己画一条', (await statusbar(() => { window.phoneFullscreen = true; })) === 1);

// ---- iPhone：安全区（上 59 下 34）----
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
{
  const c = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const p = await c.newPage();
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  // Chromium 里 env(safe-area-inset-*) 是 0，照 iPhone 的数值垫上
  await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '.root{--safe-top:59px !important;--safe-bottom:34px !important}';
    document.head.appendChild(st);
  }));
  // 连安卓安装包那个标记也一并带上：苹果设备上照样不画
  await p.addInitScript(() => { window.phoneFullscreen = true; });
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  await p.evaluate(async () => {
    const { db } = await import('/src/system/db/index.js');
    const ch = db.characters.create({ name: '乃木' });
    const chat = db.chats.create({ characterIds: [ch.id], lastMessageAt: Date.now() });
    const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
  });
  await p.waitForTimeout(900);
  const m = await p.evaluate(() => {
    const r = s => document.querySelector(s)?.getBoundingClientRect();
    return { nav: Math.round(r('.navbar').top), bar: Math.round(r('.composer-bar').bottom), h: innerHeight,
      sb: document.querySelectorAll('.statusbar').length };
  });
  ok('iPhone：不画网页自己的状态栏（系统的一直都在）', m.sb === 0, m.sb);
  ok('iPhone：顶栏紧贴安全区下沿（59），上面不多出一条', m.nav === 59, m.nav);
  ok('iPhone：输入栏一直铺到屏幕底边，安全区只让一次', m.bar === m.h, `${m.bar} / ${m.h}`);
  await c.close();
}

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
