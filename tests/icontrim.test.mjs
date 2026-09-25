// 图标四周的透明边与图片大小（images.compressFit 的 trim、look.trimAppIcon / setAppIconScale，
// ARCHITECTURE 4.212）。
//
//   网上下的 png 图标四周常留一大圈透明，整张放进格子，图标本体只占中间一小块。
//   上传时自动裁掉；早先传的可以单个或一次全部裁；每个图标另有「图片大小」
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// 存下来的那张图：内容占了画布多宽（不透明像素外框的宽 / 画布宽）
const coverOf = id => page.evaluate(async id => {
  const { images } = await import('/src/system/db/images.js');
  const bmp = await createImageBitmap(await images.blob(id));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, x1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  return (x1 - x0 + 1) / c.width;
}, id);


const up = await page.evaluate(async () => {
  const look = await import('/src/system/look.js');
  const c = document.createElement('canvas'); c.width = 200; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = '#d33'; g.fillRect(70, 70, 60, 60);
  const blob = await new Promise(r => c.toBlob(b => r(b), 'image/png'));
  const id = await look.setAppIconFile('chat', new File([blob], 'a.png', { type: 'image/png' }));
  return id;
});
let cover = await coverOf(up);
ok('上传时自动裁掉四周的透明边：内容铺满画布', cover > 0.95, cover);

// 早先传的（不裁），再单独裁一次
const old = await page.evaluate(async () => {
  const { images, ICON_MAX } = await import('/src/system/db/images.js');
  const look = await import('/src/system/look.js');
  const c = document.createElement('canvas'); c.width = 200; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = '#33d'; g.fillRect(70, 70, 60, 60);
  const blob = await new Promise(r => c.toBlob(b => r(b), 'image/png'));
  const id = await images.putIcon(new File([blob], 'b.png', { type: 'image/png' }), ICON_MAX);
  look.setAppIcon('memory', { imageId: id });
  return id;
});
cover = await coverOf(old);
ok('早先传的那张：四周空着一大圈', cover < 0.4, cover);
const t1 = await page.evaluate(async () => (await import('/src/system/look.js')).trimAppIcon('memory'));
const now = await page.evaluate(async () => (await import('/src/system/look.js')).iconOverride('memory').imageId);
ok('单独裁一次：换成裁好的新图', t1 === true && now !== old && (await coverOf(now)) > 0.95, `${t1} ${await coverOf(now)}`);
ok('旧的那张删掉', await page.evaluate(async id => !(await import('/src/system/db/images.js')).images.has(id), old));
ok('本来就贴边的：再裁不动，说一声', await page.evaluate(async () => (await import('/src/system/look.js')).trimAppIcon('memory')) === false);

// ---- 图片大小 ----
await page.evaluate(async () => {
  (await import('/src/system/look.js')).setAppIconScale('chat', 130);
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome();
});
await page.waitForTimeout(700);
const size = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.app-tile.has-image')];
  return t.map(x => getComputedStyle(x).backgroundSize);
});
ok('图片大小 130%：主屏那一格照着画', size.includes('130%'), JSON.stringify(size));
await page.evaluate(async () => (await import('/src/system/look.js')).setAppIconScale('chat', 100));
ok('调回 100%：不再存这一项', await page.evaluate(async () => (await import('/src/system/look.js')).iconOverride('chat').scale) === undefined);

// ---- 界面 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.openApp('settings', '/appearance'); });
await page.waitForTimeout(800);
const text = await page.locator('.app-layer').innerText();
ok('外观页：一次去掉所有图片四周的透明边', /去掉所有图片四周的透明边/.test(text));
await page.locator('.list-item', { hasText: '聊天' }).filter({ hasText: '已使用图片' }).first().click();
await page.waitForTimeout(500);
const sheet = await page.locator('.sheet').last().innerText();
ok('点开图标：有「图片大小」与「去掉四周的透明边」', /图片大小/.test(sheet) && /去掉四周的透明边/.test(sheet), sheet.slice(0, 300));
await page.locator('.sheet input[type=range]').last().fill('70');
await page.waitForTimeout(300);
ok('拖滑杆：存上这一项', await page.evaluate(async () => (await import('/src/system/look.js')).iconOverride('chat').scale) === 70);
ok('预览那一格跟着变', await page.evaluate(() => getComputedStyle(document.querySelector('.sheet .app-tile-preview')).backgroundSize) === '70%');

// ---- 异形图标：不要底板 ----
ok('有「显示底板」开关，默认开着', await page.evaluate(async () => (await import('/src/system/look.js')).appLook('chat').bare) === false
  && await page.locator('.sheet .icon-switch', { hasText: '显示底板' }).count() === 1);
await page.evaluate(async () => (await import('/src/system/look.js')).setAppIcon('chat', { bare: true }));
await page.waitForTimeout(300);
ok('关掉底板：预览那一格只剩图片', await page.evaluate(() => {
  const c = getComputedStyle(document.querySelector('.sheet .app-tile-preview'));
  return c.backgroundColor === 'rgba(0, 0, 0, 0)' && c.boxShadow === 'none' && c.borderTopLeftRadius === '0px';
}));
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); });
await page.waitForTimeout(700);
const bare = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.app-tile.is-bare')];
  return t.map(x => { const c = getComputedStyle(x); return [c.backgroundColor, c.boxShadow, c.borderTopLeftRadius]; });
});
ok('主屏那一格同样只剩图片', bare.length === 1 && bare[0][0] === 'rgba(0, 0, 0, 0)' && bare[0][1] === 'none' && bare[0][2] === '0px', JSON.stringify(bare));
await page.evaluate(() => { document.documentElement.dataset.wallpaper = 'on'; document.documentElement.dataset.glass = 'on'; });
await page.waitForTimeout(100);
ok('有壁纸、开着毛玻璃时也不画底板', await page.evaluate(() => {
  const c = getComputedStyle(document.querySelector('.app-tile.is-bare'));
  return c.backgroundColor === 'rgba(0, 0, 0, 0)' && (c.backdropFilter === 'none' || !c.backdropFilter);
}));
ok('别的图标照旧有底板', await page.evaluate(() => {
  const c = getComputedStyle(document.querySelector('.app-tile:not(.is-bare)'));
  return c.backgroundColor !== 'rgba(0, 0, 0, 0)';
}));
await page.evaluate(() => { document.documentElement.dataset.wallpaper = 'off'; document.documentElement.dataset.glass = 'off'; });

// ---- 上传时不裁透明边 ----
const keep = await page.evaluate(async () => {
  const look = await import('/src/system/look.js');
  look.setAutoTrim(false);
  const c = document.createElement('canvas'); c.width = 200; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = '#3a3'; g.fillRect(70, 70, 60, 60);
  const blob = await new Promise(r => c.toBlob(b => r(b), 'image/png'));
  const id = await look.setAppIconFile('music', new File([blob], 'k.png', { type: 'image/png' }));
  look.setAutoTrim(true);
  return id;
});
cover = await coverOf(keep);
ok('关掉「上传时裁掉透明边」：透明留白原样保留', cover < 0.4, cover);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
