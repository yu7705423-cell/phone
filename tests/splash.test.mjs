// 启动画面：Eira 字样加一排流动的音波，第一帧就在（ARCHITECTURE 4.206）。
//
//   写在 index.html 里，不等 css/js：模块下得慢的时候它也已经在了
//   第一屏画出来之后淡出、摘掉；它不接点击
//   跟着上一次用的主题走（main.js 记在 localStorage 里）
//   等久了底下露一行字，说明还在载入
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

// 页面自己的 service worker 会接走请求，route 拦不到
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
// 模块下得慢：main.js 拖三秒
let slow = true;
await page.route('**/src/main.js', async r => {
  if (slow) await new Promise(res => setTimeout(res, 3000));
  r.continue();
});
// 模块脚本会把 DOMContentLoaded 一起拖住，所以只等到页面开始载入
await page.goto(`${BASE}/index.html`, { waitUntil: 'commit' });
await page.waitForTimeout(700);
const early = await page.evaluate(() => {
  const s = document.getElementById('splash');
  if (!s) return null;
  const r = s.getBoundingClientRect();
  return {
    word: s.querySelector('.splash-word')?.textContent,
    bars: s.querySelectorAll('.splash-wave i').length,
    moving: s.querySelectorAll('.splash-wave i')[0]?.getAnimations().length || 0,
    full: r.width === innerWidth && r.height === innerHeight,
    bg: getComputedStyle(s).backgroundColor,
    note: +getComputedStyle(document.getElementById('splash-note')).opacity,
    clicks: getComputedStyle(s).pointerEvents,
    app: document.getElementById('app').children.length,
  };
});
ok('模块还没到：启动画面已经在', early && early.app === 0, JSON.stringify(early));
ok('写着 Eira', early?.word === 'Eira', early?.word);
ok('一排音波在动', early?.bars >= 9 && early?.moving > 0, JSON.stringify(early));
ok('铺满整屏', early?.full);
ok('没记过主题：按默认的浅色', early?.bg === 'rgb(255, 255, 255)', early?.bg);
ok('刚打开时不露那行说明', early?.note === 0, early?.note);
ok('不接点击', early?.clicks === 'none', early?.clicks);

await page.waitForTimeout(3500);
const later = await page.evaluate(() => ({
  splash: !!document.getElementById('splash'),
  app: document.getElementById('app').children.length,
}));
ok('第一屏画出来之后摘掉', !later.splash && later.app > 0, JSON.stringify(later));

// 等久了露出说明：拖到七秒
await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ theme: 'dark' }));
await page.waitForTimeout(300);
ok('进过一次深色：记下来', await page.evaluate(() => localStorage.getItem('eira-theme')) === 'dark');
await page.unroute('**/src/main.js');
await page.route('**/src/main.js', async r => { await new Promise(res => setTimeout(res, 7500)); r.continue(); });
await page.reload({ waitUntil: 'commit' });
await page.waitForTimeout(600);
ok('下一次启动画面直接是深色', await page.evaluate(() =>
  getComputedStyle(document.getElementById('splash')).backgroundColor) === 'rgb(0, 0, 0)');
await page.waitForTimeout(6300);
const note = await page.evaluate(() => {
  const n = document.getElementById('splash-note');
  return { text: n?.textContent || '', op: n ? +getComputedStyle(n).opacity : 0 };
});
ok('等久了底下露出一行说明', note.op > 0 && /正在载入/.test(note.text), JSON.stringify(note));
await page.waitForTimeout(2500);
ok('照样进得去', await page.evaluate(() => !document.getElementById('splash') && document.getElementById('app').children.length > 0));
await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ theme: 'light' }));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
