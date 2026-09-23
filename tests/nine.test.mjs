import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
let seen = null;
await page.route('**/chat/completions', async r => {
  seen = JSON.parse(r.request().postData()||'{}');
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'ok'}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const svc=await import('/src/system/ai/services.js');
  const reply=await import('/src/system/ai/reply.js');
  const engine=await import('/src/system/ai/engine.js');
  const paths=await import('/src/icons/paths.js');
  const ka=await import('/src/system/keepalive.js');
  const audio=await import('/src/system/audio.js');
  const asr=await import('/src/system/ai/asr.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m'});

  // 3 4 5 图标
  ok('新增了电话图标', !!paths.PATHS.phone);
  ok('新增了礼物图标', !!paths.PATHS.gift);
  ok('新增了翻译图标', !!paths.PATHS.translate);

  // 8 单换行也分条
  let p = reply.splitReply('第一句\n第二句\n第三句');
  ok('单换行也分条', p.length === 3 && p[2].text === '第三句', JSON.stringify(p.map(x=>x.text)));
  p = reply.splitReply('第一句\n\n第二句');
  ok('空行照旧分条', p.length === 2, JSON.stringify(p.map(x=>x.text)));

  // 9 译文挂在上一条
  p = reply.splitReply('こんにちは\n[译文：你好]\n暑いね\n[译文：好热啊]');
  ok('译文不单独占气泡', p.length === 2, JSON.stringify(p.map(x=>x.text)));
  ok('译文挂到上一条上', p[0].translation === '你好' && p[1].translation === '好热啊',
    JSON.stringify(p.map(x=>x.translation)));
  p = reply.splitReply('[译文：孤儿译文]');
  ok('前面没有正文的译文直接丢掉', p.length === 0, JSON.stringify(p));

  // 9 开关控制 prompt
  const sys = () => engine.buildChatSystem(db.chats.get(chat.id), db.characters.get(c.id), db.messagesOf(chat.id)).system;
  ok('没开翻译就不注入', !sys().includes('顺带给出译文'));
  db.chats.update(chat.id, { translateTo: '中文' });
  ok('开了就注入并带上语言',
    sys().includes('顺带给出译文') && sys().includes('[译文：that message in 中文]'),
    sys().slice(-200));
  db.chats.update(chat.id, { translateTo: '' });

  // 1 识图三档
  ok('识图默认关着', svc.visionMode() === 'off', svc.visionMode());
  ok('关着时图片不算能被看见', svc.visionActive() === false);
  svc.setVision({ mode: 'chat' });
  ok('交给聊天模型这一档不需要另配接口', svc.visionActive() === true && !svc.visionReady());
  svc.setVision({ mode: 'api' });
  ok('选了单独接口但没填全，还是看不见', svc.visionActive() === false);
  svc.setVision({ mode: 'api', apiKey:'k', model:'m' });
  ok('填全了才算', svc.visionActive() === true);

  // 1 图片进请求
  svc.setVision({ mode: 'chat' });
  const cv = document.createElement('canvas'); cv.width=cv.height=8; cv.getContext('2d').fillRect(0,0,8,8);
  const blob = await new Promise(r=>cv.toBlob(r,'image/png'));
  const imageId = await db.images.put(new File([blob],'a.png',{type:'image/png'}));
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'image',imageId,content:'[图片]',status:'done',media:'done',vision:'chat'});
  const msgs = db.messagesOf(chat.id);
  const pics = await engine.imagesFor(msgs);
  ok('chat 档会把图读出来', !!pics && pics.size === 1, pics && pics.size);
  const hist = engine.buildHistory(db.chats.get(chat.id), db.characters.get(c.id), msgs, { images: pics });
  ok('历史里那条带上了图', hist.some(h => h.image && h.image.dataUrl.startsWith('data:image')),
    JSON.stringify(hist.map(h=>({r:h.role,img:!!h.image}))));
  svc.setVision({ mode: 'off' });
  ok('关掉就不读图了', (await engine.imagesFor(msgs)) === null);

  // 7 保活
  ok('保活默认关着', db.settings.get().keepAlive === false);
  ok('保活一开始没在跑', ka.running() === false);

  // 2 浏览器识别
  ok('浏览器识别的能力有被检出', typeof audio.speechSupported() === 'boolean');
  ok('没配接口时能不能发语音看浏览器',
    asr.canSendVoice() === (asr.isAsrReady() || audio.speechSupported()));

  return R;
});
out.forEach(r => ok(r.name, r.pass, r.extra));

// 1 真的发出去的请求里有图
await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const engine=await import('/src/system/ai/engine.js');
  svc.setVision({ mode: 'chat' });
  const chat = db.chats.all()[0];
  const char = db.characters.get(chat.characterIds[0]);
  const msgs = db.messagesOf(chat.id);
  const { getProvider } = await import('/src/system/ai/providers/index.js');
  const hist = engine.buildHistory(chat, char, msgs, { images: await engine.imagesFor(msgs) });
  await getProvider('openai').complete(
    { apiKey:'k', baseUrl:'https://api.example.com/v1', model:'m', maxTokens: 50 },
    { system:'s', messages: hist, maxTokens: 50 });
});
await page.waitForTimeout(400);
const imgPart = seen?.messages?.find(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'));
ok('OpenAI 请求体里真的带上了 image_url', !!imgPart,
  JSON.stringify(seen?.messages?.map(m=>Array.isArray(m.content)?'[parts]':String(m.content).slice(0,20))));

// 6 通知：不在会话里才弹
const notif = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const nav=await import('/src/system/nav.js');
  const reply=await import('/src/system/ai/reply.js');
  const notify=await import('/src/system/notify.js');
  const chat = db.chats.all()[0];
  const char = db.characters.get(chat.characterIds[0]);
  // 通知改成了一条消息一条（notifyMessage），不再整轮补一条
  const made = { kind:'text', content:'在吗' };

  notify.notifications.set({ items: [] });
  nav.goHome();
  reply.notifyMessage(chat, char, made);
  const away = notify.notifications.get().items.length;

  notify.notifications.set({ items: [] });
  nav.openApp('chat', `/chat/${chat.id}`);
  await new Promise(r=>setTimeout(r,120));
  reply.notifyMessage(chat, char, made);
  const inside = notify.notifications.get().items.length;

  // 返回列表页走的是 pop。openApp 同一个 app 且 route 为 '/' 不会动已有的栈。
  notify.notifications.set({ items: [] });
  nav.pop();
  await new Promise(r=>setTimeout(r,120));
  reply.notifyMessage(chat, char, made);
  const otherPage = notify.notifications.get().items.length;
  return { away, inside, otherPage };
});
ok('不在会话里会弹通知', notif.away === 1, JSON.stringify(notif));
ok('正看着这个会话就不弹', notif.inside === 0, JSON.stringify(notif));
ok('在同一个 app 的别的页面也会弹', notif.otherPage === 1, JSON.stringify(notif));

await browser.close();
const bad = R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
