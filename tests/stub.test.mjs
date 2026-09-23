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

// 全新安装：默认版式里不该再有占位
const fresh = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const lay = await import('/src/screens/home/layout.js');
  lay.healAndSave();
  const l = db.layout.get();
  const refs = [];
  for (const p of l.pages) for (const c of p.cells) {
    if (c.kind === 'app') refs.push(c.ref);
    if (c.kind === 'folder') refs.push(...(c.apps || []));
  }
  refs.push(...(l.dock || []).filter(Boolean));
  const reg = await import('/src/system/registry.js');
  return { refs, known: reg.listApps().map(a => a.id) };
});
ck('注册表里没有占位了 ' + fresh.known.join(' '), !fresh.known.some(id => id.startsWith('stub-')));
ck('默认版式里没有占位', !fresh.refs.some(r => String(r).startsWith('stub-')));
ck('真 app 都摆上了 ' + fresh.refs.join(' '),
  ['chat', 'contact', 'theater', 'health', 'daily', 'bill', 'space', 'settings', 'music', 'memory', 'lorebook']
    .every(id => fresh.refs.includes(id)));

// 老用户：版式里还留着占位，格子里、文件夹里、dock 里、removed 里都有
const healed = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const lay = await import('/src/screens/home/layout.js');
  db.layout.replace({
    pages: [{ id: 'p1', cells: [
      { id: 'x1', kind: 'app', ref: 'stub-photos', x: 0, y: 0, w: 1, h: 1 },
      { id: 'x2', kind: 'app', ref: 'memory', x: 1, y: 0, w: 1, h: 1 },
      { id: 'x3', kind: 'folder', name: '杂项', apps: ['stub-map', 'music', 'stub-mail'], x: 2, y: 0, w: 1, h: 1 },
    ] }],
    dock: ['chat', 'stub-clock', null, null],
    removed: ['stub-notes', 'bill'],
    currentPage: 0,
    wallpaper: { home: null, lock: null },
  });
  lay.healAndSave();
  const l = db.layout.get();
  const cells = l.pages.flatMap(p => p.cells);
  return {
    appRefs: cells.filter(c => c.kind === 'app').map(c => c.ref),
    folder: cells.find(c => c.kind === 'folder')?.apps || [],
    dock: l.dock,
    removed: l.removed || [],
    all: cells.length,
  };
});
ck('格子里的占位被清掉 ' + JSON.stringify(healed.appRefs), !healed.appRefs.includes('stub-photos'));
ck('原有的真 app 还在', healed.appRefs.includes('memory'));
ck('文件夹里的占位被清掉 ' + JSON.stringify(healed.folder),
  JSON.stringify(healed.folder) === '["music"]');
ck('dock 里的占位被清掉 ' + JSON.stringify(healed.dock), !healed.dock.includes('stub-clock'));
ck('dock 里的真 app 还在', healed.dock.includes('chat'));
ck('removed 里的占位被清掉 ' + JSON.stringify(healed.removed),
  !healed.removed.includes('stub-notes') && healed.removed.includes('bill'));

// 主界面能正常画出来，不炸
await page.evaluate(async () => (await import('/src/system/nav.js')).goHome());
await page.waitForTimeout(700);
ck('主界面画得出来', await page.locator('.home-grid').count() > 0);
ck('没有页面炸掉', await page.locator('.boundary, .err-box').count() === 0);
await page.screenshot({ path: `${OUT}/nostub.png` });

// 已移除应用那一页也不该列出占位
const removedList = await page.evaluate(async () =>
  (await import('/src/screens/home/layout.js')).removedApps());
ck('已移除列表里没有占位 ' + JSON.stringify(removedList),
  !removedList.some(id => String(id).startsWith('stub-')));

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '删占位全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
