// 拍立得上的签名：个性签名用手写体放大写，下面一行小小的 @名字（ARCHITECTURE 4.204）。
//
//   签名字体是「手写」那一槽（--font-hand），默认系统楷体、行楷；可从字体库选，
//   也可以按网址添加：字体文件下载存本机，样式表网址（Google Fonts 那种）存成在线字体
import { BASE, EXE, chromium } from './_env.mjs';
import { existsSync, readFileSync } from 'node:fs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
// 假的字体网站：一份样式表、一个字体文件、一个读不到的
const TTF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';
await page.route('https://fonts.example.com/**', r => {
  const u = r.request().url();
  if (u.includes('css2')) {
    return r.fulfill({ status: 200, contentType: 'text/css', headers: { 'access-control-allow-origin': '*' },
      body: "@font-face { font-family: 'Test Hand'; src: url(https://fonts.example.com/hand.ttf); }" });
  }
  if (u.endsWith('.ttf') && existsSync(TTF)) {
    return r.fulfill({ status: 200, contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(TTF) });
  }
  return r.abort();
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const a = db.characters.create({ name: '阿岚', signature: '雨天不出门' });
  const b = db.characters.create({ name: '小林' });
  return { a: a.id, b: b.id };
});
const open = async id => {
  await page.evaluate(async i => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', `/card/${i}`); }, id);
  await page.waitForTimeout(700);
};
const foot = () => page.evaluate(() => ({
  sign: document.querySelector('.pola-sign')?.textContent || '',
  at: document.querySelector('.pola-at')?.textContent || '',
  font: getComputedStyle(document.querySelector('.pola-sign')).fontFamily,
  size: parseFloat(getComputedStyle(document.querySelector('.pola-sign')).fontSize),
}));

await open(ids.a);
let f = await foot();
ok('白边上是个性签名', f.sign === '雨天不出门', f.sign);
ok('签名用手写体（默认系统楷体、行楷）', /Xingkai|Kaiti/i.test(f.font), f.font);
ok('签名放大写', f.size >= 22, f.size);
ok('下面一行小小的 @名字', f.at === '@阿岚', f.at);
await open(ids.b);
f = await foot();
ok('没有签名的：白边上写名字，不再重复 @', f.sign === '小林' && f.at === '', JSON.stringify(f));

// ---- 签名字体 ----
await open(ids.a);
await page.locator('.list-item', { hasText: '签名字体' }).click();
await page.waitForTimeout(500);
let sheet = await page.locator('.sheet').last().innerText();
ok('签名字体：列出默认与几款常用手写体', /默认手写体/.test(sheet) && /马善政楷书/.test(sheet) && /需要联网/.test(sheet), sheet.slice(0, 300));

// 样式表网址：存成在线字体
const css = await page.evaluate(async () => {
  const fonts = await import('/src/system/fonts.js');
  const rec = await fonts.addUrl('https://fonts.example.com/css2?family=Test+Hand');
  return rec;
});
ok('样式表网址：存成在线字体，照样式表里的 family 叫', css.css && css.family === 'Test Hand' && !css.fileId, JSON.stringify(css));
await page.evaluate(async id => (await import('/src/system/db/index.js')).db.settings.set({ fontHand: id }), css.id);
await page.waitForTimeout(600);
f = await foot();
ok('选中之后，签名换成这款', /Test Hand/.test(f.font), f.font);
ok('挂上了那份样式表', await page.evaluate(id => !!document.getElementById(`font-css-${id}`), css.id));

// 字体文件网址：下载存本机
if (existsSync(TTF)) {
  const file = await page.evaluate(async () => {
    const fonts = await import('/src/system/fonts.js');
    return fonts.addUrl('https://fonts.example.com/hand.ttf', '测试手写');
  });
  ok('字体文件网址：下载下来存进本机', !!file.fileId && file.source === 'https://fonts.example.com/hand.ttf' && file.name === '测试手写', JSON.stringify(file));
}

// 读不到：说清楚，不存
const bad = await page.evaluate(async () => {
  const fonts = await import('/src/system/fonts.js');
  const before = fonts.list().length;
  try { await fonts.addUrl('https://fonts.example.com/nope.woff2'); return 'saved'; }
  catch (e) { return { msg: e.message, same: fonts.list().length === before }; }
});
ok('读不到的网址：说清楚原因，不存', bad.same && /无法读取|跨域/.test(bad.msg), JSON.stringify(bad));
ok('不是 https 的网址：不收', await page.evaluate(async () => {
  const fonts = await import('/src/system/fonts.js');
  try { await fonts.addUrl('http://x.com/a.ttf'); return false; } catch (e) { return /https/.test(e.message); }
}));

// 删掉正在用的那款：签名回到默认手写体
await page.evaluate(async id => (await import('/src/system/fonts.js')).remove(id), css.id);
await page.waitForTimeout(500);
ok('删掉正在用的在线字体：签名回到默认', await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.get().fontHand) === '');
ok('样式表一并摘掉', await page.evaluate(id => !document.getElementById(`font-css-${id}`), css.id));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad2 = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad2}/${R.length} 通过`);
process.exit(bad2 ? 1 : 0);
