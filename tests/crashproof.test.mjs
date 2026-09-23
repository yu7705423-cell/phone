// 闪退那条路的复验：把页面里每一次画布创建都记下来，一个越界的都不许有
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:3})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('crash', () => errs.push('PAGE CRASHED'));
await page.route('**/chat/completions', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 把每一次「画布被设成多大」记下来。宽高是分两次赋值的，所以在 toBlob /
// drawImage 那一刻才算数 —— 这里两头都记，取最大
await page.evaluate(() => {
  window.__cv = [];
  const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const h = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  const note = el => { window.__cv.push({ w: el.width, h: el.height }); };
  Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
    get() { return d.get.call(this); },
    set(v) { d.set.call(this, v); note(this); } });
  Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
    get() { return h.get.call(this); },
    set(v) { h.set.call(this, v); note(this); } });
});
const canvases = () => page.evaluate(() => window.__cv.slice());
const limits = await page.evaluate(async () => {
  const cs = await import('/src/system/cardshot.js');
  return { side: cs.MAX_SIDE, area: cs.MAX_AREA, min: cs.MIN_SCALE };
});
console.log(`  上限：单边 ${limits.side}，面积 ${limits.area/1e6}M，最低倍率 ${limits.min}\n`);

// ---- 一、大范围输入，算出来的画布不许越界 ----
const fuzz = await page.evaluate(async ({side, area}) => {
  const cs = await import('/src/system/cardshot.js');
  const ws = [1, 100, 320, 430, 800, 1200, 2000, 5000];
  const hs = [1, 50, 600, 3000, 6000, 12000, 20000, 50000, 200000, 999999];
  const bad = [];
  let n = 0;
  for (const w of ws) for (const h of hs) {
    const s = cs.fitScale(w, h);
    const cw = Math.round(w*s), ch = Math.round(h*s);
    n++;
    if (!(s > 0) || !Number.isFinite(s)) { bad.push({w,h,s,why:'倍率不是正数'}); continue; }
    if (cw > side || ch > side) bad.push({w,h,cw,ch,why:'单边越界'});
    else if (cw*ch > area*1.01) bad.push({w,h,cw,ch,why:'面积越界'});
    if (s > 2) bad.push({w,h,s,why:'倍率超过 2'});
  }
  return { n, bad };
}, limits);
ok(`${fuzz.n} 组尺寸，算出来的画布没有一个越界`, fuzz.bad.length===0,
  JSON.stringify(fuzz.bad.slice(0,5)));

// ---- 二、真的画：短的、临界的、超长的 ----
const drew = await page.evaluate(async () => {
  const cs = await import('/src/system/cardshot.js');
  const mk = n => Array.from({length:n}, (_,i) => ({
    id:'m'+i, role:i%2?'user':'char', kind:'text',
    content:'第'+i+'条，随便写点内容凑长度。', _name:'阿岚', createdAt:Date.now() }));
  const out = {};
  for (const n of [5, 60, 150, 260, 400, 900]) {
    const b = await cs.rasterCard({ msgs: mk(n), css:'' });
    out[n] = { bytes: b ? b.size : null, why: cs.whyNot() };
  }
  return out;
});
console.log('  条数   结果');
Object.entries(drew).forEach(([n,v]) =>
  console.log(`  ${n.padStart(4)}   ${v.bytes ? v.bytes+' 字节' : '不画（'+(v.why||'无原因').slice(0,24)+'…）'}`));
ok('短卡片照常出图', drew['5'].bytes>0 && drew['60'].bytes>0, JSON.stringify(drew['5']));
ok('超长的一律不画，且都给了原因',
  drew['400'].bytes===null && drew['900'].bytes===null
  && /像素高/.test(drew['400'].why) && /像素高/.test(drew['900'].why),
  JSON.stringify([drew['400'],drew['900']]));

let cv = await canvases();
let over = cv.filter(c => c.w > limits.side || c.h > limits.side);
let overA = cv.filter(c => c.w*c.h > limits.area*1.01);
ok(`光栅这一路建了 ${cv.length} 个画布，没有单边越界的`, over.length===0, JSON.stringify(over.slice(0,4)));
ok('也没有面积越界的', overA.length===0, JSON.stringify(overA.slice(0,4)));

// ---- 三、走界面那条路：相册里点「重新生成图片」 ----
await page.evaluate(() => { window.__cv.length = 0; });
const pid = await page.evaluate(async () => {
  const album=await import('/src/system/album.js');
  const mk = n => Array.from({length:n}, (_,i) => ({
    id:'p'+i, role:i%2?'user':'char', kind:'text',
    content:'第'+i+'条，随便写点内容凑长度。', _name:'阿岚', createdAt:Date.now() }));
  const a = await album.saveCard({ msgs: mk(60), css:'', title:'正常' });
  const b = await album.saveCard({ msgs: mk(500), css:'', title:'超长' });
  return { okId: a.id, longId: b.id };
});
const clickRegen = async (id, label) => {
  await page.evaluate(async i => {
    const n=await import('/src/system/nav.js');
    n.goHome(); n.openApp('album','/'); n.popToRoot(); n.push(`/photo/${i}`);
  }, id);
  await page.waitForSelector('.page'); await page.waitForTimeout(700);
  await page.locator('.list-item').filter({hasText:'生成图片'}).first().click();
  // toast 会自己消失，所以早一点读；成没成另外看库里那一行，那个不会过期
  let t = '';
  for (let i=0;i<30 && !t;i++) {
    await page.waitForTimeout(150);
    t = await page.locator('.toast, .toast-item').innerText().catch(()=>'');
  }
  await page.waitForTimeout(2500);
  const alive = await page.locator('.page').count() > 0;
  const got = await page.evaluate(async i => {
    const db=await import('/src/system/db/index.js');
    const row = db.photos.get(i);
    return { hasImage: !!row?.imageId };
  }, id);
  console.log(`  ${label}：页面${alive?'还在':'没了'}，出图${got.hasImage?'成功':'没有'}，toast=${t.slice(0,40)}`);
  return { alive, toast: t, hasImage: got.hasImage };
};
const r1 = await clickRegen(pid.okId, '正常卡片');
ok('正常卡片点了不炸，并且真的出了图',
  r1.alive && r1.hasImage && /成功|已生成/.test(r1.toast), JSON.stringify(r1));
const r2 = await clickRegen(pid.longId, '超长卡片');
ok('超长卡片点了不炸', r2.alive, JSON.stringify(r2));
ok('超长卡片没有硬塞一张糊图进去', !r2.hasImage, JSON.stringify(r2));
ok('超长卡片说的是「太长」而不是笼统失败', /像素高/.test(r2.toast), r2.toast);

cv = await canvases();
over = cv.filter(c => c.w > limits.side || c.h > limits.side);
overA = cv.filter(c => c.w*c.h > limits.area*1.01);
const biggest = cv.reduce((a,c)=> (c.w*c.h > a.w*a.h ? c : a), {w:0,h:0});
console.log(`  界面这一路建了 ${cv.length} 个画布，最大的一个 ${biggest.w}x${biggest.h}`);
ok('界面这一路也没有单边越界的画布', over.length===0, JSON.stringify(over.slice(0,4)));
ok('也没有面积越界的', overA.length===0, JSON.stringify(overA.slice(0,4)));
ok('全程没有页面崩溃或运行时报错', errs.length===0, errs.join(' | '));
await page.screenshot({path:`${OUT}/crashproof.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
