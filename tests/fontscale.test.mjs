// 字体：按网址添加（自己图床的外链）与整体字号（ARCHITECTURE 4.258）
//
//   一、设置 - 外观 - 字体里「按网址添加」：填字体文件的外链，下载后存在本机，正文选它后 --font 换成它
//   二、读不到的网址：说清楚，不留一条用不了的记录
//   三、整体字号：拉到 120%，正文与气泡的字号一起变大；恢复默认后回到原值；刷新后仍生效
import { BASE, EXE, chromium } from './_env.mjs';
import { existsSync, readFileSync } from 'node:fs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const TTF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';
const hasTtf = existsSync(TTF);
await page.route('https://img.example.com/**', r => {
  const u = r.request().url();
  if (/serif\.ttf$/.test(u) && hasTtf) {
    return r.fulfill({ status: 200, contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(TTF) });
  }
  return r.fulfill({ status: 404, body: 'nope' });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/appearance'); });
await page.waitForTimeout(800);

// 一
const addUrl = async url => {
  await page.locator('button', { hasText: '按网址添加' }).click();
  await page.waitForTimeout(300);
  await page.locator('.modal input').fill(url);
  await page.locator('.modal .modal-btn-primary').click();
  await page.waitForTimeout(1500);
};
if (hasTtf) {
  await addUrl('https://img.example.com/fonts/serif.ttf');
  const rec = await ev(async () => (await import('/src/system/fonts.js')).list().find(f => f.source));
  ok('一、按网址添加字体文件：多出一条记录，来源记着外链', !!rec && rec.source === 'https://img.example.com/fonts/serif.ttf' && !!rec.fileId, JSON.stringify(rec));
  await ev(async id => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ fontBody: id }); }, rec?.id);
  await page.waitForTimeout(800);
  const fontVar = await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--font'));
  ok('一、正文选它：--font 换成了这个字体', rec && fontVar.includes(`uf-${rec.id}`), fontVar);
  await ev(async () => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ fontBody: '' }); });
} else {
  console.log('  skip 一、找不到系统字体文件，跳过按网址添加');
}

// 二
const before = await ev(async () => (await import('/src/system/fonts.js')).list().length);
await addUrl('https://img.example.com/fonts/missing.woff2');
const after = await ev(async () => (await import('/src/system/fonts.js')).list().length);
const toastText = await page.locator('.toast').allInnerTexts().catch(() => []);
ok('二、读不到的网址：不留记录，界面上说明', after === before && /404|无法读取/.test(toastText.join(' ')), JSON.stringify({ before, after, toastText }));

// 三
const sizes = () => ev(() => ({ body: getComputedStyle(document.body).fontSize, fs14: getComputedStyle(document.documentElement).getPropertyValue('--fs-14').trim() }));
const base = await sizes();
await page.locator('.field', { hasText: '整体字号' }).locator('input[type="range"]').fill('120');
await page.waitForTimeout(400);
let cur = await sizes();
ok('三、字号拉到 120%：正文 15px 变 18px，--fs-14 变 16.8px', cur.body === '18px' && cur.fs14 === '16.8px', JSON.stringify({ base, cur }));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
cur = await sizes();
ok('三、刷新后仍是 120%', cur.body === '18px', JSON.stringify(cur));
await ev(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/appearance'); });
await page.waitForTimeout(800);
await page.locator('button', { hasText: '恢复默认字号' }).click();
await page.waitForTimeout(400);
cur = await sizes();
ok('三、恢复默认：回到 15px，令牌撤掉', cur.body === '15px' && cur.fs14 === '14px', JSON.stringify(cur));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
