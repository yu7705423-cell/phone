// 生图断在哪一步，要说得出来。一句笼统的失败底下至少藏着五件事
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

let mode = 'ok';
await page.route('**/relay.example.com/**', async route => {
  if (mode === 'dead') return route.abort('failed');           // 连不上
  if (mode === 'cors') {
    // 预检没过 / 没有放行头 —— 浏览器里就是一句 Failed to fetch。
    // no-cors 那一问仍然发得出去，所以「服务器是活的」判得出来
    if (route.request().method() === 'POST') return route.abort('failed');
    return route.fulfill({ status: 200, body: 'ok' });
  }
  if (mode === '401') {
    return route.fulfill({ status: 401, contentType:'application/json',
      body: JSON.stringify({ error: { message: 'Invalid API key' } }) });
  }
  if (mode === 'linkonly') {
    return route.fulfill({ status: 200, contentType:'application/json',
      body: JSON.stringify({ data: [{ url: 'https://cdn.nowhere.invalid/a.png' }] }) });
  }
  return route.fulfill({ status: 200, contentType:'application/json',
    body: JSON.stringify({ data: [{ b64_json: PNG }] }) });
});
await page.route('**/cdn.nowhere.invalid/**', r => r.abort('failed'));

await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
const pid = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newImagePreset({ name:'诊断' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1',
    apiKey:'sk-x', model:'gpt-image-1', size:'1024x1024' });
  return p.id;
});
const diag = async m => {
  mode = m;
  return page.evaluate(async () => {
    const img = await import('/src/system/ai/image.js');
    return img.testImage();
  });
};

let r = await diag('ok');
ok('通的时候说通了，并且报出取回多少字节',
  r.ok && r.step === '连通' && r.bytes > 0, JSON.stringify(r));
ok('说得出这一次走的是哪条路', /直连|外壳/.test(r.route || ''), r.route);

r = await diag('401');
ok('密钥不对：说「已经连上了，是对方拒绝」',
  !r.ok && r.step === '接口报错' && /密钥/.test(r.hint), JSON.stringify(r));
ok('把对面那句原话带出来', /Invalid API key/.test(r.detail || ''), r.detail);

r = await diag('cors');
ok('被跨域拦下时，明说是跨域，不是一句 Failed to fetch',
  !r.ok && r.step === '被跨域拦下' && /没有允许网页直接调用/.test(r.hint), JSON.stringify(r));
ok('并且告诉下一步怎么办', /中转地址|安装/.test(r.hint), r.hint);

r = await diag('dead');
ok('压根连不上时，和跨域分得开',
  !r.ok && r.step === '没连上' && /没有联系上这个地址/.test(r.hint), JSON.stringify(r));

r = await diag('linkonly');
ok('只给链接又取不回来：指到「返回格式改 base64」',
  !r.ok && r.step === '图片链接取不回来' && /base64/.test(r.hint), JSON.stringify(r));

// 没填那几样
const missing = await page.evaluate(async (id) => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  const out = {};
  svc.updateImagePreset(id, { apiKey: '' });
  out.noKey = await img.testImage();
  svc.updateImagePreset(id, { apiKey: 'sk-x', model: '' });
  out.noModel = await img.testImage();
  svc.updateImagePreset(id, { model: 'gpt-image-1' });
  return out;
}, pid);
ok('没填密钥就直说没填密钥', missing.noKey.step === '没填密钥', JSON.stringify(missing.noKey));
ok('没填模型就直说没填模型', missing.noModel.step === '没填模型', JSON.stringify(missing.noModel));

// 界面上要看得到这份报告
mode = 'cors';
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/image');
});
await page.waitForTimeout(900);
await page.locator('.list-item').filter({hasText:'诊断'}).first().click();
await page.waitForTimeout(700);
await page.locator('button:has-text("自检并试生成")').first().click();
await page.waitForTimeout(3000);
const shown = await page.locator('.sheet').innerText();
ok('自检结果显示在界面上', /断在：被跨域拦下/.test(shown), shown.slice(0, 400));
ok('界面上也写清楚下一步', /中转地址/.test(shown), shown.slice(0, 500));

await browser.close();
const bad=R.filter(r2=>!r2.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
