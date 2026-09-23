// 「自检能收到，发消息却不行」的两个成因：自检的不是生效那一套；参考图那条先白等
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 好的那一套通，坏的那一套挂着不回
await page.route('**/good.example.com/**', r => r.fulfill({ status:200,
  contentType:'application/json', body: JSON.stringify({ data:[{ b64_json: PNG }] }) }));
await page.route('**/bad.example.com/**', async r => {
  await new Promise(x => setTimeout(x, 20000)); return r.abort('failed');
});
// edits 端点：挂着不回，正是多数中转站的样子
await page.route('**/edits.example.com/v1/images/edits', async r => {
  await new Promise(x => setTimeout(x, 20000)); return r.abort('failed');
});
await page.route('**/edits.example.com/v1/images/generations', r => r.fulfill({ status:200,
  contentType:'application/json', body: JSON.stringify({ data:[{ b64_json: PNG }] }) }));

await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);

// ---- 一、自检的那一套不是生效的那一套 ----
const two = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  const bad = svc.newImagePreset({ name:'旧的那套' });
  svc.updateImagePreset(bad.id, { baseUrl:'https://bad.example.com/v1',
    apiKey:'sk-x', model:'m', timeout: 2 });
  const good = svc.newImagePreset({ name:'新的那套' });
  svc.updateImagePreset(good.id, { baseUrl:'https://good.example.com/v1',
    apiKey:'sk-x', model:'m', timeout: 20 });
  svc.setActiveImage(bad.id);                 // 生效的是坏的那一套
  const rep = await img.testImage(svc.imagePresets().find(p => p.id === good.id));
  return { rep, goodId: good.id, badId: bad.id, active: svc.activeImage().name };
});
ok('自检那一套本身是通的', two.rep.ok, JSON.stringify(two.rep).slice(0,200));
ok('但自检说明白了：发消息用的不是这一套',
  two.rep.isActive === false && /不是这一套/.test(two.rep.hint), two.rep.hint);
ok('并且点名是哪一套', /旧的那套/.test(two.rep.hint), two.rep.hint);

const liveFail = await page.evaluate(async () => {
  const img = await import('/src/system/ai/image.js');
  // 不传 preset，就是发消息走的那一条
  return img.testImage();
});
ok('对着生效那一套自检，才暴露出问题',
  !liveFail.ok && /超时|没连上/.test(liveFail.step), JSON.stringify(liveFail));

// 界面上也要提示
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/image');
});
await page.waitForTimeout(900);
await page.locator('.list-item').filter({hasText:'新的那套'}).first().click();
await page.waitForTimeout(700);
let sheet = await page.locator('.sheet').innerText();
ok('编辑一套非生效的接口时，页面上直接提示',
  /不是当前生效的接口/.test(sheet), sheet.slice(0,300));
ok('并给一个「设为生效」的按钮', /把这一套设为生效/.test(sheet), sheet.slice(0,400));
await page.locator('button:has-text("把这一套设为生效")').first().click();
await page.waitForTimeout(600);
sheet = await page.locator('.sheet').innerText();
ok('点完提示就消失了', !/不是当前生效的接口/.test(sheet), sheet.slice(0,200));

// ---- 二、参考图那条不该花掉整份预算 ----
const ref = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  const p = svc.newImagePreset({ name:'带参考图' });
  svc.updateImagePreset(p.id, { baseUrl:'https://edits.example.com/v1',
    apiKey:'sk-x', model:'m', ref:'edits', timeout: 300 });
  svc.setActiveImage(p.id);
  return { full: img.timeoutOf(svc.activeImage()), ref: img.refTimeoutOf(svc.activeImage()),
    zero: img.refTimeoutOf({ timeout: 0 }) };
});
ok('参考图那条的期限远短于整份预算',
  ref.ref < ref.full && ref.ref === 45000, JSON.stringify(ref));
ok('整份填 0（一直等）时，参考图那条仍然有期限',
  ref.zero === 45000, String(ref.zero));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad2=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad2}/${R.length} 通过`);
process.exit(bad2?1:0);
