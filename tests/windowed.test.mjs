// 「设置 - 外观 - 全屏显示」关掉之后，各种打开方式各自退出全屏（system/fullscreen.js，ARCHITECTURE 4.232）
//
//   一、电脑宽屏：默认铺满；关掉变成手机宽度居中，壁纸只铺这一栏；再开回来铺满
//   二、安卓浏览器标签页：开着时点一下请求全屏；关掉之后点了不再请求，已在全屏里的退出
//   三、安卓安装包：关掉时叫外壳放出系统状态栏，网页不再自己画那一条；旧外壳没有这个接口就照旧
//   四、没动过新开关、老的「浏览器中全屏」关过的：照老开关，不全屏
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const open = async (opts, init) => {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/src/site.js*', async r => {
    const res = await r.fetch();
    r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/index.html`);
  await page.waitForTimeout(2000);
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); });
  await page.waitForTimeout(400);
  return { ctx, page };
};
const setFull = (page, v) => page.evaluate(async on => (await import('/src/system/fullscreen.js')).setFull(on), v);

// ---- 一、电脑宽屏 ----
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } });
  await page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const id = await db.images.put(new File([blob], 'w.png', { type: 'image/png' }));
    db.layout.replace({ ...db.layout.get(), wallpaper: { home: id, lock: id } });
  });
  await page.waitForTimeout(500);
  const box = () => page.evaluate(() => {
    const r = document.querySelector('.root').getBoundingClientRect();
    const w = document.querySelector('.wallpaper')?.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), wallX: w ? Math.round(w.x) : null, wallW: w ? Math.round(w.width) : null };
  });
  const full = await box();
  ok('电脑上默认铺满整个窗口', full.w === 1280 && full.x === 0, JSON.stringify(full));
  // 从外观页的开关关掉
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.openApp('settings', '/'); n.push('/appearance'); });
  await page.waitForTimeout(600);
  await page.locator('.list-item', { hasText: '全屏显示' }).locator('.switch').click();
  await page.waitForTimeout(500);
  const col = await box();
  ok('关掉：手机宽度居中', col.w <= 432 && col.x > 400, JSON.stringify(col));
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); });
  await page.waitForTimeout(500);
  const colHome = await box();
  ok('壁纸只铺这一栏，不铺到两侧', colHome.wallW !== null && colHome.wallW <= 432 && Math.abs(colHome.wallX - colHome.x) <= 2, JSON.stringify(colHome));
  ok('开关记在设置里', await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().fullscreen === false));
  await page.reload(); await page.waitForTimeout(2000);
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); });
  await page.waitForTimeout(300);
  ok('重开之后仍然是手机宽度', (await box()).w <= 432);
  // 自己定窗口大小：外观页里两个滑杆（数字框直接填）
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.openApp('settings', '/'); n.popToRoot(); n.push('/appearance'); });
  await page.waitForTimeout(600);
  const num = label => page.locator('.field', { hasText: label }).locator('.slider-num');
  await num('窗口宽度').fill('360');
  await num('窗口高度').fill('640');
  await page.waitForTimeout(400);
  const sized = await page.evaluate(() => {
    const r = document.querySelector('.root').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok('填了宽 360、高 640：中间那一块就是这么大，居中',
    sized.w === 360 && sized.h === 640 && Math.abs(sized.x - (1280 - 360) / 2) <= 1 && Math.abs(sized.y - (800 - 640) / 2) <= 1,
    JSON.stringify(sized));
  await num('窗口高度').fill('1500');
  await page.waitForTimeout(400);
  ok('高度超出屏幕：收到屏幕以内', (await page.evaluate(() => document.querySelector('.root').getBoundingClientRect().height)) <= 800);
  await page.locator('.field', { hasText: '窗口宽度' }).locator('button', { hasText: '不改' }).click();
  await page.locator('.field', { hasText: '窗口高度' }).locator('button', { hasText: '不改' }).click();
  await page.waitForTimeout(400);
  const back = await box();
  ok('两项都「不改」：回到默认的手机宽度一栏', back.w <= 432 && back.x > 400, JSON.stringify(back));
  await setFull(page, true);
  await page.waitForTimeout(300);
  ok('再开回来：铺满', (await box()).w === 1280);
  await ctx.close();
}

// ---- 二、安卓浏览器标签页 ----
{
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' };
  // 只要一次「点按」：直接在 document 上发一个 click，不去点界面上真的东西（那会打开某个 app）
  const tap = pg => pg.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const { ctx, page } = await open(mobile, () => {
    window.__fs = 0;
    Element.prototype.requestFullscreen = function () { window.__fs += 1; return Promise.resolve(); };
  });
  await tap(page);
  await page.waitForTimeout(200);
  ok('开着：点一下就请求全屏', await page.evaluate(() => window.__fs) >= 1);
  await setFull(page, false);
  await page.evaluate(() => { window.__fs = 0; });
  await tap(page);
  await tap(page);
  await page.waitForTimeout(200);
  ok('关掉：再怎么点也不请求', await page.evaluate(() => window.__fs) === 0);
  ok('关掉：根元素带 data-windowed', await page.evaluate(() => document.documentElement.hasAttribute('data-windowed')));
  await ctx.close();
}

// ---- 三、安卓安装包 ----
{
  const shell = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const { ctx, page } = await open(shell, () => {
    window.phoneFullscreen = true;
    window.__bars = [];
    window.EiraNative = { setSystemBars: v => window.__bars.push(v) };
  });
  const bar = () => page.evaluate(() => !!document.querySelector('.statusbar'));
  ok('全屏：外壳藏着系统状态栏，网页自己画一条', await bar());
  await setFull(page, false);
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__bars);
  ok('关掉：叫外壳放出系统状态栏', calls[calls.length - 1] === true, JSON.stringify(calls));
  ok('关掉：网页不再自己画状态栏', !await bar());
  await setFull(page, true);
  await page.waitForTimeout(300);
  ok('开回来：叫外壳藏起来，网页重新画', (await page.evaluate(() => window.__bars.slice(-1)[0])) === false && await bar());
  await ctx.close();
}
{
  // 旧外壳：没有 setSystemBars。关掉也照旧自己画，不然时间和电量就没了
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    () => { window.phoneFullscreen = true; window.EiraNative = {}; });
  await setFull(page, false);
  await page.waitForTimeout(300);
  ok('旧安装包：关掉也照旧画状态栏', await page.evaluate(() => !!document.querySelector('.statusbar')));
  await ctx.close();
}

// ---- 四、老开关 ----
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } });
  await page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    const s = { ...db.settings.get(), autoFullscreen: false };
    delete s.fullscreen;
    db.settings.replace(s);
  });
  await page.waitForTimeout(300);
  ok('老的「浏览器中全屏」关过：照它，不全屏',
    await page.evaluate(async () => !(await import('/src/system/fullscreen.js')).wantFull()));
  await ctx.close();
}

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
