// 喝水那一格加减都要能用，而且不能减到负数。
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
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const acc = await import('/src/system/accounts.js');
  acc.roots()[0] || acc.createRoot({ name: '我' });
  const h = await import('/src/system/health.js');
  h.set(h.ME, h.dateKey(), { sleepMin: 431, steps: 8421, weight: 58.4 });
  return import('/src/system/nav.js').then(n => n.openApp('health', '/'));
});
await page.waitForTimeout(900);

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
const water = () => page.evaluate(async () =>
  (await import('/src/system/health.js')).today('me').water || 0);
const tap = label => page.evaluate(l => {
  const b = [...document.querySelectorAll('button')].find(e => e.getAttribute('aria-label') === l);
  if (!b) throw new Error('找不到：' + l);
  b.click();
}, label);
const disabled = label => page.evaluate(l => {
  const b = [...document.querySelectorAll('button')].find(e => e.getAttribute('aria-label') === l);
  return !!b?.disabled;
}, label);

check(await water() === 0, '一开始 0 杯');
check(await disabled('少一杯'), '0 杯时减号是停用的');

await tap('多一杯'); await page.waitForTimeout(300);
await tap('多一杯'); await page.waitForTimeout(300);
await tap('多一杯'); await page.waitForTimeout(300);
check(await water() === 3, `加了三下是 3 杯（${await water()}）`);
check(!await disabled('少一杯'), '有水之后减号能用了');

await tap('少一杯'); await page.waitForTimeout(300);
check(await water() === 2, `减一下是 2 杯（${await water()}）`);

await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  h.set(h.ME, h.dateKey(), { water: 1 });
});
await page.waitForTimeout(400);
await tap('少一杯'); await page.waitForTimeout(300);
check(await water() === 0, '减到 0');
check(await disabled('少一杯'), '回到 0 之后减号又停用了');
// 就算绕过界面直接调，也不会变成负数
const neg = await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  h.addWater(h.ME, -5);
  return h.today(h.ME).water;
});
check(neg === 0, `直接减 5 也停在 0（${neg}）`);

// 上限那一头不拦（第 13 条）
const many = await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  h.set(h.ME, h.dateKey(), { water: 0 });
  for (let i = 0; i < 40; i++) h.addWater();
  return h.today(h.ME).water;
});
check(many === 40, `加到 40 杯也不拦（${many}）`);

// 别的三格照旧能点开
await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  h.set(h.ME, h.dateKey(), { water: 6 });
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.hl-tile')].find(e => e.innerText.includes('睡眠'));
  t.click();
});
await page.waitForTimeout(500);
check(await page.evaluate(() => /睡了多久/.test(document.body.innerText)),
  '睡眠那一格照旧点得开');
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.trim() === '好了')?.click());
await page.waitForTimeout(500);

await page.screenshot({ path: `${OUT}/water-light.png`, fullPage: true });
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/water-dark.png`, fullPage: true });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
