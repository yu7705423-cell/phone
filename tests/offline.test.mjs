// 代码存在本机（sw.js 的缓存，system/offline.js，ARCHITECTURE 4.220）。
//
//   打开一次之后：缓存名是 eira-<构建号>，已经加载过的代码都补进去了
//   断网再打开：照样进得去（页面与代码都从缓存取）
//   别的构建号留下的缓存整份删掉，不会新旧混着
//   自动化测试里默认不缓存（地址带 cache=0），专门的开关打开才缓存
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

// ---- 默认（自动化里）：不缓存 ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate(async () => ({
    url: navigator.serviceWorker.controller?.scriptURL || '',
    caches: (await caches.keys()).filter(k => k.startsWith('eira-')),
  }));
  ok('自动化里默认：注册了，但地址带 cache=0，不缓存', /sw\.js\?b=.+&cache=0/.test(r.url) && !r.caches.length, JSON.stringify(r));
  await ctx.close();
}

// ---- 打开开关：缓存 ----
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('eira-sw-test', '1'); } catch { /* */ }
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
// 先放一份「上一版」留下的缓存，新的装上之后应当被删掉
await page.goto(`${BASE}/sw.js`);
await page.evaluate(async () => { const c = await caches.open('eira-old-build'); await c.put('/x', new Response('old')); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 }).catch(() => {});
const build = await page.evaluate(() => document.querySelector('meta[name="build"]').content);
// 补缓存是 Service Worker 在后台一个个取，等到数目够了（最多 30 秒）
for (let i = 0; i < 60; i++) {
  const n = await page.evaluate(async b => (await (await caches.open(`eira-${b}`)).keys()).length, build);
  if (n > 100) break;
  await page.waitForTimeout(500);
}
const st = await page.evaluate(async b => {
  const keys = await caches.keys();
  const c = await caches.open(`eira-${b}`);
  const urls = (await c.keys()).map(r => new URL(r.url).pathname);
  return { keys, n: urls.length, main: urls.some(u => u.endsWith('/src/main.js')), ver: urls.some(u => u.endsWith('/src/version.js')),
    sw: navigator.serviceWorker.controller?.scriptURL || '' };
}, build);
ok('缓存名带构建号，地址没有 cache=0', st.keys.includes(`eira-${build}`) && !/cache=0/.test(st.sw), JSON.stringify({ keys: st.keys, sw: st.sw }));
ok('第一次打开已经加载过的代码都补进了缓存', st.n > 100 && st.main && st.ver, `${st.n} 个`);
ok('上一版留下的缓存整份删掉了', !st.keys.includes('eira-old-build'), JSON.stringify(st.keys));

// ---- 断网再开 ----
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForFunction(() => !!document.querySelector('.home, .lock, .home-layer'), null, { timeout: 20000 }).catch(() => {});
const off = await page.evaluate(() => ({
  home: !!document.querySelector('.home, .lock, .home-layer'),
  failed: document.body.textContent.includes('启动失败'),
})).catch(e => ({ err: String(e) }));
ok('断网再打开：照样进得去', off.home && !off.failed, JSON.stringify(off));
await ctx.setOffline(false);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
