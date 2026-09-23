// 批 6 主界面：跨页挪动、真移除、文件夹
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) {
  await page.locator('.lock-unlock').click(); await page.waitForTimeout(400);
}
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const t = await page.evaluate(async () => {
  const { layout } = await import('/src/system/db/index.js');
  const L = await import('/src/screens/home/layout.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const lay=()=>layout.get();
  const cellsOn=i=>(lay().pages[i]?.cells)||[];
  const allCells=()=> (lay().pages||[]).flatMap(p=>p.cells||[]);
  const findApp=(ref)=>{ for(let i=0;i<lay().pages.length;i++){ const c=cellsOn(i).find(c=>c.kind==='app'&&c.ref===ref); if(c) return {i,c}; } return null; };

  // 先摆一个干净的两页布局：第一页两个 app，第二页一个
  layout.replace(L.heal({ pages:[
    { id:'p1', cells:[
      { id:'a1', kind:'app', ref:'chat',     x:0, y:0, w:1, h:1 },
      { id:'a2', kind:'app', ref:'contact',  x:1, y:0, w:1, h:1 },
    ]},
    { id:'p2', cells:[
      { id:'b1', kind:'app', ref:'settings', x:0, y:0, w:1, h:1 },
    ]},
  ], dock:[], currentPage:0 }));
  ok('两页都还在', lay().pages.length>=2, lay().pages.length);

  // ---- 跨页挪到空位 ----
  // 从前：选中第一页的格子、翻到第二页再点，报「位置不存在」，看着像整页没了
  let r = L.movePicked(1, { type:'cell', id:'a1', page:0 }, { type:'slot', x:2, y:2 });
  ok('跨页挪到空位不再报错', r.ok, r.reason);
  ok('源头从第一页上消失了', !cellsOn(0).some(c=>c.id==='a1'));
  const moved = cellsOn(1).find(c=>c.id==='a1');
  ok('落在第二页给定的坐标上', moved && moved.x===2 && moved.y===2, JSON.stringify(moved));

  // ---- 跨页和另一个格子交换 ----
  r = L.movePicked(1, { type:'cell', id:'a2', page:0 }, { type:'cell', id:'b1' });
  ok('跨页交换不报错', r.ok, r.reason);
  const a2=L.locate(lay(),'a2'), b1=L.locate(lay(),'b1');
  ok('两个格子各自换了页', a2.pageIdx===1 && b1.pageIdx===0, `${a2.pageIdx} / ${b1.pageIdx}`);
  ok('坐标也对调了', a2.cell.x===0 && a2.cell.y===0, JSON.stringify(a2.cell));
  const three = ['a1','a2','b1'].map(id=>L.locate(lay(),id)).filter(Boolean);
  ok('三个格子一个不多一个不少', three.length===3
    && allCells().filter(c=>['a1','a2','b1'].includes(c.id)).length===3, three.length);

  // 同一页里挪动照旧
  r = L.movePicked(0, { type:'cell', id:'b1', page:0 }, { type:'slot', x:3, y:1 });
  const b=L.locate(lay(),'b1');
  ok('同页挪动没坏', r.ok && b.pageIdx===0 && b.x===undefined ? true : (r.ok && b.cell.x===3 && b.cell.y===1), r.reason);

  // 找不到的源头还是要报错，不能静默
  r = L.movePicked(0, { type:'cell', id:'不存在', page:0 }, { type:'slot', x:0, y:3 });
  ok('源头真没了才报错', !r.ok, r.reason);

  return R;
});
t.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 真移除 ----
const rm = await page.evaluate(async () => {
  const { layout } = await import('/src/system/db/index.js');
  const L = await import('/src/screens/home/layout.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const onHome = ref => (layout.get().pages||[]).some(p=>(p.cells||[]).some(c=>
    (c.kind==='app'&&c.ref===ref) || (c.kind==='folder'&&(c.apps||[]).includes(ref))));

  L.healAndSave();
  const found = (() => {
    for (const p of layout.get().pages) { const c=(p.cells||[]).find(c=>c.kind==='app'&&c.ref==='daily'); if(c) return c; }
    return null;
  })();
  ok('日常这个 app 摆在主界面上', !!found);
  const idx = layout.get().pages.findIndex(p=>(p.cells||[]).some(c=>c.id===found.id));
  L.clearCell(idx, found.id);
  ok('移除之后就不在了', !onHome('daily'));
  ok('记进了移除名单', L.removedApps().includes('daily'), JSON.stringify(L.removedApps()));

  // 这一条才是关键：从前 heal 会把它当成「还没摆出来的 app」又放回去
  L.healAndSave();
  ok('自愈一遍也不会自己回来', !onHome('daily'));
  L.healAndSave(); L.healAndSave();
  ok('反复自愈也不会回来', !onHome('daily'));

  L.restoreApp('daily');
  ok('放得回来', onHome('daily'));
  ok('放回来之后名单上就没有它了', !L.removedApps().includes('daily'));

  // 自己又把它摆回去的，名单也要跟着划掉
  const back = (() => { for (const p of layout.get().pages){ const c=(p.cells||[]).find(c=>c.kind==='app'&&c.ref==='daily'); if(c) return {p,c}; } })();
  L.clearCell(layout.get().pages.indexOf(back.p), back.c.id);
  ok('再移除一次', L.removedApps().includes('daily'));
  L.placeAtXY(0, 3, 4, { kind:'app', ref:'daily', w:1, h:1 });
  L.healAndSave();
  ok('自己放回去，名单自动划掉', !L.removedApps().includes('daily') && onHome('daily'), JSON.stringify(L.removedApps()));
  return R;
});
rm.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 文件夹 ----
const fd = await page.evaluate(async () => {
  const { layout } = await import('/src/system/db/index.js');
  const L = await import('/src/screens/home/layout.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const allCells = () => (layout.get().pages||[]).flatMap(p=>p.cells||[]);
  const folder = () => allCells().find(c=>c.kind==='folder');
  const appCell = ref => allCells().find(c=>c.kind==='app'&&c.ref===ref);

  L.healAndSave();
  let r = L.newFolder(0, 0, 5, ['daily','lorebook'], '杂项');
  ok('建得出文件夹', r.ok, r.reason);
  const f = folder();
  ok('名字存下来了', f && f.name==='杂项', f&&f.name);
  ok('装了两个', f.apps.length===2, JSON.stringify(f.apps));
  ok('永远是 1x1', f.w===1 && f.h===1);
  ok('装进去的就不在外面单独摆着了', !appCell('daily') && !appCell('lorebook'));

  ok('空文件夹建不出来', !L.newFolder(0, 1, 5, []).ok);

  // 自愈不能把文件夹里的 app 当成「没摆出来」又摆一份
  L.healAndSave();
  ok('自愈后不会重复摆一份', !appCell('daily') && folder().apps.includes('daily'));
  ok('自愈后文件夹还在', !!folder());

  // 取出来一个
  L.takeOut(folder().id, 'daily');
  ok('取出来的回到主界面上', !!appCell('daily'));
  ok('文件夹里就剩一个了', folder().apps.length===1, JSON.stringify(folder().apps));

  // 装回去
  L.putInFolder(folder().id, 'daily');
  ok('装得回去', folder().apps.length===2 && !appCell('daily'));

  // 改名
  L.setFolder(folder().id, { name:'收纳' });
  ok('改得了名字', folder().name==='收纳', folder().name);

  // 掏空就不留这个文件夹
  const fid = folder().id;
  L.setFolder(fid, { apps: [] });
  ok('掏空就一并去掉', !folder());
  L.healAndSave();
  ok('掏空之后里面的 app 自己回到主界面', !!appCell('daily') && !!appCell('lorebook'));

  // 移除一整个文件夹 = 里面的 app 一起移除
  L.newFolder(0, 0, 5, ['daily','lorebook'], '杂项');
  const fc = folder();
  const pi = layout.get().pages.findIndex(p=>(p.cells||[]).some(c=>c.id===fc.id));
  L.clearCell(pi, fc.id);
  L.healAndSave();
  ok('移除文件夹连里面的一起移除', !appCell('daily') && !appCell('lorebook') && !folder());
  ok('里面那几个都进了移除名单',
    L.removedApps().includes('daily') && L.removedApps().includes('lorebook'), JSON.stringify(L.removedApps()));
  L.restoreApp('daily'); L.restoreApp('lorebook');
  return R;
});
fd.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async () => {
  const L = await import('/src/screens/home/layout.js');
  L.healAndSave();
  L.newFolder(0, 0, 5, ['daily','lorebook'], '杂项');
});
await page.waitForTimeout(500);
const home = await page.locator('.home').innerText();
ok('主界面上看得见文件夹', home.includes('杂项'), home.slice(0,200));
const tiles = await page.locator('.folder-tile').count();
ok('文件夹画成了一格', tiles===1, String(tiles));
const dots = await page.locator('.folder-tile .app-tile').count();
ok('格子里露出里面的图标', dots===2, String(dots));
await page.screenshot({path:`${OUT}/home-folder.png`});

// 点开文件夹
await page.locator('.folder-tile').click();
await page.waitForTimeout(500);
const sheet = await page.locator('.sheet').innerText();
ok('点开看得见里面的 app', sheet.includes('日常')&&sheet.includes('世界书'), sheet.slice(0,150));
await page.screenshot({path:`${OUT}/home-folder-open.png`});
const before = await page.locator('.app-layer').count();
await page.locator('.folder-open .folder-app').first().click();
await page.waitForTimeout(600);
ok('点里面的图标进得去那个 app', (await page.locator('.app-layer').count())>before,
  `${before} -> ${await page.locator('.app-layer').count()}`);

// ---- 真的用手点一遍跨页挪动 ----
// 上面那些是直接调函数。这一段走界面：长按进整理、点图标、选「移动到别处」、
// 翻页、点空位。当初报「页面不存在」的就是这条路径。
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js'); nav.goHome();
  const { layout } = await import('/src/system/db/index.js');
  const L = await import('/src/screens/home/layout.js');
  layout.replace(L.heal({ pages:[
    { id:'p1', cells:[{ id:'u1', kind:'app', ref:'chat', x:0, y:0, w:1, h:1 }] },
    // 第二页要有点东西：heal 会把空页收掉（第一页除外）
    { id:'p2', cells:[{ id:'u2', kind:'app', ref:'settings', x:3, y:5, w:1, h:1 }] },
  ], dock:[], currentPage:0 }));
  layout.set({ currentPage: 0 });
});
await page.waitForTimeout(400);
const tile = page.locator('.cell-app').first();
await tile.dispatchEvent('mousedown');
await page.waitForTimeout(800);
await tile.dispatchEvent('mouseup');
await page.waitForTimeout(400);
ok('长按进得了整理模式', await page.locator('.edit-bar').count()===1);
await tile.click();
await page.waitForTimeout(400);
const menu = await page.locator('.sheet').innerText();
ok('菜单里写了翻页也可以', menu.includes('翻页'), menu.slice(0,200));
await page.locator('.sheet').getByText('移动到别处').click();
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const L = await import('/src/screens/home/layout.js'); L.setPage(1);
});
await page.waitForTimeout(400);
ok('翻到第二页之后选中还在', await page.locator('.edit-bar').innerText().then(t=>t.includes('翻页后再点')));
await page.locator('.cell-slot').first().click();
await page.waitForTimeout(500);
const after = await page.evaluate(async () => {
  const { layout } = await import('/src/system/db/index.js');
  const L = await import('/src/screens/home/layout.js');
  return L.locate(layout.get(), 'u1')?.pageIdx;
});
ok('点一下就挪到第二页了，不再报错', after===1, String(after));
const toastText = await page.locator('.toast').count();
ok('没有弹出任何错误提示', toastText===0, String(toastText));
await page.screenshot({path:`${OUT}/home-crosspage.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
