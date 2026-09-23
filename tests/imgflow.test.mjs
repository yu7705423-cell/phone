// 会话里那条路，装成 ipa 的样子：锁脸、参考图、退回、取消，各走一遍
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const PNG='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';
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 外壳：edits 怎么回由页面上的 window.__editMode 决定
await ctx.addInitScript(PNG => {
  window.phoneNet = true; window.phoneNotify = true;
  window.__sent = []; window.__editMode = 'ok';
  window.webkit = { messageHandlers: {
    net: { postMessage: async m => {
      const bin = m.body ? atob(m.body) : '';
      window.__sent.push({ url:m.url, bytes:bin.length, text:bin.slice(0,800),
        ct:m.headers['content-type']||'' });
      const J = o => ({ status:200, headers:{'content-type':'application/json'}, body: btoa(JSON.stringify(o)) });
      if (/images\/edits/.test(m.url)) {
        if (window.__editMode === 'reject') return { status:404,
          headers:{'content-type':'application/json'}, body: btoa(JSON.stringify({error:{message:'no such endpoint'}})) };
        if (window.__editMode === 'hang') return new Promise(() => {});
        return J({ data:[{ b64_json: PNG }] });
      }
      return J({ data:[{ b64_json: PNG }] });
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
// atob 给的是 latin1 的字节串，中文要按 UTF-8 再解一遍
const utf8 = s => new TextDecoder().decode(Uint8Array.from(String(s||''), c=>c.charCodeAt(0)));

const setup = await page.evaluate(async PNG => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const bin=atob(PNG); const u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  const faceId = await db.images.put(new File([new Blob([u],{type:'image/png'})],'face.png',{type:'image/png'}));
  const p=svc.newImagePreset({ kind:'relay', name:'中转' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'sk-t',
    model:'gpt-image-1', ref:'edits' });
  svc.setActiveImage(p.id);
  const c=db.characters.create({ name:'阿岚', faceImage:faceId, faceLock:'always',
    imagePrompt:'silver hair' });
  const chat=db.chats.create({ characterIds:[c.id], title:'阿岚' });
  db.settings.set({ imagePrompt:'soft film grain' });
  return { charId:c.id, chatId:chat.id };
}, PNG);

const shoot = async (mode) => {
  await page.evaluate(m => { window.__editMode = m; window.__sent.length = 0; }, mode);
  return page.evaluate(async ({charId, chatId}) => {
    const db=await import('/src/system/db/index.js');
    const reply=await import('/src/system/ai/reply.js');
    const m=db.messages.create({ chatId, authorId:charId, role:'char', kind:'image',
      prompt:'阿岚站在窗边', media:'pending' });
    reply.regenMedia(m.id);
    for (let i=0;i<40 && db.messages.get(m.id).media==='pending'; i++) await new Promise(r=>setTimeout(r,100));
    const row=db.messages.get(m.id);
    return { id:m.id, media:row.media, err:row.mediaError, hasImage:!!row.imageId };
  }, setup);
};

// 一、参考图那条通
let g = await shoot('ok');
let sent = await page.evaluate(()=>window.__sent);
ok('锁脸走的是 images/edits', /images\/edits/.test(sent[0]?.url||''), JSON.stringify(sent.map(x=>x.url)));
ok('这一次外壳收到了请求体', sent[0]?.bytes>0, `${sent[0]?.bytes} 字节`);
ok('请求里带得上提示词（UTF-8）', /阿岚站在窗边/.test(utf8(sent[0]?.text)), utf8(sent[0]?.text).slice(0,200));
ok('请求里带得上那张脸', /filename="face\.png"/.test(sent[0]?.text||''), sent[0]?.text?.slice(0,300));
ok('画风提示词也拼进去了', /silver hair/.test(sent[0]?.text||'') && /soft film grain/.test(sent[0]?.text||''));
ok('只打了一次接口', sent.length===1, JSON.stringify(sent.map(x=>x.url)));
ok('图存下来了', g.media==='done' && g.hasImage, JSON.stringify(g));

// 二、接口不认 edits，退回纯文字
g = await shoot('reject');
sent = await page.evaluate(()=>window.__sent);
ok('接口不认 edits 时退回 generations',
  sent.length===2 && /images\/edits/.test(sent[0].url) && /images\/generations/.test(sent[1].url),
  JSON.stringify(sent.map(x=>x.url)));
ok('退回那次也画成了', g.media==='done' && g.hasImage, JSON.stringify(g));

// 三、取消：不许再画一张，也不许在气泡上留红字
await page.evaluate(m => { window.__editMode = m; window.__sent.length = 0; }, 'hang');
const cancelled = await page.evaluate(async ({charId, chatId}) => {
  const db=await import('/src/system/db/index.js');
  const reply=await import('/src/system/ai/reply.js');
  const q=await import('/src/system/ai/queue.js');
  const m=db.messages.create({ chatId, authorId:charId, role:'char', kind:'image',
    prompt:'阿岚站在窗边', media:'pending' });
  reply.regenMedia(m.id);
  await new Promise(r=>setTimeout(r,600));
  q.cancel(`msg-img:${m.id}`);
  await new Promise(r=>setTimeout(r,1200));
  const row=db.messages.get(m.id);
  return { media:row.media, err:row.mediaError };
}, setup);
sent = await page.evaluate(()=>window.__sent);
ok('取消之后不再画第二张', sent.length===1, JSON.stringify(sent.map(x=>x.url)));
ok('取消不算错误，气泡上不留红字',
  cancelled.media!=='error' && !cancelled.err, JSON.stringify(cancelled));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
