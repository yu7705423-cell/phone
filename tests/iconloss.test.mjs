// 一刷新图标就没了：复现
import { BASE, OUT, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console', m => { if (m.type()==='error'||m.type()==='warning') errs.push(`${m.type()}: ${m.text()}`); });
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2000);

// 存一个自定义图标 + 一张壁纸
const before = await page.evaluate(async (b64) => {
  const look = await import('/src/system/look.js');
  const db = await import('/src/system/db/index.js');
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  const file = new File([u8], 'icon.png', { type:'image/png' });
  const id = await look.setAppIconFile('chat', file);
  const wid = await db.images.put(new File([u8], 'wall.png', { type:'image/png' }));
  const lay = structuredClone(db.layout.get());
  lay.wallpaper = { ...(lay.wallpaper||{}), home: wid };
  db.layout.replace(lay);
  await new Promise(r => setTimeout(r, 900));      // 落盘
  return { iconId:id, wallId:wid,
    cells: db.layout.get().pages.reduce((n,p)=>n+(p.cells||[]).length, 0),
    icons: JSON.stringify(db.settings.get().appIcons || {}),
    imgs: db.images.all ? db.images.all().length : -1 };
}, PNG);
console.log('存之前:', JSON.stringify(before));
ok('存进去了', !!before.iconId && !!before.wallId, JSON.stringify(before));

for (let round = 1; round <= 3; round++) {
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2200);
  const after = await page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    const look = await import('/src/system/look.js');
    const lay = db.layout.get();
    return {
      stored: { settings: db.settings.stored(), layout: db.layout.stored() },
      icons: JSON.stringify(db.settings.get().appIcons || {}),
      wall: lay.wallpaper?.home || '',
      cells: (lay.pages||[]).reduce((n,p)=>n+(p.cells||[]).length, 0),
      chatIcon: look.appLook('chat')?.imageId || '',
      imgCount: (await (await import('/src/system/db/images.js')).images.all?.() || []).length ?? -1,
    };
  });
  console.log(`第 ${round} 次刷新:`, JSON.stringify(after));
  ok(`刷新 ${round} 次之后，自定义图标还在`, after.chatIcon === before.iconId,
    `期望 ${before.iconId}，实得 ${after.chatIcon}`);
  ok(`刷新 ${round} 次之后，壁纸还在`, after.wall === before.wallId,
    `期望 ${before.wallId}，实得 ${after.wall}`);
  ok(`刷新 ${round} 次之后，主界面上的格子还在`, after.cells === before.cells,
    `期望 ${before.cells}，实得 ${after.cells}`);
}
// 图真的画出来了吗。**不能只看库里有没有** —— 图标与壁纸的图都是靠一个
// 自定义属性喂进 CSS 的，那条声明要是没接上，库里好好的，屏幕上一片空白
await page.evaluate(async () => { const n=await import('/src/system/nav.js'); n.unlock(); n.goHome(); });
await page.waitForTimeout(1200);
const painted = await page.evaluate(() => {
  const tile = document.querySelector('.app-tile.has-image');
  const wall = document.querySelector('.wallpaper');
  const bg = el => el ? getComputedStyle(el).backgroundImage : '';
  return { tile: bg(tile).slice(0, 10), wall: bg(wall).slice(0, 10),
    hasTile: !!tile, hasWall: !!wall };
});
ok('自定义图标真的画出来了', /^url\(/.test(painted.tile), JSON.stringify(painted));
ok('壁纸真的画出来了', /^url\(/.test(painted.wall), JSON.stringify(painted));

// 那张图本身在库里吗
const blobOk = await page.evaluate(async (id) => {
  const { images } = await import('/src/system/db/images.js');
  const b = await images.blob(id);
  return { has: !!b, size: b?.size || 0, url: !!(await images.url(id)) };
}, before.iconId);
ok('那张图还在库里', blobOk.has && blobOk.size > 0, JSON.stringify(blobOk));
console.log('\n控制台里的错与警告:'); errs.slice(0,15).forEach(e=>console.log('   ', e));
await page.screenshot({path:`${OUT}/iconloss.png`});
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
