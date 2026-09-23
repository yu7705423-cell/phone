import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

await page.evaluate(async () => {
  const lay=await import('/src/system/db/index.js');
  const nav=await import('/src/system/nav.js');
  const L=lay.layout.get();
  L.pages[0].cells = [
    { id:'love1', kind:'widget', ref:'love', x:0, y:0, w:4, h:4 },
    { id:'cus1', kind:'widget', ref:'custom', x:0, y:4, w:4, h:2 },
  ];
  lay.layout.set(L);
  nav.goHome();
});
await page.waitForTimeout(800);

// 点 Love 组件打开编辑
await page.locator('.cell-widget').first().click();
await page.waitForTimeout(600);
const loveSheet = await page.locator('.sheet').innerText();
ok('Love 编辑页打开了', await page.locator('.sheet').count() === 1);
ok('有图片、文字、语言、颜色、衬线', ['图片','文字','星期与月份','颜色','衬线'].every(w=>loveSheet.includes(w)),
  loveSheet.replace(/\n/g,' / ').slice(0,200));
ok('没有串进播放器的行设置', !loveSheet.includes('第 1 行'), loveSheet.replace(/\n/g,' / ').slice(0,160));
ok('有颜色选择器', await page.locator('.wg-edit-color input[type=color]').count() === 1);
await page.screenshot({path:`${OUT}/w5-love-edit.png`});

// 改颜色
await page.locator('.wg-edit-color input[type=color]').evaluate(el => {
  el.value = '#1d4ed8'; el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
let saved = await page.evaluate(async () => {
  const lay=await import('/src/system/db/index.js');
  return lay.layout.get().pages[0].cells.find(c=>c.id==='love1').config?.color;
});
ok('颜色存下来了', saved === '#1d4ed8', saved);
await page.getByText('恢复默认', { exact: true }).click();
await page.waitForTimeout(400);
saved = await page.evaluate(async () => {
  const lay=await import('/src/system/db/index.js');
  return lay.layout.get().pages[0].cells.find(c=>c.id==='love1').config?.color;
});
ok('恢复默认把颜色清空', saved === '', JSON.stringify(saved));
await page.getByText('完成', { exact: true }).click();
await page.waitForTimeout(500);

// 自定义组件编辑
await page.locator('.cell-widget').nth(1).click();
await page.waitForTimeout(600);
const cusSheet = await page.locator('.sheet').innerText();
ok('自定义组件编辑页打开了', cusSheet.includes('HTML 文件'), cusSheet.replace(/\n/g,' / ').slice(0,200));
ok('说明里写了隔离与密钥', cusSheet.includes('读不到本应用的数据') && cusSheet.includes('密钥'),
  cusSheet.replace(/\n/g,' / '));
ok('没有串进衬线开关', !cusSheet.includes('衬线'), cusSheet.replace(/\n/g,' / '));
await page.screenshot({path:`${OUT}/w6-custom-edit.png`});

// 非 html 会被挡住
await page.locator('input[type=file][accept*="html"]').setInputFiles({
  name:'x.txt', mimeType:'text/plain', buffer: Buffer.from('hi') });
await page.waitForTimeout(600);
ok('非 html 文件被挡下', (await page.locator('.toast').last().innerText()).includes('.html'),
  await page.locator('.toast').last().innerText().catch(()=>'(无)'));

// 超大文件
await page.locator('input[type=file][accept*="html"]').setInputFiles({
  name:'big.html', mimeType:'text/html', buffer: Buffer.alloc(600*1024, 97) });
await page.waitForTimeout(800);
ok('超过上限被挡下', (await page.locator('.toast').last().innerText()).includes('太大'),
  await page.locator('.toast').last().innerText().catch(()=>'(无)'));

// 正常的
await page.locator('input[type=file][accept*="html"]').setInputFiles({
  name:'ok.html', mimeType:'text/html', buffer: Buffer.from('<p>hi</p>') });
await page.waitForTimeout(900);
const cfg = await page.evaluate(async () => {
  const lay=await import('/src/system/db/index.js');
  return lay.layout.get().pages[0].cells.find(c=>c.id==='cus1').config;
});
ok('正常 html 存下来了', !!cfg.fileId && cfg.name === 'ok.html', JSON.stringify(cfg));
ok('文件名显示出来了', (await page.locator('.sheet').innerText()).includes('ok.html'));

await browser.close();
const bad = R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
