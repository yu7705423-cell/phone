// 通话：说外语的角色 —— 念的是原文，字幕有译文，声音存下来，挂断后有总结
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});

// 一段能被 <audio> 当 mp3 收下的字节就够了：这里不真播，只看存没存
const MP3 = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7', 'base64');
const chatReqs = [], ttsReqs = [];
let callReply = 'もしもし、元気？今日は雨だね。';
await ctx.route('**/relay.example.com/**', async route => {
  const req = route.request(); const u = req.url(); const body = req.postData() || '';
  if (u.includes('/audio/speech')) {
    ttsReqs.push(JSON.parse(body || '{}').input || '');
    return route.fulfill({ status:200, contentType:'audio/mpeg', body: MP3 });
  }
  if (u.includes('/chat/completions')) {
    const j = JSON.parse(body || '{}');
    chatReqs.push(j);
    const sys = JSON.stringify(j.messages || []);
    if (j.stream) {
      const chunks = [...callReply].map(ch => `data: ${JSON.stringify({ choices:[{ delta:{ content: ch } }] })}\n\n`);
      return route.fulfill({ status:200, contentType:'text/event-stream', body: chunks.join('') + 'data: [DONE]\n\n' });
    }
    // 翻译：回一个 lines 数组
    if (/Translate|translat/i.test(sys) && /lines/.test(sys)) {
      return route.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify({ choices:[{ message:{ content: JSON.stringify({ lines:['喂，你还好吗？今天下雨了呢。'] }) } }] }) });
    }
    // 总结
    return route.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ choices:[{ message:{ content:'对方打来电话问候，提到今天下雨。' } }] }) });
  }
  return route.fulfill({ status:404, body:'' });
});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const svc=(await import('/src/system/ai/services.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
  svc.setVoice({ enabled:true, kind:'openai', baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'tts-1' });
  // 「随回复给出」那一档：没配单独的翻译接口
  db.settings.set({ translateMode:'inline', callSpeak: true });
  const ch = db.characters.create({ name:'緑実', persona:'日本語で話す。', voiceId:'alloy' });
  const chat = db.chats.create({ characterIds:[ch.id], personaId:'me', title:'緑実', translateTo:'中文' });
  return { ch: ch.id, chat: chat.id };
});
const mode = await page.evaluate(async () => (await import('/src/system/ai/services.js')).translateMode());

// 打进来、接起来 —— 比拨出去确定（拨出去有随机的不接）
await page.evaluate(async (chatId) => {
  const c=(await import('/src/system/call.js'));
  c.ring(chatId); c.accept();
}, ids.chat);
await page.waitForTimeout(4500);

const live = await page.evaluate(async () => {
  const c=(await import('/src/system/call.js'));
  return c.call.get().lines.map(l => ({ role:l.role, text:l.text, trans:l.trans||'', audio:(l.audio||[]).length }));
});
const first = live.find(l => l.role === 'char');
ok('角色说的是原文（日语）', /もしもし/.test(first?.text || ''), JSON.stringify(live));
ok('字幕里有译文', first?.trans === '喂，你还好吗？今天下雨了呢。', JSON.stringify(first));
ok('原文里没有混进 [译文] 那一行', !/译文/.test(first?.text || ''), first?.text);

// 送进语音接口的全是原文
ok('送进语音接口的是原文', ttsReqs.length > 0 && ttsReqs.every(t => /[ぁ-ん]/.test(t)), JSON.stringify(ttsReqs));
ok('一句中文译文都没被念出来', !ttsReqs.some(t => /你还好|下雨了/.test(t)), JSON.stringify(ttsReqs));

// 通话那份提示词里不再叫它夹译文
const streamReq = chatReqs.find(j => j.stream);
const sysText = JSON.stringify(streamReq?.messages || []);
ok('通话提示词里没有「顺带给出译文」那一段（和「不要方括号」不再打架）',
  !/顺带给出译文|\[译文：/.test(sysText), sysText.slice(0, 200));
ok('翻译另走了一道', chatReqs.some(j => !j.stream && /Translate|translat/i.test(JSON.stringify(j.messages))),
  `非流式请求 ${chatReqs.filter(j=>!j.stream).length} 个`);

// 声音存下来了
ok('合成出来的声音存进了这一句', first?.audio >= 1, JSON.stringify(first));

// 我说一句，再来一轮
callReply = 'うん、傘持ってる？';
await page.evaluate(async () => { (await import('/src/system/call.js')).say('我很好'); });
await page.waitForTimeout(3500);

// 挂断
await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  db.settings.set({ callSummary: true });
  (await import('/src/system/call.js')).hangUp();
});
await page.waitForTimeout(2500);

const rec = await page.evaluate(async (chatId) => {
  const db=(await import('/src/system/db/index.js'));
  const p=(await import('/src/system/purge.js'));
  const c=(await import('/src/system/call.js'));
  const m = db.messages.all().find(x => x.chatId === chatId && x.kind === 'call');
  const ids = p.callAudio(m);
  const users = p.fileUsers();
  const whole = await c.wholeAudio(m.id);
  return {
    id: m.id, n: m.callLog.length,
    chars: m.callLog.filter(l => l.role === 'char').map(l => ({ t:l.text, tr:l.trans||'', a:(l.audio||[]).length })),
    summary: m.callSummary || '',
    audioIds: ids.length, registered: ids.every(id => users.get(id)?.kind === 'call'),
    wholeBytes: whole?.size || 0,
    content: m.content.slice(0, 80),
  };
}, ids.chat);
ok('通话记录里每一句角色的话都有译文', rec.chars.length === 2 && rec.chars.every(c => c.tr), JSON.stringify(rec.chars));
ok('通话记录里每一句都挂着声音', rec.chars.every(c => c.a >= 1), JSON.stringify(rec.chars));
ok('开了自动总结，挂断后写上了', /下雨/.test(rec.summary), JSON.stringify(rec.summary));
ok('那几段声音登进了文件引用表（清理无引用不会删）', rec.audioIds >= 2 && rec.registered, JSON.stringify(rec));
ok('整通电话的声音能接成一个文件下载', rec.wholeBytes > 0 && rec.wholeBytes === rec.audioIds * MP3.length,
  `${rec.wholeBytes} 字节，${rec.audioIds} 段`);
ok('角色记得的仍然是原话（正文里是原文）', /もしもし/.test(rec.content), rec.content);

// ---- 界面：通话记录 ----
await page.evaluate(async (chatId) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/chat/${chatId}`);
}, ids.chat);
await page.waitForTimeout(1000);
await page.locator('.bubble-call').first().click();
await page.waitForTimeout(800);
const sheet = await page.locator('.sheet').last().innerText();
ok('记录里看得到原文与译文', /もしもし/.test(sheet) && /你还好吗/.test(sheet), sheet.slice(0,200));
ok('记录最上面是总结', /对方打来电话问候/.test(sheet), sheet.slice(0,120));
ok('有「下载整通语音」', /下载整通语音/.test(sheet));
ok('每一句有播放按钮', await page.locator('.sheet .log-play').count() >= 2,
  String(await page.locator('.sheet .log-play').count()));
await page.screenshot({path:`${OUT}/calltr.png`});

// 手动再生成一次总结
const before = rec.summary;
await page.locator('.sheet button', { hasText:'重新生成总结' }).click();
await page.waitForTimeout(1200);
ok('手动生成总结的按钮能用', await page.evaluate(async (id) => {
  const db=(await import('/src/system/db/index.js'));
  return !!db.messages.get(id).callSummary;
}, rec.id));

// ---- 删会话时声音跟着删 ----
const gone = await page.evaluate(async (chatId) => {
  const db=(await import('/src/system/db/index.js'));
  const p=(await import('/src/system/purge.js'));
  const m = db.messages.all().find(x => x.chatId === chatId && x.kind === 'call');
  const ids = p.callAudio(m);
  p.dropChat(chatId);
  return ids.every(id => !db.files.info(id));
}, ids.chat);
ok('删会话时通话的声音跟着删', gone === true);

console.log('  ..   翻译模式:', mode, '  语音接口收到:', JSON.stringify(ttsReqs));
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
