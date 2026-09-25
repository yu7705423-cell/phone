// 发了新版本之后，一直开着的页面回到前台时换成新的（system/newbuild.js，ARCHITECTURE 4.243）
//
//   用户问「你考虑到更新的影响了吗」：修掉的扣费问题，对更新前就开着、一直没关的页面不生效。
//   一、服务器上是同一个版本：回到前台不重载
//   二、有新版本、输入框里正写着字：不打断，不重载
//   三、有新版本、没在做什么：回到前台就重载成新的
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
let newer = false;
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
// 只有「问新版本」的那一下（?nb=）拿到新的构建号；页面本身照旧，免得启动时的比对去自愈
await ctx.route(/\/index\.html\?nb=/, async r => {
  const res = await r.fetch();
  const body = await res.text();
  r.fulfill({ response: res, body: newer ? body.replace(/<meta name="build" content="[^"]+">/, '<meta name="build" content="2099-01-01.1">') : body });
});
await ctx.addInitScript(() => { try { localStorage.setItem('eira-newbuild-test', '1'); } catch { /* 无 */ } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);
const back = () => page.evaluate(() => {
  window.__stay = window.__stay || 1;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
const stayed = () => page.evaluate(() => window.__stay === 1).catch(() => false);
await page.evaluate(() => { window.__stay = 1; });

await back();
await page.waitForTimeout(1500);
ok('同一个版本：回到前台不重载', await stayed());

newer = true;
await page.evaluate(() => {
  const t = document.createElement('textarea');
  t.id = 'typing'; t.value = '写到一半的话';
  document.body.appendChild(t); t.focus();
});
await back();
await page.waitForTimeout(1500);
ok('有新版本、正在写字：不打断', await stayed());

await page.evaluate(() => { const t = document.getElementById('typing'); t.value = ''; t.blur(); t.remove(); });
await back();
await page.waitForTimeout(4000);
ok('有新版本、没在做什么：回到前台就换成新的', !(await stayed()));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
