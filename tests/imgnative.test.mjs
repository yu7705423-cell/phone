// 装成 ipa 之后的生图：请求交给外壳发，外壳到底收到了什么
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// 外壳那一层：把每一次 net 转发原样记下来，照 NetBridge.swift 的做法回应
await ctx.addInitScript(PNG => {
  window.phoneNotify = true; window.phoneNet = true; window.phoneKeepAlive = true;
  window.__sent = [];
  const b64bytes = b64 => { const s=atob(b64); const u=new Uint8Array(s.length);
    for (let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u; };
  window.webkit = { messageHandlers: {
    net: { postMessage: async m => {
      // NetBridge 只认 body 里那串 base64；空串就是「没有请求体」
      const bytes = m.body ? b64bytes(m.body) : new Uint8Array(0);
      window.__sent.push({ url:m.url, method:m.method, headers:m.headers,
        bytes: bytes.length, text: new TextDecoder().decode(bytes).slice(0,600) });
      const payload = JSON.stringify({ data:[{ b64_json: PNG }] });
      return { status:200, headers:{'content-type':'application/json'},
        body: btoa(payload) };
    } },
    notify: { postMessage: async () => ({ permission:'granted' }) },
  } };
}, PNG);
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
await page.route('**/chat/completions', r => r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({choices:[{message:{content:'好'}}]})}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const img=await import('/src/system/ai/image.js');
  const net=await import('/src/system/net.js');
  const p=svc.newImagePreset({ kind:'relay', name:'中转' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1',
    apiKey:'sk-test', model:'gpt-image-1', size:'1024x1024', ref:'edits' });
  svc.setActiveImage(p.id);
  const at=()=>svc.imagePresets().find(x=>x.id===p.id);
  const R={ canNative: net.canNative(), route: net.routeOf('https://relay.example.com/v1/images/generations') };
  // 纯文字那条
  try { await img.generate({ prompt:'一只猫', preset:at(), key:'n1' }); R.ok1=true; }
  catch(e){ R.err1=String(e.message||e); }
  // 带参考图那条：走 multipart
  const ref=new Blob([new Uint8Array([1,2,3,4,5,6,7,8])],{type:'image/png'});
  try { await img.generateWithRef({ prompt:'一只猫', refBlob:ref, preset:at(), key:'n2' }); R.ok2=true; }
  catch(e){ R.err2=String(e.message||e); }
  // data: 链接不该送上桥 —— 外壳那层是 URLSession，它取不了
  R.dataRoute = net.routeOf('data:image/png;base64,AAAA');
  R.blobRoute = net.routeOf('blob:http://x/abc');
  R.httpRoute = net.routeOf('https://relay.example.com/a.png');
  return R;
});
const sent = await page.evaluate(() => window.__sent);
ok('data: 链接不过桥', out.dataRoute === 'direct', out.dataRoute);
ok('blob: 链接不过桥', out.blobRoute === 'direct', out.blobRoute);
ok('普通 https 照旧过桥', out.httpRoute === 'native', out.httpRoute);

ok('这台设备会把请求交给外壳', out.canNative === true && out.route === 'native', JSON.stringify(out));
ok('纯文字那条发出去了', out.ok1===true, out.err1);
ok('纯文字那条外壳收到了请求体', sent[0]?.bytes>0, JSON.stringify(sent[0]));
ok('纯文字那条带得上提示词', /一只猫/.test(sent[0]?.text||''), sent[0]?.text);

ok('带参考图那条发出去了', out.ok2===true, out.err2);
ok('带参考图那条外壳收到了请求体', sent[1]?.bytes>0,
  `外壳收到 ${sent[1]?.bytes} 字节 —— 空的，对面看到的就是 prompt:null`);
ok('带参考图那条带得上提示词', /一只猫/.test(sent[1]?.text||''), JSON.stringify(sent[1]));
ok('带参考图那条带得上那张图', /face\.png/.test(sent[1]?.text||''), JSON.stringify(sent[1]));
const ct = Object.entries(sent[1]?.headers||{}).find(([k])=>/^content-type$/i.test(k))?.[1] || '';
ok('带参考图那条说得出自己的分界串', /multipart\/form-data;\s*boundary=/.test(ct), `content-type: ${ct||'（没有）'}`);

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
