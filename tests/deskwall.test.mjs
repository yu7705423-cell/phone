// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 桌面与锁屏配上壁纸之后：压得住、字读得出来。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const id = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const t = await import('/src/system/theirs.js');
  acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', birthday: '4月12日', persona: '人设' });
  // 造一张浅色壁纸：不压一层的话白字就没了
  const c = document.createElement('canvas');
  c.width = 400; c.height = 800;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e2d8'; g.fillRect(0, 0, 400, 800);
  g.fillStyle = '#cfc6b6'; g.fillRect(0, 300, 400, 200);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await t.setWallpaper(a.id, new File([blob], 'w.png', { type: 'image/png' }));
  return a.id;
});
const go = async r => {
  await page.evaluate(([x]) => import('/src/system/nav.js').then(n => n.openApp('theirs', x)), [r]);
  await page.waitForTimeout(800);
};
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

await go(`/home/${id}`);
check(await page.evaluate(() => !!document.querySelector('.tp-lock.has-img')), '锁屏用上了那张壁纸');
check(await page.evaluate(() => document.documentElement.dataset.statusbar === 'light'),
  '锁屏上状态栏转成浅色');
await page.screenshot({ path: `${OUT}/tp-wall-lock.png` });

for (const d of '0412') {
  await page.evaluate(k => [...document.querySelectorAll('.tp-key')]
    .find(e => e.getAttribute('aria-label') === k).click(), d);
  await page.waitForTimeout(90);
}
await page.waitForTimeout(600);
check(await page.evaluate(() => !!document.querySelector('.tp-desk.has-img')), '桌面也用上了那张壁纸');
check(await page.evaluate(() => document.documentElement.dataset.statusbar === 'light'),
  '桌面上状态栏也是浅色');
const white = await page.evaluate(() => {
  const el = document.querySelector('.tp-name');
  return getComputedStyle(el).color;
});
check(/255, 255, 255/.test(white), `图标名称在壁纸上转成白字（${white}）`);
check(await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector('.tp-desk'), '::before');
  return s.backgroundColor !== 'rgba(0, 0, 0, 0)';
}), '壁纸上压了一层，浅色壁纸上的白字也读得出来');
await page.screenshot({ path: `${OUT}/tp-wall-desk.png` });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
