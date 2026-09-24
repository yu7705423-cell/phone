// 聊天背景与上下栏（system/chatlook.js，ARCHITECTURE 4.198）。
//
// 会话右上角菜单进去，换背景图、调遮罩；上下栏可以实色 / 半透明 / 毛玻璃，换颜色、换字色；
// 默认上下一起，可以分开；只对这段会话生效，可以一键应用到全部；背景图登记在清理与角色包里。
import { BASE, EXE, OUT, chromium } from './_env.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const a = db.characters.create({ name: '阿岚' });
  const b = db.characters.create({ name: '小林' });
  const c1 = db.chats.create({ characterIds: [a.id], lastMessageAt: Date.now() });
  const c2 = db.chats.create({ characterIds: [b.id], lastMessageAt: Date.now() - 1000 });
  db.messages.create({ chatId: c1.id, role: 'user', authorId: 'me', kind: 'text', content: '在吗', status: 'done' });
  return { a: a.id, c1: c1.id, c2: c2.id };
});
const open = async chatId => {
  await page.evaluate(async id => {
    const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', `/chat/${id}`);
  }, chatId);
  await page.waitForTimeout(700);
};
const lookOf = id => page.evaluate(async i => (await import('/src/system/db/index.js')).db.chats.get(i).look || null, id);
const pageInfo = () => page.evaluate(() => {
  const pg = document.querySelector('.app-layer > .page');
  const nav = pg.querySelector(':scope > .navbar');
  const bar = pg.querySelector('.composer-bar');
  const cs = getComputedStyle(pg), ns = getComputedStyle(nav), bs = bar ? getComputedStyle(bar) : null;
  return { cls: pg.className, bgImg: cs.backgroundImage,
    navBg: ns.backgroundColor, navBlur: ns.backdropFilter || ns.webkitBackdropFilter, navText: ns.getPropertyValue('--text').trim(),
    barBg: bs?.backgroundColor, barBlur: bs?.backdropFilter || bs?.webkitBackdropFilter,
    sb: document.documentElement.dataset.statusbar || '' };
});

await open(ids.c1);
let info = await pageInfo();
ok('没设过：页面上不挂任何聊天背景的类名', !/has-chat-bg|look-top|look-bottom/.test(info.cls), info.cls);

// ---- 入口 ----
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(400);
await page.locator('.fullsheet .list-item', { hasText: '聊天背景' }).click();
await page.waitForTimeout(500);
ok('右上角菜单里有「聊天背景」，点开是半屏面板', (await page.locator('.overlay.is-preview .sheet', { hasText: '聊天背景' }).count()) === 1);
ok('面板底下的会话不压暗（边调边看）', await page.evaluate(() =>
  getComputedStyle(document.querySelector('.overlay.is-preview')).backgroundColor === 'rgba(0, 0, 0, 0)'));

// ---- 背景图 ----
mkdirSync(OUT, { recursive: true });
// 在页面里画一张真的图，免得手写的字节解码不了
const png = Buffer.from(await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 60; c.height = 120;
  const g = c.getContext('2d'); g.fillStyle = '#6a8'; g.fillRect(0, 0, 60, 120);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const b = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}), 'base64');
writeFileSync(`${OUT}/look-bg.png`, png);
await page.locator('.sheet input[type=file][accept="image/*"]').setInputFiles(`${OUT}/look-bg.png`);
await page.waitForTimeout(900);
let lk = await lookOf(ids.c1);
ok('从文件选择：存下了背景图', !!lk?.bg, JSON.stringify(lk));
info = await pageInfo();
ok('会话页铺上了背景图', /has-chat-bg/.test(info.cls) && /url\("blob:/.test(info.bgImg), info.bgImg.slice(0, 80));
ok('只换了背景、没动上下栏：两栏还是应用本来的样子', !/look-top|look-bottom/.test(info.cls), info.cls);
const used = await page.evaluate(async id => (await import('/src/system/purge.js')).usedImageIds().has(id), lk.bg);
ok('背景图登记在引用表里（清理无引用时不会被删）', used);
const packed = await page.evaluate(async ({ a, bg }) => (await import('/src/system/charpack.js')).collect(a).imgIds.includes(bg), { a: ids.a, bg: lk.bg });
ok('导出角色包时背景图跟着走', packed);

// 遮罩
await page.locator('.sheet .list-item', { hasText: '遮罩' }).locator('input.slider-num').fill('40');
await page.waitForTimeout(300);
ok('遮罩存下来，挂成 --ph-chat-veil', (await lookOf(ids.c1)).veil === 40
  && await page.evaluate(() => document.querySelector('.app-layer > .page').style.getPropertyValue('--ph-chat-veil') === '40%'));

// ---- 上下栏：毛玻璃、颜色、字色（默认上下一起）----
await page.locator('.sheet .seg-item', { hasText: '毛玻璃' }).click();
await page.waitForTimeout(300);
info = await pageInfo();
ok('毛玻璃：顶栏与输入栏一起换', /look-top/.test(info.cls) && /look-bottom/.test(info.cls), info.cls);
ok('毛玻璃：顶栏模糊、底色半透明', /blur\(20px\)/.test(info.navBlur) && /rgba?\(.*,\s*0\.[0-9]+\)|color\(srgb .* \/ 0\.[0-9]+\)/.test(info.navBg), `${info.navBlur} ${info.navBg}`);
ok('毛玻璃：输入栏同样模糊', /blur\(20px\)/.test(info.barBlur), info.barBlur);

await page.locator('.sheet .look-color[aria-label="#1C1C1E"]').click();
await page.locator('.sheet .seg-item', { hasText: '浅色' }).click();
await page.waitForTimeout(300);
info = await pageInfo();
ok('深色栏配浅字：顶栏里的字色换成浅色', info.navText.toUpperCase() === '#FFFFFF', info.navText);
ok('顶栏换了浅字：状态栏与悬浮返回键跟着换浅', info.sb === 'light', info.sb);
// 电脑上网页自己画状态栏，那一行在页面外面：给它顶栏的颜色，不然顶上一条白的
const sbBg = await page.evaluate(() => getComputedStyle(document.querySelector('.statusbar')).backgroundColor);
ok('网页自己画的状态栏那一行：和顶栏同一个颜色', sbBg === 'rgb(28, 28, 30)', sbBg);

// 透明度：界面上写的是透明度，存的是不透明度
await page.locator('.sheet .list-item', { hasText: '透明度' }).locator('input.slider-num').fill('60');
await page.waitForTimeout(300);
ok('透明度 60%：存成不透明度 40', (await lookOf(ids.c1)).top.alpha === 40, JSON.stringify((await lookOf(ids.c1)).top));

// ---- 上下分开 ----
await page.locator('.sheet .list-item', { hasText: '上下栏分开设置' }).locator('.switch, input[type=checkbox]').first().click();
await page.waitForTimeout(300);
lk = await lookOf(ids.c1);
ok('分开：输入栏从顶栏那一套抄一份起步', lk.split && lk.bottom?.style === 'glass' && lk.bottom?.color === '#1C1C1E', JSON.stringify(lk.bottom));
await page.evaluate(async id => (await import('/src/system/chatlook.js')).setLook(id, { bottom: { style: 'solid', color: '', fg: '' } }), ids.c1);
await page.waitForTimeout(300);
info = await pageInfo();
ok('分开后输入栏改回默认：只剩顶栏换了样式', /look-top/.test(info.cls) && !/look-bottom/.test(info.cls), info.cls);

// ---- 只对这段会话 ----
await page.locator('.overlay.is-preview').click({ position: { x: 200, y: 20 } });
await page.waitForTimeout(300);
await open(ids.c2);
info = await pageInfo();
ok('另一段会话不受影响', !/has-chat-bg|look-top|look-bottom/.test(info.cls), info.cls);
ok('离开那段会话：状态栏那一行恢复透明', await page.evaluate(() =>
  getComputedStyle(document.querySelector('.statusbar')).backgroundColor === 'rgba(0, 0, 0, 0)'));

// ---- 应用到全部 ----
await open(ids.c1);
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(400);
await page.locator('.fullsheet .list-item', { hasText: '聊天背景' }).click();
await page.waitForTimeout(400);
await page.locator('.sheet .btn', { hasText: '应用到全部会话' }).click();
await page.waitForTimeout(300);
await page.locator('.modal button', { hasText: '应用' }).click();
await page.waitForTimeout(400);
const [l1, l2] = [await lookOf(ids.c1), await lookOf(ids.c2)];
ok('应用到全部：另一段会话拿到同一套（背景图共用一个 id）', l2?.bg === l1.bg && l2?.top?.style === 'glass' && l2?.split === true, JSON.stringify(l2));

// ---- 恢复默认；图还被别的会话用着就不删 ----
await page.locator('.sheet .btn', { hasText: '恢复默认' }).click();
await page.waitForTimeout(300);
await page.locator('.modal button', { hasText: '恢复' }).click();
await page.waitForTimeout(600);
info = await pageInfo();
ok('恢复默认：这段会话回到应用本来的样子', !/has-chat-bg|look-top|look-bottom/.test(info.cls) && !(await lookOf(ids.c1)), info.cls);
ok('背景图另一段还在用：没被删', await page.evaluate(async id => (await import('/src/system/db/images.js')).images.has(id), l1.bg));
await page.evaluate(async id => (await import('/src/system/chatlook.js')).reset(id), ids.c2);
await page.waitForTimeout(600);
ok('两段都不用了：背景图删掉', !(await page.evaluate(async id => (await import('/src/system/db/images.js')).images.has(id), l1.bg)));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
