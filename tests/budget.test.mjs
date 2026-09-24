// 注入预算默认不限（contextBudget = 0）。
//
// 从前默认 6000：世界书最多占四成（约 2400 token），条目一多就按优先级悄悄跳过。
// 老库里仍是 6000 的迁移成 0；自己填过别的数的不动。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// ---- 新装：默认不限，条目全部注入 ----
const fresh = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const lore = await import('/src/system/ai/context/lorebook.js');
  const entries = Array.from({ length: 12 }, (_, i) => ({
    id: `e${i}`, enabled: true, constant: true, content: `第 ${i} 条。` + '设定正文'.repeat(150),
  }));
  db.lorebooks.create({ name: '长书', global: true, entries });
  const c = db.characters.create({ name: '阿岚' });
  const b = db.settings.get().contextBudget;
  const all = lore.activate(c, '', Math.round(b * 0.4)).items.length;
  const capped = lore.activate(c, '', Math.round(6000 * 0.4)).items.length;
  return { b, all, capped };
});
ok('新装：注入预算默认不限（0）', fresh.b === 0, fresh.b);
ok('不限时 12 条长条目全部注入', fresh.all === 12, fresh.all);
ok('（对照）按旧默认 6000 只能进一部分', fresh.capped < 12, fresh.capped);

// ---- 老库：还是 6000 的迁移成不限，自己改过的不动 ----
const migrate = async value => {
  await page.evaluate(async v => {
    const { db } = await import('/src/system/db/index.js');
    const { idb, flushWrites } = await import('/src/system/db/idb.js');
    const { KV } = await import('/src/system/db/schema.js');
    db.settings.set({ contextBudget: v });
    await flushWrites();
    await idb.put('kv', { k: KV.schemaVersion, v: 10 });
  }, value);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.get().contextBudget);
};
let v = await migrate(6000);
ok('老库里是旧默认 6000：迁移成不限', v === 0, v);
v = await migrate(5000);
ok('老库里自己填了 5000：不动', v === 5000, v);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
