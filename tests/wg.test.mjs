import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

const cellId = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const hl = await import('/src/system/health.js');
  const lay = await import('/src/screens/home/layout.js');
  const t = hl.dateKey();
  hl.set(hl.ME, t, { sleepMin: 450, steps: 8231, weight: 58.2, water: 3, mood: 'flat' });
  hl.addMed({ name: '维生素 D', dose: '一粒', times: ['00:01'] });
  // 第一页腾个位置放挂件
  const l = structuredClone(db.layout.get());
  l.pages[0].cells = l.pages[0].cells.filter(c => c.y > 3);
  const id = 'hlwg';
  l.pages[0].cells.push({ id, kind: 'widget', ref: 'health', x: 0, y: 0, w: 2, h: 2 });
  db.layout.replace(l);
  const nav = await import('/src/system/nav.js'); nav.goHome();
  return id;
});
await page.waitForTimeout(800);

ck('挂件画出来了', await page.locator('.wg-health').count() > 0);
const labels = await page.locator('.wg-hl-one span').allInnerTexts();
ck('默认三项 ' + JSON.stringify(labels), JSON.stringify(labels) === '["睡眠","步数","喝水"]');
ck('默认不显示体重', !labels.includes('体重'));
const vals = await page.locator('.wg-hl-one b').allInnerTexts();
ck('数值对 ' + JSON.stringify(vals), vals[0] === '7h30' && vals[1] === '8,231' && vals[2] === '3');
ck('没记的药提示出来了', await page.locator('.wg-health .wg-row-sub').count() > 0);
await page.screenshot({ path: `${OUT}/wg1.png` });

// 自己加上体重
await page.evaluate(async id => {
  const lay = await import('/src/screens/home/layout.js');
  lay.setCellConfig(id, { show: ['sleep', 'steps', 'water', 'weight', 'mood'] });
}, cellId);
await page.waitForTimeout(500);
const l2 = await page.locator('.wg-hl-one span').allInnerTexts();
ck('加上之后体重与心情都在 ' + JSON.stringify(l2), l2.includes('体重') && l2.includes('心情'));

// 一格高的那一档不画标题栏
await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const l = structuredClone(db.layout.get());
  for (const p of l.pages) for (const c of p.cells) if (c.id === id) c.h = 1;
  db.layout.replace(l);
}, cellId);
await page.waitForTimeout(500);
ck('一格高时收起标题栏', await page.locator('.wg-health.is-flat .wg-head').count() === 0);
ck('一格高时数字还在', await page.locator('.wg-health.is-flat .wg-hl-one').count() > 0);

// 点一下进健康
await page.locator('.wg-health').click(); await page.waitForTimeout(600);
ck('点一下打开健康', await page.evaluate(async () =>
  (await import('/src/system/nav.js')).nav.get().appId === 'health'));

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '健康挂件全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
