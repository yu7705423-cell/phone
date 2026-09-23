import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

// 把媒体元素打桩，好确定性地摆布「能不能播」
await page.evaluate(() => {
  window.__ka = { paused: true, blocked: false, plays: 0 };
  Object.defineProperty(HTMLMediaElement.prototype, 'paused',
    { get: () => window.__ka.paused, configurable: true });
  Object.defineProperty(HTMLMediaElement.prototype, 'ended',
    { get: () => false, configurable: true });
  HTMLMediaElement.prototype.play = function () {
    window.__ka.plays += 1;
    window.__ka.el = this;          // new Audio() 是游离节点，只能这样拿到它
    if (window.__ka.blocked) return Promise.reject(new Error('blocked'));
    window.__ka.paused = false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {
    window.__ka.paused = true;
    this.dispatchEvent(new Event('pause'));
  };
  // 外部打断：系统按停，不经过我们的 stop()
  window.__interrupt = () => {
    window.__ka.paused = true;
    if (window.__ka.el) window.__ka.el.dispatchEvent(new Event('pause'));
  };
});

const st = () => page.evaluate(async () =>
  (await import('/src/system/keepalive.js')).state.get());

// 开
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ keepAlive: true });
  const ka = await import('/src/system/keepalive.js');
  ka.install(() => db.settings.get().keepAlive);
  await ka.start();
});
await page.waitForTimeout(300);
ck('开起来了 ' + JSON.stringify(await st()), (await st()).on === true);

// 被外部打断 -> 自动续上
await page.evaluate(() => window.__interrupt());
await page.waitForTimeout(1400);
const after = await st();
ck('打断之后自动续上了 ' + JSON.stringify(after), after.on === true && after.needsTap === false);

// 打断 + 浏览器不让播 -> 立起 needsTap
await page.evaluate(() => { window.__ka.blocked = true; window.__interrupt(); });
await page.waitForTimeout(1400);
const blocked = await st();
ck('续不上就要用户点一下 ' + JSON.stringify(blocked), blocked.on === false && blocked.needsTap === true);

// 横幅出来了
ck('横幅出来了', await page.locator('.ka-banner').count() > 0);
ck('横幅上写了为什么', await page.getByText('后台保活已中断').count() > 0);

// 点一下就好了（模拟浏览器在真实手势后放行）
await page.evaluate(() => { window.__ka.blocked = false; });
if (await page.locator('.ka-act').count()) await page.locator('.ka-act').click();
else fail.push('横幅上没有「重新开启」可点');
await page.waitForTimeout(500);
const fixed = await st();
ck('点重新开启之后恢复 ' + JSON.stringify(fixed), fixed.on === true && fixed.needsTap === false);
ck('横幅跟着收了', await page.locator('.ka-banner').count() === 0);

// 手势那个监听器不是一次性的：再断一次、再点一次，还得能救回来
await page.evaluate(() => { window.__ka.blocked = true; window.__interrupt(); });
await page.waitForTimeout(1400);
ck('第二次断也会立起 needsTap', (await st()).needsTap === true);
const before = await page.evaluate(() => window.__ka.plays);
await page.evaluate(() => { window.__ka.blocked = false; });
await page.mouse.click(215, 500);
await page.waitForTimeout(500);
const secondFix = await st();
ck('第二次随手一点也能救回来 ' + JSON.stringify(secondFix), secondFix.on === true);
ck('那一点确实触发了重放', await page.evaluate(() => window.__ka.plays) > before);

// 回到前台也补一次
await page.evaluate(() => { window.__ka.paused = true; });   // 悄悄停掉，不发事件
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(400);
ck('回到前台会补一次', (await st()).on === true);

// 关掉：不该被自己的 pause 当成打断又续回来
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ keepAlive: false });
  (await import('/src/system/keepalive.js')).stop();
});
await page.waitForTimeout(1400);
const off = await st();
ck('关掉之后不会自己续回来 ' + JSON.stringify(off), off.want === false && off.on === false);
ck('关掉之后不弹横幅', await page.locator('.ka-banner').count() === 0);

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '保活全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
