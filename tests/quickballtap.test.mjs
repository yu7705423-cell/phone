// 悬浮球在触屏上点一下：面板要留住（4.277）
//
// 用户反馈：点一下悬浮球，面板闪一下就没了。触屏浏览器在 pointerup 之后还会按当下的位置合成一次 click，
// 那时球已经隐掉、面板已经在，click 落在遮罩上，遮罩的「点外面关掉」把刚开的面板关了。
// 这里两种方式各查一遍：真的触屏轻点；以及照 iOS 的顺序手工发 pointerdown / pointerup / click。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ quickBall: { on: true, side: 'right', y: 0.4, size: 56 } });
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('settings', '/');
});
await page.waitForTimeout(800);
const center = () => ev(() => { const r = document.querySelector('.qb-ball').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const panelOpen = () => ev(() => !!document.querySelector('.qb-panel'));

// 一、真的触屏轻点
let c = await center();
await page.touchscreen.tap(c.x, c.y);
await page.waitForTimeout(600);
ok('触屏轻点：面板开着', await panelOpen());
// 点遮罩关掉（过了那一小段之后照常能关）
await page.waitForTimeout(200);
await page.touchscreen.tap(20, 800);
await page.waitForTimeout(400);
ok('过后点遮罩：面板关掉', !await panelOpen());

// 二、照 iOS 的顺序：pointerdown、pointerup 落在球上，再按当下位置合成一次 click
c = await center();
const r2 = await ev(async ({ x, y }) => {
  const ball = document.querySelector('.qb-ball');
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true };
  ball.dispatchEvent(new PointerEvent('pointerdown', opts));
  await new Promise(r => setTimeout(r, 60));
  ball.dispatchEvent(new PointerEvent('pointerup', opts));
  await new Promise(r => setTimeout(r, 30));
  const hit = document.elementFromPoint(x, y);
  hit?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  await new Promise(r => setTimeout(r, 200));
  return { hit: hit?.className || '', open: !!document.querySelector('.qb-panel') };
}, c);
ok('合成的 click 落在遮罩上：面板仍开着', r2.open, JSON.stringify(r2));
ok('面板里的项目点得到', await ev(() => document.querySelectorAll('.qb-item').length > 0));

console.log(`\n${R.filter(r => r.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(r => r.pass) && !errs.length ? 0 : 1);
