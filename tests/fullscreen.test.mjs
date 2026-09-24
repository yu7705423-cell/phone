// 浏览器标签页里铺满整屏（system/fullscreen.js）。
//
// 安卓 Chrome 的标签页里，顶上那条系统状态栏和地址栏是浏览器的，网页盖不上去。
// 开着「浏览器中全屏」（默认开）时，触摸一下进全屏，两样都藏起来，网页自己画一条状态栏。
// 另外，浏览器顶上那条的颜色（theme-color）跟着应用自己的深浅色走。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const open = async ({ init, query = '', ...opts }) => {
  const c = await browser.newContext({ viewport: { width: 412, height: 915 }, ...opts });
  const p = await c.newPage();
  if (init) await p.addInitScript(init);
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await p.goto(`${BASE}/index.html${query}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  await p.evaluate(async () => (await import('/src/system/nav.js')).goHome());
  await p.waitForTimeout(400);
  return { c, p };
};
const full = p => p.evaluate(() => !!document.fullscreenElement);
const bars = p => p.locator('.statusbar').count();
// 点主界面上一块空地，不点到图标
const tapBlank = p => p.touchscreen.tap(206, 700);

// ---- 安卓 Chrome ----
{
  // 安卓 Chrome 全屏时，系统状态栏临时滑出来过一次之后，报上来的安全区停在状态栏的高度不回去。
  // Chromium 里 env() 是 0，照那个数垫上
  const { c, p } = await open({ isMobile: true, hasTouch: true, userAgent: ANDROID_UA,
    init: () => document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.root{--safe-top:40px;--safe-bottom:30px}';
      document.head.appendChild(st);
    }) });
  ok('打开时：不在全屏，也不画状态栏（浏览器自己有）', !(await full(p)) && (await bars(p)) === 0);

  // 划一下不算：边缘右滑返回这种页面自己接住的滑动，抬手时照样有 pointerup
  // 用 CDP 发真的触摸（合成的事件本来就进不了全屏，试不出东西）。在会话页上从左边缘划
  await p.evaluate(async () => {
    const { db } = await import('/src/system/db/index.js');
    const ch = db.characters.create({ name: '阿岚' });
    const chat = db.chats.create({ characterIds: [ch.id], lastMessageAt: Date.now() });
    (await import('/src/system/nav.js')).openApp('chat', `/chat/${chat.id}`);
  });
  await p.waitForTimeout(800);
  const cdp = await c.newCDPSession(p);
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent',
    { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 500 }] });
  await touch('touchStart', 5);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', 5 + 25 * i); await p.waitForTimeout(12); }
  await touch('touchEnd', 305);
  await p.waitForTimeout(800);
  await p.evaluate(async () => (await import('/src/system/nav.js')).goHome());
  await p.waitForTimeout(400);
  ok('划一下（不是点）：不进全屏', !(await full(p)));

  await tapBlank(p);
  await p.waitForTimeout(500);
  ok('触摸一下：进入全屏', await full(p));
  ok('全屏后：网页自己画一条状态栏', (await bars(p)) === 1, await bars(p));
  const top = await p.evaluate(() => Math.round(document.querySelector('.statusbar').getBoundingClientRect().top));
  ok('全屏后：状态栏贴着屏幕顶边，上面不空出一条（不照浏览器报的安全区让）', top === 0, top);
  // 进全屏后让浏览器把视口重算一遍（viewport-fit 换一下再换回来），算完要回到 cover
  await p.waitForTimeout(1500);
  const vp = await p.evaluate(() => document.querySelector('meta[name="viewport"]').content);
  ok('全屏后重算视口：viewport-fit 最后仍是 cover', /viewport-fit=cover/.test(vp), vp);
  const sb = await p.evaluate(() => getComputedStyle(document.querySelector('.root')).getPropertyValue('--safe-bottom').trim());
  ok('全屏后：底下也不再让出导航条的位置', sb === '0px', sb);

  await p.evaluate(() => document.exitFullscreen());
  await p.waitForTimeout(400);
  ok('退出全屏后：状态栏跟着撤掉', (await bars(p)) === 0, await bars(p));
  const back = await p.evaluate(() => getComputedStyle(document.querySelector('.root')).getPropertyValue('--safe-top').trim());
  ok('退出全屏后：安全区照浏览器报的恢复', back === '40px', back);
  await tapBlank(p);
  await p.waitForTimeout(500);
  ok('再触摸一下：重新进入全屏', await full(p));

  // 外观页上有这个开关；关掉之后触摸不再进全屏
  await p.evaluate(() => document.exitFullscreen());
  await p.evaluate(async () => (await import('/src/system/nav.js')).openApp('settings', '/appearance'));
  await p.waitForTimeout(800);
  ok('外观页里有「浏览器中全屏」', (await p.getByText('浏览器中全屏').count()) === 1);
  await p.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ autoFullscreen: false }));
  if (await full(p)) await p.evaluate(() => document.exitFullscreen());
  await p.waitForTimeout(300);
  await p.touchscreen.tap(206, 880);
  await p.waitForTimeout(500);
  ok('关掉之后：触摸不再进全屏', !(await full(p)));

  // theme-color 跟着应用的深浅色，不跟系统
  const tc = () => p.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')]
    .map(m => `${m.getAttribute('media') || ''}|${m.content}`));
  await p.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ theme: 'dark' }));
  await p.waitForTimeout(300);
  let t = await tc();
  ok('切到深色：浏览器顶上那条跟着变深，只剩一条、不按系统分', t.length === 1 && /^\|#0+$/i.test(t[0]), JSON.stringify(t));
  await p.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ theme: 'light' }));
  await p.waitForTimeout(300);
  t = await tc();
  ok('切回浅色：跟着变浅', t.length === 1 && /^\|#f{3,6}$/i.test(t[0]), JSON.stringify(t));
  await c.close();
}

// ---- 排查读数：地址加 ?diag 才有 ----
{
  const { c, p } = await open({ isMobile: true, hasTouch: true, userAgent: ANDROID_UA, query: '?diag' });
  await tapBlank(p);
  await p.waitForTimeout(800);
  const d = await p.locator('.diag').innerText().catch(() => '');
  ok('?diag：屏幕上有读数，写着是否全屏、安全区、外壳位置',
    /full yes/.test(d) && /env top/.test(d) && /root top/.test(d) && /bar top/.test(d), d);
  await c.close();
  const n = await open({ isMobile: true, hasTouch: true, userAgent: ANDROID_UA });
  ok('不加 ?diag：没有读数', (await n.p.locator('.diag').count()) === 0);
  await n.c.close();
}

// ---- iPhone：没有这回事 ----
{
  const { c, p } = await open({ isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  await tapBlank(p);
  await p.waitForTimeout(500);
  ok('iPhone：触摸不进全屏', !(await full(p)));
  await p.evaluate(async () => (await import('/src/system/nav.js')).openApp('settings', '/appearance'));
  await p.waitForTimeout(800);
  ok('iPhone：外观页里没有这个开关', (await p.getByText('浏览器中全屏').count()) === 0);
  await c.close();
}

// ---- 电脑：点一下就全屏太突兀 ----
{
  const { c, p } = await open({});
  await p.mouse.click(206, 700);
  await p.waitForTimeout(500);
  ok('电脑上：鼠标点击不自动进全屏', !(await full(p)));
  await c.close();
}

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
