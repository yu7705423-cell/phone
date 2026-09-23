// 超时要和「连不上」分开：前者是模型慢，后者是地址不通，下一步完全不同
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

let hang = false;
await page.route('**/relay.example.com/**', async route => {
  if (hang) { await new Promise(r => setTimeout(r, 20000)); return route.abort('failed'); }
  return route.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ data:[{ b64_json: PNG }] }) });
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
const pid = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newImagePreset({ name:'慢接口' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1',
    apiKey:'sk-x', model:'gpt-image-1' });
  return p.id;
});

// ---- 默认值 ----
const dflt = await page.evaluate(async (id) => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  const p = svc.imagePresets().find(x => x.id === id);
  return { timeout: p.timeout, ms: img.timeoutOf(p),
    zero: img.timeoutOf({ timeout: 0 }), missing: img.timeoutOf({}) };
}, pid);
ok('新建的接口默认等 300 秒', dflt.timeout === 300 && dflt.ms === 300000, JSON.stringify(dflt));
ok('填 0 就是一直等（不设上限）', dflt.zero === 0, String(dflt.zero));
ok('老的接口没有这一项时退回 300 秒', dflt.missing === 300000, String(dflt.missing));

// ---- 真的会掐 ----
hang = true;
const timed = await page.evaluate(async (id) => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  svc.updateImagePreset(id, { timeout: 2 });
  const at = Date.now();
  try {
    await img.generate({ prompt: 'x', key: 'img:slow' });
    return { okk: true };
  } catch (e) { return { okk: false, err: String(e.message || e), ms: Date.now() - at }; }
}, pid);
ok('到点就掐，不会一直挂着', !timed.okk && timed.ms < 8000, JSON.stringify(timed));
ok('报的是超时，并说了等了多久',
  /还没有回应/.test(timed.err) && /2 秒/.test(timed.err), timed.err);
ok('并且告诉怎么办：调大或填 0',
  /等待上限/.test(timed.err) && /填 0/.test(timed.err), timed.err);

// ---- 自检要把超时单独列一档 ----
const rep = await page.evaluate(async () => {
  const img = await import('/src/system/ai/image.js');
  return img.testImage();
});
ok('自检把超时单独列成一档，不混进「没连上」',
  rep.step === '等超时了', JSON.stringify(rep));
ok('自检也给出下一步', /等待上限/.test(rep.hint || ''), rep.hint);

// ---- 调大之后就好了 ----
hang = false;
const fixed = await page.evaluate(async (id) => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  svc.updateImagePreset(id, { timeout: 300 });
  return img.testImage();
}, pid);
ok('接口恢复之后自检就通了', fixed.ok && fixed.step === '连通', JSON.stringify(fixed));

// ---- reachable 自己也要有期限，不然自检会挂住 ----
const probed = await page.evaluate(async () => {
  const net = await import('/src/system/net.js');
  const at = Date.now();
  const r = await net.reachable('https://10.255.255.1/nothing', 1200);
  return { r, ms: Date.now() - at };
});
ok('探活那一问自己也会到点返回，不拖住自检',
  probed.ms < 6000, JSON.stringify(probed));

// ---- 界面上那一栏 ----
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/image');
});
await page.waitForTimeout(900);
await page.locator('.list-item').filter({hasText:'慢接口'}).first().click();
await page.waitForTimeout(700);
const sheet = await page.locator('.sheet').innerText();
ok('设置里有「等待上限」这一栏', /等待上限/.test(sheet), sheet.slice(0,300));
ok('并写明填 0 是一直等', /填 0/.test(sheet), sheet.slice(0,400));
const range = await page.evaluate(() => {
  const r=[...document.querySelectorAll('.sheet input[type=range]')].find(x=>Number(x.max)===900);
  return r ? { min:Number(r.min), max:Number(r.max) } : null;
});
ok('那一栏能拖到 0，也能拖到很大', range && range.min === 0 && range.max === 900,
  JSON.stringify(range));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r2=>!r2.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
