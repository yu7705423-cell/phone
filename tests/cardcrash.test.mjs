// 长卡片光栅：画布单边不许越界，越界要说得出原因而不是把页面带走
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:3})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/chat/completions', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- fitScale / checkSize ----
const g = await page.evaluate(async () => {
  const cs = await import('/src/system/cardshot.js');
  const rows = [10,50,100,200,400,1000].map(n => {
    const h = n*60, s = cs.fitScale(430,h), chk = cs.checkSize(430,h);
    return { n, h, s:+s.toFixed(3), cw:Math.round(430*s), ch:Math.round(h*s),
      area:+((430*s*h*s)/1e6).toFixed(1), ok:chk.ok, reason:chk.reason||'' };
  });
  return { rows, MAX_SIDE: cs.MAX_SIDE, MAX_AREA: cs.MAX_AREA, MIN_SCALE: cs.MIN_SCALE };
});
console.log('  条数   画布            面积    画不画');
g.rows.forEach(r => console.log(
  `  ${String(r.n).padStart(4)}  ${String(r.cw).padStart(4)}x${String(r.ch).padEnd(6)}  ${String(r.area).padStart(5)}M  ${r.ok?'画':'不画'}`));

ok('每一档的单边都不超上限',
  g.rows.every(r => r.cw <= g.MAX_SIDE && r.ch <= g.MAX_SIDE),
  JSON.stringify(g.rows.filter(r=>r.ch>g.MAX_SIDE).map(r=>`${r.n}条->${r.ch}`)));
ok('每一档的面积也都不超上限',
  g.rows.every(r => r.area*1e6 <= g.MAX_AREA*1.01), JSON.stringify(g.rows.map(r=>r.area)));
ok('短卡片照常按二倍画', g.rows[0].s===2 && g.rows[0].ok, JSON.stringify(g.rows[0]));
ok('一百条还画得出来', g.rows[2].ok, JSON.stringify(g.rows[2]));
ok('太长的那几档拒绝画', !g.rows[4].ok && !g.rows[5].ok,
  JSON.stringify(g.rows.slice(4).map(r=>({n:r.n,ok:r.ok}))));
ok('拒绝时说得出多高、以及该怎么办',
  /像素高/.test(g.rows[5].reason) && /分几次/.test(g.rows[5].reason), g.rows[5].reason);

// ---- 真的画一次：短的出图，长的回 null 且带原因 ----
const run = await page.evaluate(async () => {
  const cs = await import('/src/system/cardshot.js');
  const mk = n => Array.from({length:n}, (_,i) => ({
    id:'m'+i, role: i%2?'user':'char', kind:'text',
    content:'这是第'+i+'条消息，长度差不多就这样。', _name:'阿岚', createdAt: Date.now() }));
  const short = await cs.rasterCard({ msgs: mk(8), css:'' });
  const shortWhy = cs.whyNot();
  const long = await cs.rasterCard({ msgs: mk(400), css:'' });
  const longWhy = cs.whyNot();
  return { short: short ? short.size : 0, shortWhy, long: long ? long.size : null, longWhy };
});
ok('短卡片真的画出了一张 png', run.short > 0, String(run.short));
ok('短卡片没有「画不出来的原因」', run.shortWhy==='', run.shortWhy);
ok('四百条那张不画，回 null', run.long===null, String(run.long));
ok('并且 whyNot() 说得出为什么', /像素高/.test(run.longWhy||''), run.longWhy);
ok('页面还活着，没被带走', errs.length===0, errs.join(' | '));

// ---- 界面：相册里点「重新生成图片」 ----
const pid = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const album=await import('/src/system/album.js');
  const mk = n => Array.from({length:n}, (_,i) => ({
    id:'m'+i, role: i%2?'user':'char', kind:'text',
    content:'这是第'+i+'条消息，长度差不多就这样。', _name:'阿岚', createdAt: Date.now() }));
  const photo = await album.saveCard({ msgs: mk(400), css:'', title:'长卡片' });
  return photo.id;
});
await page.evaluate(async id => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('album','/'); n.popToRoot(); n.push(`/photo/${id}`);
}, pid);
await page.waitForSelector('.page'); await page.waitForTimeout(900);
const txt = await page.locator('.page').innerText();
ok('卡片页打得开', /消息卡片/.test(txt), txt.slice(0,120));
await page.locator('.list-item').filter({hasText:'生成图片'}).first().click();
await page.waitForTimeout(2500);
const toastTxt = await page.locator('.toast, .toast-item').innerText().catch(()=>'');
ok('点了不闪退，页面还在', (await page.locator('.page').count())>0 && errs.length===0,
  errs.join(' | '));
ok('toast 说的是这张太长，不是笼统的「画不出来」',
  /像素高/.test(toastTxt) && /分几次/.test(toastTxt), toastTxt);
await page.screenshot({path:`${OUT}/cardcrash.png`});

// ---- 存进库之后不许被压糊 ----
const kept = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const album=await import('/src/system/album.js');
  const cs=await import('/src/system/cardshot.js');
  const mk = n => Array.from({length:n}, (_,i) => ({
    id:'k'+i, role: i%2?'user':'char', kind:'text',
    content:'这是第'+i+'条消息，长度差不多就这样。', _name:'阿岚', createdAt: Date.now() }));
  const msgs = mk(60);
  const blob = await cs.rasterCard({ msgs, css:'' });
  if (!blob) return { err:'没画出来' };
  const photo = await album.saveCard({ msgs, css:'', title:'存一张' });
  const id = await db.images.put(new File([blob],'card.png',{type:'image/png'}), cs.MAX_SIDE);
  album.attachRaster(photo.id, id);
  const b = await db.images.blob(id);
  const bm = await createImageBitmap(b);
  const r = { w:bm.width, h:bm.height };
  bm.close && bm.close();
  return r;
});
ok('存进库的卡片没被压成 1280 的细条',
  !kept.err && kept.h > 1280, JSON.stringify(kept));
ok('存进库的宽度也还在', !kept.err && kept.w > 200, JSON.stringify(kept));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
