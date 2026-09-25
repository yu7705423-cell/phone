// 世界书批量导入与导出（system/lorefile.js，ARCHITECTURE 4.235）
//
//   一、导出成一个 zip（txt）：删掉原来的再整个导回来，每一条的关键词、常驻、位置、深度原样还原
//   二、导出成单独的 docx：每本一个文件；导回一个 docx，内容一样
//   三、别处来的文字（一篇设定，没有小标题）：整篇一条，确认页上定全局、常驻、位置、深度后保存
//   四、确认页上关掉某一本：那一本不入库；保存之前一条都不入库
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const downloads = [];
page.on('download', d => downloads.push(d));

// 记下点下载那一刻 a.download 是什么。Playwright 的 suggestedFilename() 在这个 context 里
// 稳定回「download」（见 skinpack.test.mjs），测的该是页面设的名字
await page.addInitScript(() => {
  window.__dl = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); return orig.apply(this, arguments); };
});
const dlNames = () => page.evaluate(() => window.__dl.slice());
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const E = (o) => ({ id: 'e' + Math.random().toString(36).slice(2), comment: '', keys: [], secondaryKeys: [], content: '',
    enabled: true, constant: false, priority: 100, order: 0, part: 'before', depth: 0, caseSensitive: false, probability: 100, ...o });
  db.lorebooks.create({ name: '校园设定', description: '', global: true, entries: [
    E({ comment: '学校', keys: ['学校', '校园'], content: '一所临海的高中。\n\n第二段。', part: 'after', depth: 3 }),
    E({ comment: '规矩', constant: true, content: '晚自习到九点。', enabled: false }),
  ] });
  db.lorebooks.create({ name: '画风', description: '', global: false, forImage: true, entries: [
    E({ comment: '色调', keys: ['画面'], content: '低饱和，胶片颗粒。' }),
  ] });
});
const go = r => page.evaluate(async route => {
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('lorebook', '/'); n.popToRoot(); if (route !== '/') n.push(route);
}, r);
// 点「批量导入」，在弹出的选择框里选文件
const pickFiles = async files => {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('button', { hasText: '批量导入' }).click(),
  ]);
  await chooser.setFiles(files);
};
const books = () => page.evaluate(async () => (await import('/src/system/db/index.js')).lorebooks.all()
  .map(b => ({ name: b.name, global: b.global, forImage: !!b.forImage, entries: b.entries.map(e => ({
    comment: e.comment, keys: e.keys, constant: e.constant, enabled: e.enabled, part: e.part, depth: e.depth, content: e.content })) })));
const before = await books();

// ---- 一、zip ----
await go('/export');
await page.waitForTimeout(500);
await page.locator('.seg-item, button', { hasText: '一个 zip' }).first().click();
await page.locator('button', { hasText: /^导出$/ }).click();
await page.waitForTimeout(1500);
const zipNames = await dlNames();
ok('导出成一个 zip：下载了一个文件', downloads.length === 1 && zipNames.length === 1 && /^世界书-.*\.zip$/.test(zipNames[0]),
  JSON.stringify(zipNames));
const zipPath = join(OUT, 'lore.zip');
await downloads[0].saveAs(zipPath);

await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.lorebooks.all().forEach(b => db.lorebooks.remove(b.id));
});
await go('/');
await page.waitForTimeout(800);
await pickFiles(zipPath);
await page.waitForTimeout(1500);
ok('选了 zip：进到确认页，两本', (await page.locator('.lb-draft').count()) === 2);
ok('确认之前一本都没入库', (await books()).length === 0);
await page.locator('button', { hasText: /^保存 2 本$/ }).click();
await page.waitForTimeout(600);
const back = await books();
const norm = list => JSON.stringify(list.sort((a, b) => a.name.localeCompare(b.name)));
ok('导回来：两本书、每一条的设置与正文原样还原', norm(back) === norm(before), `${norm(back)}\n    vs ${norm(before)}`);

// ---- 二、docx 单独文件 ----
downloads.length = 0;
await page.evaluate(() => { window.__dl = []; });
await go('/export');
await page.waitForTimeout(500);
await page.locator('.seg-item, button', { hasText: 'docx' }).first().click();
await page.locator('.seg-item, button', { hasText: '单独文件' }).first().click();
await page.locator('button', { hasText: /^导出$/ }).click();
await page.waitForTimeout(2500);
const names = await dlNames();
ok('导出成单独的 docx：每本一个，按书名起名', downloads.length === 2 && names.length === 2
  && names.includes('校园设定.docx') && names.includes('画风.docx'), JSON.stringify(names));
const docxPath = join(OUT, 'lore.docx');
const one = downloads[names.indexOf('校园设定.docx')];
await one.saveAs(docxPath);
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.lorebooks.all().forEach(b => db.lorebooks.remove(b.id));
});
await go('/');
await page.waitForTimeout(800);
await pickFiles(docxPath);
await page.waitForTimeout(1500);
await page.locator('button', { hasText: /^保存 1 本$/ }).click();
await page.waitForTimeout(600);
const fromDocx = await books();
ok('docx 导回来：内容与设置一样', norm(fromDocx) === norm(before.filter(b => b.name === '校园设定')), norm(fromDocx));

// ---- 三、四：别处来的文字 ----
// 文件名用英文：Playwright 的选择框传全是中文名的文件时，页面收不到 change（工具的问题，不是应用的）
const prose = join(OUT, 'seaside-town.txt');
writeFileSync(prose, '小镇在海边，常年刮东南风。\n\n镇上只有一条街。');
const junk = join(OUT, 'skip-this.txt');
writeFileSync(junk, '这一本不导入。');
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.lorebooks.all().forEach(b => db.lorebooks.remove(b.id));
});
await go('/');
await page.waitForTimeout(800);
await pickFiles([prose, junk]);
await page.waitForTimeout(1200);
const card = page.locator('.lb-draft', { hasText: 'seaside-town' });
ok('没有小标题的一篇：读成一条，默认常驻', (await card.innerText()).includes('1 个条目')
  && await card.locator('.list-item', { hasText: '常驻' }).locator('.switch').getAttribute('aria-checked') !== 'false');
await card.locator('.list-item', { hasText: '全局生效' }).locator('.switch').click();
await card.locator('.seg-item, button', { hasText: '角色后' }).first().click();
await card.locator('.field', { hasText: '注入深度' }).locator('input').fill('2');
await page.locator('.lb-draft', { hasText: 'skip-this' }).locator('.list-item', { hasText: '导入这一本' }).locator('.switch').click();
await page.waitForTimeout(200);
await page.locator('button', { hasText: /^保存 1 本$/ }).click();
await page.waitForTimeout(600);
const got = await books();
ok('关掉的那一本没有入库', got.length === 1 && got[0].name === 'seaside-town', JSON.stringify(got));
const e = got[0]?.entries[0] || {};
ok('确认页上定的设置落到了条目上', got[0]?.global === true && e.constant === true && e.part === 'after' && e.depth === 2
  && /常年刮东南风/.test(e.content) && /只有一条街/.test(e.content), JSON.stringify(got[0]));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
