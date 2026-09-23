// 开机自愈不许把「这一次没读到」写成「用户的布局就是默认的」
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932}});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/chat/completions', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const rawKV = () => page.evaluate(() => new Promise((res,rej)=>{
  const r = indexedDB.open('phone');
  r.onsuccess = () => { const db=r.result;
    const t=db.transaction('kv','readonly'); const q=t.objectStore('kv').get('layout');
    q.onsuccess=()=>{ db.close(); res(q.result ? q.result.v : null); }; q.onerror=()=>rej(q.error); };
  r.onerror=()=>rej(r.error);
}));
const delKV = () => page.evaluate(() => new Promise((res,rej)=>{
  const r = indexedDB.open('phone');
  r.onsuccess = () => { const db=r.result;
    const t=db.transaction('kv','readwrite'); t.objectStore('kv').delete('layout');
    t.oncomplete=()=>{ db.close(); res(true); }; t.onerror=()=>rej(t.error); };
  r.onerror=()=>rej(r.error);
}));

// 摆一份「用户自己弄过」的布局：换壁纸、给一个格子挂自定义图标
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const lay = structuredClone(db.layout.get());
  lay.wallpaper = { home: 'img_wall_home', lock: 'img_wall_lock' };
  lay.pages[0].cells.push({ id:'c_custom', kind:'app', ref:'chat', x:3, y:5, w:1, h:1,
    config:{ imageId:'img_icon_1' } });
  db.layout.replace(lay);
  await new Promise(r=>setTimeout(r,300));
});
let saved = await rawKV();
ok('先确认库里确实存下了这一份', !!saved && saved.wallpaper?.home==='img_wall_home',
  JSON.stringify(saved?.wallpaper));
const before = JSON.stringify(saved);

// 一、正常开机：读得到，自愈之后壁纸和自定义图标都还在
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2000);
saved = await rawKV();
ok('正常开机后壁纸还在', saved?.wallpaper?.home==='img_wall_home', JSON.stringify(saved?.wallpaper));
ok('正常开机后自定义图标还在',
  (saved?.pages||[]).some(p=>(p.cells||[]).some(c=>c.config?.imageId==='img_icon_1')),
  JSON.stringify(saved?.pages?.[0]?.cells?.slice(-2)));

// 二、这一次没读到（模拟崩溃之后那一下）：**不许回写**
await delKV();
ok('已经把那条记录抹掉，模拟读不到', (await rawKV())===null);
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
const after = await rawKV();
ok('读不到时开机不回写，库里仍然是空的（没被默认值盖掉）', after===null,
  after ? JSON.stringify(after).slice(0,200) : 'null');
ok('这一屏仍然画得出来，没有报错', errs.length===0, errs.join(' | '));
const screen = await page.evaluate(() => document.querySelector('#app')?.children.length || 0);
ok('界面照常渲染', screen>0, String(screen));

// 三、把记录放回去，再开机 —— 应该原样读回来
await page.evaluate(async (v) => new Promise((res,rej)=>{
  const r = indexedDB.open('phone');
  r.onsuccess = () => { const db=r.result;
    const t=db.transaction('kv','readwrite'); t.objectStore('kv').put({k:'layout', v});
    t.oncomplete=()=>{ db.close(); res(true); }; t.onerror=()=>rej(t.error); };
}), JSON.parse(before));
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2000);
const back = await rawKV();
ok('记录回来之后壁纸原样读回', back?.wallpaper?.home==='img_wall_home', JSON.stringify(back?.wallpaper));
ok('自定义图标也原样读回',
  (back?.pages||[]).some(p=>(p.cells||[]).some(c=>c.config?.imageId==='img_icon_1')));

// 四、用户自己改一下，仍然要存得进去
await page.evaluate(async () => {
  const lay = await import('/src/screens/home/layout.js');
  const db = await import('/src/system/db/index.js');
  const cur = structuredClone(db.layout.get());
  cur.wallpaper = { home:'img_wall_new', lock:null };
  db.layout.replace(cur);
  lay.healAndSave();
  await new Promise(r=>setTimeout(r,300));
});
const edited = await rawKV();
ok('用户改过之后照常落盘', edited?.wallpaper?.home==='img_wall_new', JSON.stringify(edited?.wallpaper));

// 五、settings 那一半：图标存在 settings.appIcons 里，同样不许被开机盖掉
const rawSet = () => page.evaluate(() => new Promise((res,rej)=>{
  const r = indexedDB.open('phone');
  r.onsuccess = () => { const db=r.result;
    const t=db.transaction('kv','readonly'); const q=t.objectStore('kv').get('settings');
    q.onsuccess=()=>{ db.close(); res(q.result ? q.result.v : null); }; q.onerror=()=>rej(q.error); };
}));
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ appIcons: { chat: { imageId: 'img_icon_chat' } } });
  await new Promise(r=>setTimeout(r,300));
});
ok('图标存进 settings.appIcons 了', (await rawSet())?.appIcons?.chat?.imageId==='img_icon_chat');
await page.evaluate(() => new Promise((res,rej)=>{
  const r = indexedDB.open('phone');
  r.onsuccess = () => { const db=r.result;
    const t=db.transaction('kv','readwrite'); t.objectStore('kv').delete('settings');
    t.oncomplete=()=>{ db.close(); res(true); }; t.onerror=()=>rej(t.error); };
}));
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
ok('settings 读不到时开机也不回写', (await rawSet())===null,
  JSON.stringify(await rawSet())?.slice(0,160));

// 六、stored() 说得出来路
const flags = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  return { layout: db.layout.stored(), settings: db.settings.stored() };
});
ok('stored() 认得出这一条是读出来的', flags.layout===true, JSON.stringify(flags));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
