// 键盘弹着时整页被推上去，通知横幅与左上角的悬浮返回键跟着可视区顶边走（4.279）
//
// Chromium 里弹不出真的键盘，把 visualViewport.pageTop 按住成 120 再发一次 resize，
// 查 --vv-top 写进去了、横幅与悬浮键的 top 跟着下来；放开之后回到 0。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const r = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ navStyle: 'back', sound: { ...(db.settings.get().sound || {}), banner: true } });
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('settings', '/');
  await new Promise(r => setTimeout(r, 400));
  const out = {};
  const top = () => getComputedStyle(document.documentElement).getPropertyValue('--vv-top').trim();
  out.before = top();
  // 模拟键盘把页面推上去 120px
  Object.defineProperty(window.visualViewport, 'pageTop', { configurable: true, get: () => 120 });
  window.visualViewport.dispatchEvent(new Event('resize'));
  await new Promise(r => setTimeout(r, 100));
  out.pushed = top();
  out.navback = getComputedStyle(document.querySelector('.navback')).top;
  // 这时来一条通知
  const bus = await import('/src/system/bus.js');
  bus.emit(bus.EVENTS.notify, { id: 'n1', appId: 'chat', title: '阿岚', body: '在吗', createdAt: Date.now(), payload: { route: '/chat/x' } });
  await new Promise(r => setTimeout(r, 300));
  const host = document.querySelector('.banner-host');
  out.bannerTop = host ? getComputedStyle(host).top : 'none';
  out.bannerRect = host ? Math.round(host.getBoundingClientRect().top) : -1;
  // 键盘收起
  delete window.visualViewport.pageTop;
  window.visualViewport.dispatchEvent(new Event('resize'));
  await new Promise(r => setTimeout(r, 100));
  out.after = top();
  out.bannerAfter = host ? getComputedStyle(host).top : 'none';
  return out;
});
ok('平时 --vv-top 是 0', r.before === '0px', r.before);
ok('页面被推上去 120：--vv-top 跟着', r.pushed === '120px', r.pushed);
ok('悬浮返回键往下挪了 120', r.navback === '120px', r.navback);
ok('横幅挂在可视区顶边', r.bannerTop === '120px' && r.bannerRect === 120, JSON.stringify([r.bannerTop, r.bannerRect]));
ok('键盘收起：回到 0', r.after === '0px' && r.bannerAfter === '0px', JSON.stringify([r.after, r.bannerAfter]));

console.log(`\n${R.filter(x => x.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(x => x.pass) && !errs.length ? 0 : 1);
