// 中转站回包的各种形状，逐种喂进去看认不认得出
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932}})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// 一张真图，给「只给链接」那几种用
let reply = { status:200, body:{} };
await page.route('**/*', async r => {
  const u=r.request().url();
  if (/\/img\/real\.png$/.test(u)) return r.fulfill({status:200,contentType:'image/png',
    body:Buffer.from(PNG,'base64')});
  if (/images\/(generations|edits)/.test(u)) return r.fulfill({status:reply.status,
    contentType:'application/json', body:JSON.stringify(reply.body)});
  if (/\/img\/gone\.png$/.test(u)) return r.fulfill({status:404,contentType:'text/html',body:'<h1>404</h1>'});
  if (/\/img\/login\.png$/.test(u)) return r.fulfill({status:200,contentType:'text/html',
    body:'<html><body>请先登录</body></html>'});
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const p=svc.newImagePreset({ kind:'relay', name:'中转' });
  svc.updateImagePreset(p.id, { baseUrl:`${BASE}/v1`,
    apiKey:'sk-test', model:'gpt-image-1' });
  svc.setActiveImage(p.id);
});
let n=0;
const run = async (status, body) => {
  reply = { status, body };
  return page.evaluate(async i => {
    const svc=await import('/src/system/ai/services.js');
    const img=await import('/src/system/ai/image.js');
    try { const b=await img.generate({ prompt:'猫', preset:svc.activeImage(), key:'s'+i });
      return { ok:true, size:b.size, type:b.type }; }
    catch(e){ return { ok:false, err:String(e.message||e) }; }
  }, ++n);
};

let g = await run(200, { data:[{ b64_json:PNG }] });
ok('标准 b64_json', g.ok && g.size>0, JSON.stringify(g));
g = await run(200, { data:[{ b64_json:`data:image/png;base64,${PNG}` }] });
ok('b64_json 里塞的是整个 data URL', g.ok && g.size>0, JSON.stringify(g));
g = await run(200, { data:[{ b64_json:PNG.replace(/(.{20})/g,'$1\n') }] });
ok('b64 按列折了行', g.ok && g.size>0, JSON.stringify(g));
g = await run(200, { data:[{ url:`${BASE}/img/real.png` }] });
ok('只给链接，取得回来', g.ok && g.size>0, JSON.stringify(g));
g = await run(200, { data:[{ url:`data:image/png;base64,${PNG}` }] });
ok('链接位上是 data URL', g.ok && g.size>0, JSON.stringify(g));
g = await run(200, { data:[{ url:`${BASE}/img/gone.png` }] });
ok('链接 404：说得出去哪儿改', !g.ok && /返回格式/.test(g.err), g.err);
g = await run(200, { data:[{ url:`${BASE}/img/login.png` }] });
ok('链接回的是登录页而不是图', !g.ok && /不是图片/.test(g.err), g.err);
g = await run(200, { images:[{ url:`${BASE}/img/real.png` }] });
ok('非标准的 images[]', g.ok && g.size>0, JSON.stringify(g));
g = await run(200, { data:[{ b64_json:'这不是 base64!!' }] });
ok('base64 是坏的：说人话', !g.ok && /base64/.test(g.err) && !/InvalidCharacter/.test(g.err), g.err);
g = await run(200, { error:{ message:'余额不足' } });
ok('200 却带 error：把对面那句话原样交出来', !g.ok && /余额不足/.test(g.err), g.err);
g = await run(200, { data:[] });
ok('认不出的形状：把回包原文带出来', !g.ok && /回包是/.test(g.err), g.err);
g = await run(400, { error:{ message:'model not found' } });
ok('400 带错误信息', !g.ok && /400/.test(g.err) && /model not found/.test(g.err), g.err);

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
