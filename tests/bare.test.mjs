import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const id = await page.evaluate(async () => {
  const lay=await import('/src/screens/home/layout.js');
  const db=await import('/src/system/db/index.js');
  const nav=await import('/src/system/nav.js');
  nav.unlock();
  lay.placeAtXY(0, 0, 0, { kind:'widget', ref:'love', w:2, h:2 });
  return db.layout.get().pages[0].cells.find(c=>c.ref==='love')?.id;
});
await page.waitForTimeout(500);
ok('放上了 love 组件', !!id, String(id));
await page.screenshot({path:`${OUT}/bare-0.png`});

// 长按进编辑，点组件打开编辑器
await page.evaluate(async cid => {
  const nav=await import('/src/system/nav.js'); nav.goHome();
}, id);
await page.waitForTimeout(300);
const loveCell = page.locator('.cell-widget').filter({ has: page.locator('.wg-love') }).first();
await loveCell.click();
await page.waitForTimeout(600);
ok('打开了小组件编辑器', await page.locator('.sheet').count()>=1);
const sheet = await page.locator('.sheet').innerText();
ok('里面有隐藏背景这一项', sheet.includes('隐藏背景'), sheet.slice(0,200));
await page.screenshot({path:`${OUT}/bare-1.png`});

await page.locator('.list-item', { hasText:'隐藏背景' }).locator('.switch, [role=switch], button').first().click();
await page.waitForTimeout(400);
const bare = await page.evaluate(async cid => {
  const db=await import('/src/system/db/index.js');
  const c=db.layout.get().pages.flatMap(p=>p.cells).find(x=>x.id===cid);
  const el=document.querySelector('.wg-love')?.closest('.cell-widget');
  return { cfg:!!c.config?.bare, cls:el?.className };
}, id);
ok('开关写进了 config.bare', bare.cfg, JSON.stringify(bare));
ok('格子上挂了 is-bare', /is-bare/.test(bare.cls||''), bare.cls);
const shadow = await page.evaluate(()=>{
  const el=document.querySelector('.wg-love').closest('.cell-widget');
  const s=getComputedStyle(el);
  return { bg:s.backgroundColor, sh:s.boxShadow };
});
ok('底色和投影都没了', /rgba\(0, 0, 0, 0\)|transparent/.test(shadow.bg) && shadow.sh==='none', JSON.stringify(shadow));
await page.locator('.sheet').getByText('完成').click();
await page.waitForTimeout(400);
await page.screenshot({path:`${OUT}/bare-2.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
