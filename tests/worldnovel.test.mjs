// 世界观生成器与长篇打通（ARCHITECTURE 4.265）
//
//   一、长篇向导里「从世界观生成器导入」：列出生成过的世界观，挑一份就成一本常驻的世界书挂上
//   二、同一份只建一本：再挑一次不重复建，那次运行上记着书的 id
//   三、世界观生成器「用它开一部长篇」：带着书进向导（/new/book/<id>），书已挂上、人物直接选
//   四、建出来的长篇写简介、大纲时带着世界观的内容
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = () => ev(() => document.body.innerText);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const toolbox = await import('/src/system/toolbox.js');
  const a = db.characters.create({ name: '沈砚', persona: '旧书店的老板。' });
  const run = toolbox.addRun('world', { title: '雨城', input: { name: '雨城', premise: '常年下雨的城' },
    output: { modules: { basis: '一座常年下雨的城市，电气时代。', history: '十年前有过一场大火。' } } });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('us', '/new');
  return { a: a.id, run: run.id };
});
await page.waitForTimeout(800);

// 一
await page.locator('.list-item', { hasText: '从世界观生成器导入' }).click();
await page.waitForTimeout(400);
ok('一、列出生成过的世界观', /雨城/.test(await text()) && /2 个模块/.test(await text()), (await text()).slice(0, 200));
await page.locator('.sheet .list-item', { hasText: '雨城' }).click();
await page.waitForTimeout(500);
const book = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const b = db.lorebooks.all().find(x => x.name === '雨城');
  return b ? { entries: b.entries.length, constant: b.entries.every(e => e.constant), names: b.entries.map(e => e.comment), runBook: db.toolRuns.get(o.run)?.bookId === b.id } : null;
}, ids);
ok('一、挑一份：成了一本常驻的世界书，每个模块一条', book && book.entries === 2 && book.constant && book.names.includes('世界基础'), JSON.stringify(book));
ok('一、向导里这本书已挂上', /雨城/.test(await text()) && await ev(() => [...document.querySelectorAll('.list-item')].some(e => /雨城/.test(e.innerText) && e.querySelector('.switch.is-on'))));

// 二
await page.locator('.list-item', { hasText: '从世界观生成器导入' }).click();
await page.waitForTimeout(300);
ok('二、再进来：写明已有对应的世界书', /已有对应的世界书/.test(await text()));
await page.locator('.sheet .list-item', { hasText: '雨城' }).click();
await page.waitForTimeout(400);
const count = await ev(async () => (await import('/src/system/db/index.js')).db.lorebooks.all().filter(x => x.name === '雨城').length);
ok('二、同一份只建一本', count === 1 && book.runBook, String(count));

// 三
const bid = await ev(async () => (await import('/src/system/db/index.js')).db.lorebooks.all().find(x => x.name === '雨城').id);
await ev(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('us', `/new/book/${id}`); }, bid);
await page.waitForTimeout(800);
const t3 = await text();
ok('三、带着书进向导：人物来源默认直接选，书已挂上', /直接选人物/.test(t3) && await ev(() => [...document.querySelectorAll('.list-item')].some(e => /雨城/.test(e.innerText) && e.querySelector('.switch.is-on'))), t3.slice(0, 200));

// 四
const items = await ev(() => [...document.querySelectorAll('.list-item')].map(e => e.innerText.split('\n')[0]));
ok('四、向导里列出了人物', items.includes('沈砚'), JSON.stringify(items));
await page.locator('.list-item', { hasText: '沈砚' }).first().click({ timeout: 5000 });
await page.locator('button', { hasText: /^建立$/ }).click();
await page.waitForTimeout(600);
const ctxText = await ev(async () => {
  const work = await import('/src/system/work.js');
  const novel = await import('/src/system/ai/tasks/novel.js');
  const w = work.all()[0];
  return { books: w.lorebookIds.length, world: novel.contextOf(w).world };
});
ok('四、建出来的长篇：写简介与大纲的材料里带着世界观', ctxText.books === 1 && /常年下雨/.test(ctxText.world) && /大火/.test(ctxText.world), JSON.stringify(ctxText).slice(0, 200));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
