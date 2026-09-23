// 表情包：自己新建分组、逐条上传、粘贴导入
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);
const go = async r => {
  await page.evaluate(async y => {
    const nav = await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat', y);
  }, r);
  await page.waitForTimeout(700);
};
const txt = () => page.locator('.app-layer').innerText();
const tap = async t => {
  await page.getByText(t, { exact: true }).first().click({ timeout: 4000 });
  await page.waitForTimeout(400);
};

// 一张真的 png
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const file = { name: '开心.png', mimeType: 'image/png', buffer: PNG };

// ---- 1 自己新建一个空分组，建完看得见 ----
await go('/stickers');
check(/表情包/.test(await txt()), '表情包这一页打得开');
check(/新建分组/.test(await txt()), '页面上就有「新建分组」这一项');
await tap('新建分组');
await page.waitForTimeout(300);
await page.locator('.modal input').fill('猫猫');
await page.getByText('保存', { exact: true }).first().click();
await page.waitForTimeout(600);
const saved = await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.get().stickerGroups);
check(JSON.stringify(saved) === '["猫猫"]', `名字存下来了（${JSON.stringify(saved)}）`);
let body = await txt();
check(/猫猫 · 0/.test(body), `空分组也列出来（${body.slice(0, 200)}）`);
check(/这个分组还是空的/.test(body), '空着的时候写明白了怎么往里加');

// ---- 2 往这个分组里一条一条传 ----
await page.locator(`[aria-label="往「猫猫」里添加"]`).click();
await page.locator('input[type=file][accept="image/*"]:not([multiple])').setInputFiles(file);
await page.waitForTimeout(900);
check(/开心/.test(await page.locator('.sheet').innerText()), '传完当场打开那一条的编辑面板');
const one = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  return db.stickers.all().map(s => ({ name: s.name, group: s.group, img: !!s.imageId }));
});
check(one.length === 1 && one[0].group === '猫猫' && one[0].name === '开心' && one[0].img,
  `落进了那个分组（${JSON.stringify(one)}）`);

// 就地改名与改关键词
await page.locator('.sheet input').first().fill('大笑');
await page.waitForTimeout(400);
await page.getByText('完成', { exact: true }).first().click();
await page.waitForTimeout(500);
check(await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).stickers.all()[0].name) === '大笑', '名字当场改得了');

// ---- 3 粘贴导入：贴链接 ----
await go('/stickers');
await tap('粘贴导入');
await page.locator('.sheet textarea').fill('摊手|https://example.com/a.png\n哭|https://example.com/b.png');
await page.waitForTimeout(300);
await page.getByText('下一步', { exact: true }).first().click();
await page.waitForTimeout(500);
let sheet = await page.locator('.sheet').innerText();
check(/确认导入/.test(sheet) && /解析出 2 条/.test(sheet), `解析出两条（${sheet.slice(0, 120)}）`);
// 导进刚才那个分组
await page.locator('.sheet .chip', { hasText: '猫猫' }).first().click();
await page.waitForTimeout(200);
await page.getByText('导入 2 个', { exact: true }).first().click();
await page.waitForTimeout(900);
const after = await page.evaluate(async () => {
  const api = await import('/src/system/stickers.js');
  return api.inGroup('猫猫').map(s => s.name);
});
check(after.length === 3 && after.includes('摊手') && after.includes('哭'),
  `粘贴的两条进了猫猫（${JSON.stringify(after)}）`);

// ---- 4 粘贴导入：贴图片 ----
await go('/stickers');
await tap('粘贴导入');
await page.evaluate(() => {
  const ta = document.querySelector('.sheet textarea');
  const dt = new DataTransfer();
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  dt.items.add(new File([bytes], '贴进来的.png', { type: 'image/png' }));
  ta.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
});
await page.waitForTimeout(500);
check(/已收下 1 张图片/.test(await page.locator('.sheet').innerText()), '贴进来的图片当场收下');
await page.getByText('下一步', { exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByText('导入 1 个', { exact: true }).first().click();
await page.waitForTimeout(1200);
check(await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).stickers.count()) === 4, '贴进来的那张也入库了');
await page.screenshot({ path: `${OUT}/stk2.png` });

// ---- 5 改名与删除 ----
await go('/stickers');
await page.locator('[aria-label="重命名「猫猫」"]').click();
await page.waitForTimeout(300);
await page.locator('.modal input').fill('喵星人');
await page.getByText('保存', { exact: true }).first().click();
await page.waitForTimeout(600);
const renamed = await page.evaluate(async () => {
  const api = await import('/src/system/stickers.js');
  const db = await import('/src/system/db/index.js');
  return { groups: api.groups(), saved: db.settings.get().stickerGroups,
    n: api.inGroup('喵星人').length };
});
check(renamed.n === 3 && renamed.saved.includes('喵星人') && !renamed.saved.includes('猫猫'),
  `改名之后表情跟着走（${JSON.stringify(renamed)}）`);

await page.locator('[aria-label="删除「喵星人」"]').click();
await page.waitForTimeout(400);
await page.locator('.modal-btn-primary').click();
await page.waitForTimeout(700);
const gone = await page.evaluate(async () => {
  const api = await import('/src/system/stickers.js');
  const db = await import('/src/system/db/index.js');
  return { groups: api.groups(), saved: db.settings.get().stickerGroups, n: db.stickers.count() };
});
check(!gone.groups.includes('喵星人') && !gone.saved.includes('喵星人'),
  `删掉之后这个名字不再留着（${JSON.stringify(gone)}）`);

// ---- 6 空分组不会因为没有表情就消失 ----
const kept = await page.evaluate(async () => {
  const api = await import('/src/system/stickers.js');
  api.addGroup('存着的');
  return { has: api.groups().includes('存着的'), n: api.inGroup('存着的').length };
});
check(kept.has && kept.n === 0, `建完一个空的也在列表里（${JSON.stringify(kept)}）`);
const rt = await page.evaluate(async () => {
  const b = await import('/src/system/backup.js');
  const db = await import('/src/system/db/index.js');
  const blob = await b.build();
  db.settings.set({ stickerGroups: [] });
  await b.restore(blob);
  return db.settings.get().stickerGroups;
});
check((rt || []).includes('存着的'), `备份来回一趟分组还在（${JSON.stringify(rt)}）`);

// ---- 7 发送面板上不摆空分组 ----
const panel = await page.evaluate(async () => {
  const api = await import('/src/system/stickers.js');
  return { all: api.groups(), used: api.groups({ onlyUsed: true }) };
});
check(panel.all.includes('存着的') && !panel.used.includes('存着的'),
  `管理页列得出空分组，发送面板不列（${JSON.stringify(panel)}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
