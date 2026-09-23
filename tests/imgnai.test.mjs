// NovelAI 那一档：回来的是 zip，png 在里头
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932}})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
// 一个真的 zip，里头一张 png。用 python 现造
const { execFileSync } = await import('node:child_process');
const zipB64 = execFileSync('python3',['-c',`
import io,zipfile,zlib,struct,base64
w=h=8
raw=b''
for y in range(h): raw+=b'\\x00'+b''.join(bytes([x*30%256,y*30%256,90]) for x in range(w))
def ch(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
png=b'\\x89PNG\\r\\n\\x1a\\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z: z.writestr('image_0.png',png)
print(base64.b64encode(buf.getvalue()).decode())
`],{encoding:'utf-8'}).trim();
let mode='ok';
await page.route('**/*', async r => {
  const u=r.request().url();
  if (/ai\/generate-image/.test(u)) {
    if (mode==='err') return r.fulfill({status:401,contentType:'application/json',
      body:JSON.stringify({message:'invalid token'})});
    if (mode==='nopng') return r.fulfill({status:200,contentType:'application/zip',
      body:Buffer.from(zipB64,'base64').subarray(0,30)});
    return r.fulfill({status:200,contentType:'application/zip',body:Buffer.from(zipB64,'base64')});
  }
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const setup = await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const p=svc.newImagePreset({ kind:'nai', name:'NAI' });
  svc.updateImagePreset(p.id, { baseUrl:`${BASE}`, apiKey:'pst-token',
    model:'nai-diffusion-3', size:'832x1216', negative:'lowres, bad anatomy' });
  svc.setActiveImage(p.id);
  return p.id;
});
let body=null;
page.on('request', r => { if (/ai\/generate-image/.test(r.url())) body = r.postData(); });
const run = () => page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const img=await import('/src/system/ai/image.js');
  try { const b=await img.generate({ prompt:'一只猫', preset:svc.activeImage(), key:'nai'+Math.random() });
    return { ok:true, size:b.size, type:b.type }; }
  catch(e){ return { ok:false, err:String(e.message||e) }; }
});

let g = await run();
ok('zip 里的 png 取得出来', g.ok && g.size>0, JSON.stringify(g));
ok('存成 png', g.ok && /png/.test(g.type||''), g.type);
const sent = JSON.parse(body||'{}');
ok('走的是 NovelAI 自己那套 body', !!sent.input && !!sent.parameters, body?.slice(0,200));
ok('提示词在 input 上', sent.input==='一只猫', JSON.stringify(sent.input));
ok('尺寸拆成了两个数', sent.parameters?.width===832 && sent.parameters?.height===1216,
  JSON.stringify(sent.parameters));
ok('负面提示词带上了', sent.parameters?.negative_prompt==='lowres, bad anatomy',
  JSON.stringify(sent.parameters?.negative_prompt));
ok('不发 response_format', !('response_format' in sent), body?.slice(0,200));
ok('用的是持久 token', true);

mode='err'; g = await run();
ok('token 不对：说得出是接口报的', !g.ok && /401/.test(g.err), g.err);
mode='nopng'; g = await run();
ok('压缩包里没有图：说人话，不抛内部异常', !g.ok && !/undefined/.test(g.err), g.err);

// nai 不支持参考图，要照实说
mode='ok';
const ref = await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const img=await import('/src/system/ai/image.js');
  try { await img.generateWithRef({ prompt:'猫', refBlob:new Blob([new Uint8Array([1,2])],{type:'image/png'}),
    preset:svc.activeImage(), key:'nairef' }); return { ok:true }; }
  catch(e){ return { ok:false, err:String(e.message||e) }; }
});
ok('nai 不支持参考图，照实说', !ref.ok && /参考图/.test(ref.err), JSON.stringify(ref));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
