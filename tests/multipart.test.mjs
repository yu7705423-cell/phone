// 自己拼的 multipart 和浏览器拼的，对面拆出来是不是一样的东西
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932}});
await ctx.addInitScript(() => {
  window.phoneNet = true; window.__sent = [];
  window.webkit = { messageHandlers: { net: { postMessage: async m => {
    window.__sent.push(m);
    return { status:200, headers:{'content-type':'application/json'}, body: btoa('{}') };
  } } } };
});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
let browserSent = null;
await page.route('**/upload', async r => {
  browserSent = { ct: r.request().headers()['content-type'] || '',
    body: r.request().postDataBuffer()?.toString('latin1') || '' };
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1200);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 同一个 FormData：一份交给浏览器发，一份交给「外壳」发
const mine = await page.evaluate(async () => {
  const net = await import('/src/system/net.js');
  const mk = () => { const f=new FormData();
    f.append('model','gpt-image-1');
    f.append('prompt','一只猫 in the rain');
    f.append('n','1');
    f.append('image', new File([new Uint8Array([137,80,78,71,13,10,26,10,0,1,2,3])],'face.png',{type:'image/png'}));
    return f; };
  await fetch('/upload', { method:'POST', body: mk() });          // 浏览器那份
  await net.nfetch('https://x.example.com/upload', { method:'POST', body: mk() });  // 外壳那份
  const m = window.__sent[0];
  const bin = atob(m.body);
  return { ct: m.headers['content-type'] || '', body: bin };
});

const bOf = ct => (/boundary=(.+)$/.exec(ct)||[])[1] || '';
// 拆成「字段名 -> 值」，分界串本身不参与比较（本来就该每次不同）
const parse = (ct, body) => {
  const b = bOf(ct); if (!b) return null;
  const out = {};
  body.split(`--${b}`).forEach(chunk => {
    const m = /Content-Disposition: form-data; name="([^"]+)"([^\r\n]*)\r\n([\s\S]*?)\r\n\r\n([\s\S]*)\r\n$/.exec(chunk)
      || /Content-Disposition: form-data; name="([^"]+)"([^\r\n]*)\r\n\r\n([\s\S]*)\r\n$/.exec(chunk);
    if (!m) return;
    out[m[1]] = m.length===5 ? { extra:m[2], head:m[3], value:m[4] } : { extra:m[2], value:m[3] };
  });
  return out;
};
const A = parse(browserSent.ct, browserSent.body);
const B = parse(mine.ct, mine.body);
ok('浏览器那份拆得开', !!A && Object.keys(A).length===4, JSON.stringify(Object.keys(A||{})));
ok('自己拼的那份拆得开', !!B && Object.keys(B).length===4, JSON.stringify(Object.keys(B||{})));
ok('字段名一模一样', JSON.stringify(Object.keys(A).sort())===JSON.stringify(Object.keys(B).sort()),
  `${Object.keys(A)} vs ${Object.keys(B)}`);
['model','prompt','n'].forEach(k =>
  ok(`${k} 的值一致`, A[k]?.value===B[k]?.value, `${JSON.stringify(A[k])} vs ${JSON.stringify(B[k])}`));
ok('中文提示词按 UTF-8 编码，没被转义', /一只猫/.test(new TextDecoder().decode(
  Uint8Array.from(B.prompt.value, c=>c.charCodeAt(0)))), B.prompt?.value);
ok('文件那一段带 filename', /filename="face\.png"/.test(A.image.extra) && /filename="face\.png"/.test(B.image.extra),
  `${A.image?.extra} vs ${B.image?.extra}`);
ok('文件那一段带 Content-Type', /image\/png/.test(A.image.head||'') && /image\/png/.test(B.image.head||''),
  `${A.image?.head} vs ${B.image?.head}`);
ok('文件内容一个字节不差', A.image.value===B.image.value,
  `${JSON.stringify(A.image?.value)} vs ${JSON.stringify(B.image?.value)}`);
ok('分界串声明在 content-type 里', !!bOf(mine.ct), mine.ct);
ok('正文里的分界串和头里那个是同一个', mine.body.startsWith(`--${bOf(mine.ct)}\r\n`), mine.body.slice(0,80));
ok('末尾是收尾的那一行', mine.body.endsWith(`--${bOf(mine.ct)}--\r\n`), JSON.stringify(mine.body.slice(-40)));

// 认不出的请求体要响亮地失败，不许静静发一个空的
const weird = await page.evaluate(async () => {
  const net = await import('/src/system/net.js');
  try { await net.nfetch('https://x.example.com/u', { method:'POST', body: new URLSearchParams({a:'1'}) });
    return { ok:true }; } catch(e){ return { ok:false, err:String(e.message||e) }; }
});
ok('认不出的请求体：抛错，不静静发空的', !weird.ok && /过不了外壳那座桥/.test(weird.err), JSON.stringify(weird));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
