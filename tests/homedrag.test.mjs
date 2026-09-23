// 主屏拖动：按住就拖、平时长按不松手接着拖、落空位、对调、挂件、进出 dock、贴边翻页、
// 落在外面回原处、拖完不误点、点一下仍是菜单、平时直接划不会拖
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(400); }
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

// 一个干净的布局：第一页三个应用、一个 2x2 挂件；dock 里一个设置
const reset = () => page.evaluate(async () => {
  const { layout } = await import('/src/system/db/index.js');
  const L = await import('/src/screens/home/layout.js');
  const reg = await import('/src/system/registry.js');
  const keep = ['chat', 'contact', 'memory', 'settings'];
  layout.replace(L.heal({
    pages: [{ id: 'p1', cells: [
      { id: 'a1', kind: 'app', ref: 'chat', x: 0, y: 0, w: 1, h: 1 },
      { id: 'a2', kind: 'app', ref: 'contact', x: 1, y: 0, w: 1, h: 1 },
      { id: 'a3', kind: 'app', ref: 'memory', x: 2, y: 0, w: 1, h: 1 },
      { id: 'w1', kind: 'widget', ref: 'memory-count', x: 0, y: 2, w: 2, h: 2 },
    ] }],
    dock: ['settings', null, null, null], currentPage: 0,
    removed: reg.listApps().map(a => a.id).filter(id => !keep.includes(id)),
  }));
  const n = await import('/src/system/nav.js'); n.goHome();
});
const edit = on => page.evaluate(async v => (await import('/src/screens/home/editState.js')).setEdit(v), on);
const lay = () => page.evaluate(async () => {
  const { layout } = await import('/src/system/db/index.js');
  const l = layout.get();
  return { pages: l.pages.map(p => p.cells.map(c => `${c.id}@${c.x},${c.y}`).sort()), dock: l.dock, cur: l.currentPage };
});
const at = async id => { const b = await page.locator(`[data-cell="${id}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
// 网格上 (x, y) 那一格的中心
const slot = (x, y) => page.evaluate(([x, y]) => {
  const g = document.querySelector('.home-grid').getBoundingClientRect();
  const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell'));
  const gap = parseFloat(getComputedStyle(document.querySelector('.home-grid')).gap) || 12;
  return { x: g.left + x * (cell + gap) + cell / 2, y: g.top + y * (cell + gap) + cell / 2 };
}, [x, y]);
const dockAt = async i => { const b = await page.locator(`[data-dock-slot="${i}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(from, to, { hold = 0, steps = 14, pause = 0 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
    await page.waitForTimeout(12);
  }
  if (pause) await page.waitForTimeout(pause);
  await page.mouse.up();
  await page.waitForTimeout(450);
}

await reset();
await page.waitForTimeout(600);
await edit(true);
await page.waitForTimeout(300);

// ---- 一、拖到空位 ----
{
  const from = await at('a1');
  const to = await slot(3, 1);
  // 拖到一半看一眼：影子跟着手、原处变淡、落点有框
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10); await page.waitForTimeout(12); }
  const mid = await page.evaluate(() => ({
    ghost: document.querySelectorAll('.drag-ghost').length,
    lifted: document.querySelector('[data-cell="a1"]')?.classList.contains('is-lifted'),
    drop: document.querySelector('.cell-drop')?.getAttribute('style') || '',
  }));
  await page.screenshot({ path: `${OUT}/homedrag-mid.png` });
  await page.mouse.up(); await page.waitForTimeout(450);
  ok('拖着的时候：有一个跟手的影子，原处变淡，落点画出来', mid.ghost === 1 && mid.lifted && /grid-area: 2 \/ 4 \/ span 1 \/ span 1/.test(mid.drop), JSON.stringify(mid));
  const l = await lay();
  ok('松手落在那一格', l.pages[0].includes('a1@3,1'), JSON.stringify(l.pages[0]));
  const after = await page.evaluate(() => ({ ghost: document.querySelectorAll('.drag-ghost').length, sheet: document.querySelectorAll('.sheet').length }));
  ok('松手后影子收走，也没有误点开菜单', after.ghost === 0 && after.sheet === 0, JSON.stringify(after));
}

// ---- 二、拖到同样大小的应用上：对调 ----
await drag(await at('a2'), await at('a3'));
{
  const l = await lay();
  ok('和同样大小的应用对调', l.pages[0].includes('a2@2,0') && l.pages[0].includes('a3@1,0'), JSON.stringify(l.pages[0]));
}

// ---- 三、挂件整块拖动：落点按左上角算 ----
{
  const w = await at('w1');
  // 抓住挂件右下角那一块往右拖两格
  const grab = { x: w.b.x + w.b.width * 0.75, y: w.b.y + w.b.height * 0.75 };
  const d = (await slot(2, 0)).x - (await slot(0, 0)).x;
  await drag(grab, { x: grab.x + d, y: grab.y });
  const l = await lay();
  ok('2x2 挂件整块挪到右边两格', l.pages[0].includes('w1@2,2'), JSON.stringify(l.pages[0]));
}

// ---- 四、拖进 dock，再从 dock 拖出来 ----
await drag(await at('a1'), await dockAt(1));
{
  const l = await lay();
  ok('应用拖进 dock 的空位', l.dock[1] === 'chat' && !l.pages[0].some(s => s.startsWith('a1@')), JSON.stringify(l));
}
await drag(await dockAt(0), await slot(0, 1));
{
  const l = await lay();
  ok('从 dock 拖到网格的空位', l.dock[0] === null && l.pages[0].length === 4, JSON.stringify(l));
}

// ---- 五、落在网格和 dock 之外：回原处 ----
{
  const before = await lay();
  const from = await at('a2');
  await drag(from, { x: from.x, y: 6 });
  ok('拖到外面松手，什么都不变', JSON.stringify(await lay()) === JSON.stringify(before));
}

// ---- 六、贴着右边缘停一会儿：翻页（最后一页有东西就新开一页），落在新的一页 ----
{
  const from = await at('a3');
  const edgePt = { x: 428, y: from.y + 40 };
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + (edgePt.x - from.x) * i / 12, from.y + (edgePt.y - from.y) * i / 12); await page.waitForTimeout(12); }
  await page.waitForTimeout(800);
  const target = await slot(1, 1);
  for (let i = 1; i <= 8; i++) { await page.mouse.move(edgePt.x + (target.x - edgePt.x) * i / 8, edgePt.y + (target.y - edgePt.y) * i / 8); await page.waitForTimeout(12); }
  await page.mouse.up(); await page.waitForTimeout(450);
  const l = await lay();
  ok('贴边翻到新的一页，落在那一页上', l.cur === 1 && (l.pages[1] || []).includes('a3@1,1') && !l.pages[0].some(s => s.startsWith('a3@')), JSON.stringify(l));
}

// ---- 七、点一下仍然是菜单 ----
await page.evaluate(async () => (await import('/src/screens/home/layout.js')).setPage(0));
await page.waitForTimeout(300);
await page.locator('[data-cell="a2"]').click();
await page.waitForTimeout(400);
ok('整理模式下点一下仍然弹出菜单', await page.locator('.sheet').count() > 0);
await page.keyboard.press('Escape'); await page.waitForTimeout(400);

// ---- 八、平时：直接划不会拖；长按不松手接着挪就拿起来 ----
await reset();
await edit(false);
await page.waitForTimeout(500);
{
  const before = await lay();
  await drag(await at('a2'), await slot(3, 3));
  ok('平时直接划过去，不会拿起图标', JSON.stringify(await lay()) === JSON.stringify(before));
  await drag(await at('a2'), await slot(3, 3), { hold: 750 });
  const l = await lay();
  const inEdit = await page.evaluate(async () => (await import('/src/screens/home/editState.js')).editState.get().edit);
  ok('平时长按不松手接着挪：进入整理并拿起来，落在那一格', inEdit && l.pages[0].includes('a2@3,3'), JSON.stringify(l.pages[0]));
}

await edit(false);
ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
