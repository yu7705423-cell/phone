import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE,
  args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2,permissions:['camera']});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
let turns=0; const bodies=[];
await page.route('**/chat/completions', async r => {
  const body=JSON.parse(r.request().postData()||'{}');
  bodies.push(body); turns++;
  const last=body.messages[body.messages.length-1]?.content||'';
  // 接通后先开口那一句的模板已经改成英文（第 14 条）
  const say = /call has just connected/.test(last) ? '喂？是我。'
    : `听见了，你说「${String(last).slice(0,10)}」。那就这样。`;
  if (body.stream) {
    const chunks = say.split('').map(ch=>`data: ${JSON.stringify({choices:[{delta:{content:ch}}]})}\n\n`);
    await r.fulfill({status:200,headers:{'content-type':'text/event-stream'},
      body: chunks.join('')+'data: [DONE]\n\n'});
  } else {
    await r.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({choices:[{message:{content:say}}]})});
  }
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
// 接通是随机等 2.5~6 秒之后的事，再加上接通那一轮的开销，定死一个等待时长
// 在机器忙的时候本来就不够。等到状态真的变了为止。
const phaseNow = () => page.evaluate(async()=>(await import('/src/system/call.js')).call.get().phase);
const waitPhase = async (want, ms=25000) => {
  const until = Date.now()+ms;
  for(;;){ const p = await phaseNow(); if (p===want || Date.now()>until) return p;
    await page.waitForTimeout(200); }
};

const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const svc=await import('/src/system/ai/services.js');
  const nav=await import('/src/system/nav.js');
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  db.personas.update(me.id,{name:'小明'});
  const png='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABlklEQVR4nBXR4RiFMQiG4Q9hCEMIYQghhDCEEIbwIIQQQgghDOHs9Lu7662+72N8zA/5WB/6YR/7wz/OBx/xkR/10R/34/sGYzAHMlgDHdhgD3xwBgxikIMa9OCOByZjMicyWROd2GRPfHImTGKSk5r05M4HhCFMQYQlqGDCFlw4AkIIKZTQwpUHFmMxF7JYC13YYi98cRYsYpGLWvTirgeUoUxFlKWoYspWXDkKSiiplNLK1QeMYUxDjGWoYcY23DgGRhhplNHGtQc2YzM3slkb3dhmb3xzNmxik5va9ObuB5zhTEec5ahjznbcOQ5OOOmU0871Bw7jMA9yWAc92GEf/HAOHOKQhzr04Z4H/s95534HfCd5S77YL8gb/Zr/FZBQ0HDf679gBDOQYAUaWLADD0782yPIoIIObjyQjGQmkqxEE0t24snJ//BIMqmkk5sPFKOYhRSr0MKKXXhx6h8liiyq6OLWA81oZiPNarSxZjfenP4Hjyabarq5/cBlXOZFLuuiF7vsi1/O/a8Zl7zUpS/38gNq4ZAQG74ASAAAAABJRU5ErkJggg==';
  const blob=await (await fetch('data:image/png;base64,'+png)).blob();
  const face=await db.images.put(new File([blob],'a.png',{type:'image/png'}));
  const c=db.characters.create({name:'阿岚',avatar:face,proactiveQuietFrom:0,proactiveQuietTo:0});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m'});
  nav.goHome(); nav.openApp('chat',`/chat/${chat.id}`);
  return { chat:chat.id, char:c.id };
});
await page.waitForTimeout(700);

// ---- 纯逻辑 ----
const unit = await page.evaluate(async ids => {
  const call=await import('/src/system/call.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  ok('时长格式', call.duration(0)==='00:00'&&call.duration(72)==='01:12', call.duration(72));
  ok('接通写时长', call.label('out','done',72)==='语音通话 01:12', call.label('out','done',72));
  ok('拨出去没人接', call.label('out','missed',0)==='语音通话未接听');
  ok('打进来没接', call.label('in','missed',0)==='未接语音通话');
  ok('拒接', call.label('out','declined',0)==='语音通话已被拒接', call.label('out','declined',0));
  ok('自己取消', call.label('out','cancelled',0)==='语音通话已取消');
  ok('视频的说法不一样', call.label('in','missed',0,true)==='未接视频通话', call.label('in','missed',0,true));
  ok('一开始是空闲', call.call.get().phase==='idle');
  return R;
}, ids);
unit.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 打一通 ----
await page.locator('.composer-side').first().click();
await page.waitForTimeout(400);
await page.getByText('通话',{exact:true}).click();
await page.waitForTimeout(400);
ok('拨号界面起来了', await page.locator('.call-layer').count()===1);
ok('通话层压在最上面', await page.evaluate(()=>{
  const el=document.querySelector('.call-layer');
  const z=+getComputedStyle(el).zIndex;
  const dock=document.querySelector('.dock');
  return !!el && z >= (dock?+getComputedStyle(dock).zIndex:0);
}));
const dialing = await page.locator('.call-status').innerText();
ok('写着正在呼叫', dialing==='正在呼叫', dialing);
await page.screenshot({path:`${OUT}/c1-dial.png`});

// 直接接通，不等随机
await page.evaluate(async ()=>{ const c=await import('/src/system/call.js'); c.call.set({phase:'dialing'}); });
const phase = await waitPhase('active');
ok('接通了', phase==='active', phase);

await page.waitForTimeout(1500);
const opened = await page.evaluate(async()=>{const c=await import('/src/system/call.js');return c.call.get().lines;});
ok('角色先开了口', opened.length===1&&opened[0].role==='char'&&opened[0].text==='喂？是我。', JSON.stringify(opened));
await page.screenshot({path:`${OUT}/c2-active.png`});

// 我打字说一句
await page.locator('.call-input input').fill('你在哪儿');
await page.keyboard.press('Enter');
await page.waitForTimeout(1800);
const after = await page.evaluate(async()=>{const c=await import('/src/system/call.js');return c.call.get().lines;});
ok('我说的那句记下了', after.some(l=>l.role==='user'&&l.text==='你在哪儿'), JSON.stringify(after));
ok('它回了一句', after.filter(l=>l.role==='char').length===2, JSON.stringify(after.map(l=>l.role)));
ok('字幕都画出来了', await page.locator('.call-line').count()>=3,
  String(await page.locator('.call-line').count()));
await page.screenshot({path:`${OUT}/c3-lines.png`});

// 挂断
await page.locator('.call-key.is-hang').click();
await page.waitForTimeout(700);
ok('回到会话页', await page.locator('.conv-body').count()===1);
const rec = await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  const l=db.messagesOf(id); const m=l[l.length-1];
  return { kind:m.kind, outcome:m.outcome, dir:m.direction, n:(m.callLog||[]).length, content:m.content };
}, ids.chat);
ok('留下一条通话记录', rec.kind==='call'&&rec.outcome==='done'&&rec.dir==='out', JSON.stringify(rec));
ok('全文进了正文', rec.content.includes('小明：你在哪儿')&&rec.content.includes('阿岚：喂？是我。'), rec.content);
ok('整通电话只落一条', rec.n===3, String(rec.n));
ok('气泡画出来了', await page.locator('.bubble-call').count()===1);
await page.screenshot({path:`${OUT}/c4-record.png`});

await page.locator('.bubble-call').click();
await page.waitForTimeout(500);
ok('点开能看全文', (await page.locator('.sheet').innerText()).includes('你在哪儿'));
await page.screenshot({path:`${OUT}/c5-log.png`});
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ---- 未接来电 ----
const missed = await page.evaluate(async ids => {
  const call=await import('/src/system/call.js');
  const db=await import('/src/system/db/index.js');
  const before=db.messagesOf(ids.chat).length;
  call.ring(ids.chat);
  const ringing=call.call.get().phase;
  call.call.set({phase:'ringing'});
  call.decline();
  const l=db.messagesOf(ids.chat); const m=l[l.length-1];
  return { ringing, added:l.length-before, kind:m.kind, outcome:m.outcome, dir:m.direction, content:m.content };
}, ids);
ok('来电时是响铃状态', missed.ringing==='ringing', missed.ringing);
ok('拒接留下记录', missed.kind==='call'&&missed.outcome==='declined'&&missed.dir==='in', JSON.stringify(missed));
ok('拒接的正文写清楚了', missed.content==='[语音通话已拒接]', missed.content);

// ---- [来电] 标记 ----
const ringMark = await page.evaluate(async ids => {
  const reply=await import('/src/system/ai/reply.js');
  const call=await import('/src/system/call.js');
  const db=await import('/src/system/db/index.js');
  const p=reply.splitReply('这事说不清\n[来电]');
  const chat=db.chats.get(ids.chat), char=db.characters.get(ids.char);
  const made=await reply.renderTurn({chat,char,raw:'这事说不清\n[来电]',turnId:'r1',instant:true});
  await new Promise(r=>setTimeout(r,200));
  const phase=call.call.get().phase;
  call.hangUp();
  return { parsed:p.map(x=>x.type), kinds:made.map(m=>m.kind), phase };
}, ids);
ok('[来电] 解析成一个事件', JSON.stringify(ringMark.parsed)==='["text","ring"]', JSON.stringify(ringMark.parsed));
ok('它不占气泡', JSON.stringify(ringMark.kinds)==='["text"]', JSON.stringify(ringMark.kinds));
ok('电话真的响了', ringMark.phase==='ringing', ringMark.phase);

const plain = await page.evaluate(async()=>{
  const reply=await import('/src/system/ai/reply.js');
  return reply.splitReply('我等下给你来电哦').map(x=>x.type);
});
ok('正常句子里的来电不算指令', JSON.stringify(plain)==='["text"]', JSON.stringify(plain));

// ---- 关掉通话就打不出去 ----
const off = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const call=await import('/src/system/call.js');
  db.characters.update(ids.char,{canCall:false});
  let msg=''; try { call.dial(ids.chat); } catch(e){ msg=e.message; }
  const rang=call.ring(ids.chat);
  db.characters.update(ids.char,{canCall:true});
  return { msg, rang, phase:call.call.get().phase };
}, ids);
ok('关掉之后打不出去', /未开启通话/.test(off.msg), off.msg);
ok('关掉之后也不会响', off.rang===null&&off.phase==='idle', JSON.stringify(off));

// ---- prompt 注入 ----
const sys = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const engine=await import('/src/system/ai/engine.js');
  const chat=db.chats.get(ids.chat), char=db.characters.get(ids.char);
  const on=await engine.buildCallSystem(chat,char);
  db.characters.update(ids.char,{canCall:false});
  const off=engine.buildChatSystem(chat,db.characters.get(ids.char),[],{}).system;
  db.characters.update(ids.char,{canCall:true});
  return { hasCall:on.includes('[正在通话中]'), hasRing:on.includes('[去电]'), offRing:off.includes('[去电]') };
}, ids);
ok('通话中的提示词拼进去了', sys.hasCall);
ok('打电话的说明也在', sys.hasRing);
ok('关掉就不注入打电话', !sys.offRing);


// ---- 任何页面都能弹 ----
const anywhere = await page.evaluate(async ids => {
  const nav=await import('/src/system/nav.js');
  const call=await import('/src/system/call.js');
  nav.goHome();                        // 人在主界面
  call.ring(ids.chat);
  await new Promise(r=>setTimeout(r,300));
  const onHome = !!document.querySelector('.call-layer');
  nav.openApp('settings','/');         // 换到别的 app
  await new Promise(r=>setTimeout(r,300));
  const inOther = !!document.querySelector('.call-layer');
  nav.lock();                          // 锁屏
  await new Promise(r=>setTimeout(r,300));
  const onLock = !!document.querySelector('.call-layer');
  call.decline(); nav.unlock();
  return { onHome, inOther, onLock };
}, ids);
ok('主界面上也弹', anywhere.onHome, JSON.stringify(anywhere));
ok('在别的 app 里也弹', anywhere.inOther, JSON.stringify(anywhere));
ok('锁屏上也弹', anywhere.onLock, JSON.stringify(anywhere));

// ---- 视频通话 ----
const vid = await page.evaluate(async ids => {
  const call=await import('/src/system/call.js');
  const db=await import('/src/system/db/index.js');
  const reply=await import('/src/system/ai/reply.js');
  const p=reply.splitReply('[视频来电]');
  call.dial(ids.chat, { video:true });
  const s1={...call.call.get()};
  call.call.set({phase:'dialing'});
  for (let i=0;i<125 && call.call.get().phase!=='active';i++) await new Promise(r=>setTimeout(r,200));
  const s2={...call.call.get()};
  return { parsed:p.map(x=>({t:x.type,v:x.video})), video:s1.video, phase:s2.phase, vid2:s2.video };
}, ids);
ok('[视频来电] 带上了视频标记', JSON.stringify(vid.parsed)==='[{"t":"ring","v":true}]', JSON.stringify(vid.parsed));
ok('拨的是视频通话', vid.video===true);
ok('接通之后还是视频', vid.phase==='active'&&vid.vid2===true, JSON.stringify(vid));
await page.waitForTimeout(1200);
ok('屏幕铺满了画面', await page.locator('.call-back').count()===1);
ok('我这边有个小窗', await page.locator('.call-self').count()===1);
ok('默认是虚拟头像不是摄像头', await page.locator('.call-self video').count()===0);
await page.screenshot({path:`${OUT}/c6-video.png`});

// 切到真实摄像头
await page.locator('.call-key').nth(1).click();
await page.waitForTimeout(1200);
const cam = await page.evaluate(async()=>{
  const call=await import('/src/system/call.js');
  const s=call.call.get();
  return { real:s.selfReal, on:s.camera, sees:call.charCanSee(), err:s.error };
});
ok('摄像头开起来了', cam.real&&cam.on, JSON.stringify(cam));
ok('小窗换成了实时画面', await page.locator('.call-self video').count()===1);
ok('识图没开就看不见我', cam.sees===false, JSON.stringify(cam));
const note = await page.locator('.call-foot').innerText();
ok('界面上说明了角色看不到', note.includes('角色看不到画面'), note);
await page.screenshot({path:`${OUT}/c7-camera.png`});

// 开了识图的 chat 档才真的看得见
const seen = await page.evaluate(async()=>{
  const svc=await import('/src/system/ai/services.js');
  const call=await import('/src/system/call.js');
  svc.setVision({mode:'chat'});
  const yes=call.charCanSee();
  svc.setVision({mode:'api'});
  const api=call.charCanSee();
  svc.setVision({mode:'chat'});
  return { yes, api };
});
ok('交给聊天模型这一档才看得见', seen.yes===true, JSON.stringify(seen));
ok('单独的识图接口这一档不走画面', seen.api===false, JSON.stringify(seen));

// 说一句，看请求里有没有带上那一帧
const before = turns;
await page.locator('.call-input input').fill('你看我的位置');
await page.keyboard.press('Enter');
await page.waitForTimeout(2000);
ok('带着画面发出去了', bodies.slice(before).some(b=>JSON.stringify(b).includes('image_url')),
  String(bodies.length - before));

// 挂断之后摄像头要关掉
await page.locator('.call-key.is-hang').click();
await page.waitForTimeout(700);
const after2 = await page.evaluate(async()=>{
  const cam=await import('/src/system/camera.js');
  const db=await import('/src/system/db/index.js');
  return { running:cam.running() };
});
ok('挂断之后摄像头关了', after2.running===false);
const vrec = await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  const l=db.messagesOf(id); const m=l[l.length-1];
  return { kind:m.callKind, content:m.content.split('\n')[0], hasImage:/data:image/.test(m.content) };
}, ids.chat);
ok('记录写的是视频通话', vrec.kind==='video'&&/视频通话/.test(vrec.content), JSON.stringify(vrec));
ok('摄像头那一帧一个字都没落库', vrec.hasImage===false, String(vrec.hasImage));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过，模型被调了 ${turns} 次`);
process.exit(bad||errs.length?1:0);
