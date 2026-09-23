// 语音台本：语音世界书、<停顿>/<情绪> 标记、各家写法、写台本不许改台词、通话里随台词标
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const MP3 = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7', 'base64');
const HEX = MP3.toString('hex');

const chatReqs = [], mmReqs = [], oaReqs = [];
let chatReply = '';
let callReply = '';
await ctx.route('**/relay.example.com/**', async route => {
  const req = route.request(); const u = req.url(); const body = req.postData() || '';
  if (u.includes('/t2a_v2')) {
    mmReqs.push(JSON.parse(body || '{}'));
    return route.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ base_resp:{ status_code:0 }, data:{ audio: HEX } }) });
  }
  if (u.includes('/audio/speech')) {
    oaReqs.push(JSON.parse(body || '{}'));
    return route.fulfill({ status:200, contentType:'audio/mpeg', body: MP3 });
  }
  if (u.includes('/chat/completions')) {
    const j = JSON.parse(body || '{}');
    chatReqs.push(j);
    if (j.stream) {
      const chunks = [...callReply].map(ch => `data: ${JSON.stringify({ choices:[{ delta:{ content: ch } }] })}\n\n`);
      return route.fulfill({ status:200, contentType:'text/event-stream', body: chunks.join('') + 'data: [DONE]\n\n' });
    }
    return route.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ choices:[{ message:{ content: chatReply } }] }) });
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

// ---- 一、标记怎么拆、怎么写成各家认的样子 ----
const parse = await page.evaluate(async () => {
  const v = await import('/src/system/ai/voicescript.js');
  const raw = '<情绪 平静>你回来了。<停顿 0.8><停顿 0.4><情绪 生气>今天怎么这么晚？<停顿>';
  const segs = v.plan('minimax', raw, '', 'speech-02-hd');
  const one = (kind, t, model) => v.plan(kind, t, '', model).map(s => v.textFor(kind, s, model));
  return {
    plain: v.plain(raw),
    plainSound: v.plain('唉<声音 叹气>算了'),
    half: v.plain('你好<情绪 生'),
    has: [v.hasTags(raw), v.hasTags('没有标记的一句'), v.hasTags('<声音 笑>')],
    n: segs.length,
    moods: segs.map(s => s.mood),
    mm: segs.map(s => v.textFor('minimax', s, 'speech-02-hd')),
    mmIn: one('minimax', '先说一句<停顿 1.2>再说一句', 'speech-02-hd'),
    oaIn: one('openai', '先说一句<停顿 1.2>再说一句', 'tts-1'),
    elIn: one('eleven', '先说一句<停顿 9>再说一句', 'eleven_multilingual_v2'),
    elPlan: v.plan('eleven', raw, '', 'eleven_multilingual_v2').length,
    elText: one('eleven', raw, 'eleven_multilingual_v2').join('|'),
    mmPlan: v.plan('minimax', raw, '', 'speech-02-hd').length,
    v3: one('eleven', '<情绪 生气>你<停顿 0.3>又<停顿 2>迟到了<声音 叹气>算了', 'eleven_v3'),
    mm28: one('minimax', '唉<声音 叹气>算了<声音 不存在的声音>吧', 'speech-2.8-hd'),
    mm02: one('minimax', '唉<声音 叹气>算了', 'speech-02-hd'),
    oaSound: one('openai', '唉<声音 叹气>算了', 'tts-1'),
    soundOnly: v.plan('minimax', '<声音 叹气>', '', 'speech-2.8-hd').length,
    emo: [v.mmEmotion('生气', 'speech-2.8-hd'), v.mmEmotion('中性', 'speech-2.8-hd'), v.mmEmotion('neutral', ''),
      v.mmEmotion('流畅', 'speech-2.8-hd'), v.mmEmotion('流畅', 'speech-2.6-hd'), v.mmEmotion('耳语', 'speech-2.6-turbo'),
      v.mmEmotion('平淡', 'speech-02-hd')],
    last: v.lastMood('a<情绪 开心>b<情绪 难过>c'),
    base: v.plan('minimax', '没有情绪标记', '温柔', '')[0]?.mood,
  };
});
ok('去掉标记之后是原话', parse.plain === '你回来了。今天怎么这么晚？', parse.plain);
ok('声音标记也去掉', parse.plainSound === '唉算了', parse.plainSound);
ok('流式里半个标记不露出来', parse.half === '你好', parse.half);
ok('认得出有没有标记', parse.has.join(',') === 'true,false,true', parse.has.join(','));
ok('按情绪切成两段', parse.n === 2 && parse.moods.join(',') === '平静,生气', JSON.stringify(parse.moods));
ok('段首段尾的停顿去掉（MiniMax 不收两边没字的间隔）', parse.mm.join('|') === '你回来了。|今天怎么这么晚？', parse.mm.join('|'));
ok('MiniMax 的停顿写成 <#x#>', parse.mmIn[0] === '先说一句<#1.2#>再说一句', parse.mmIn[0]);
ok('OpenAI 兼容没有停顿写法，用省略号', parse.oaIn[0] === '先说一句……再说一句', parse.oaIn[0]);
ok('ElevenLabs 写成 <break>，最长 3 秒', /^先说一句 <break time="3s" \/> 再说一句$/.test(parse.elIn[0]), parse.elIn[0]);
ok('ElevenLabs 没有情绪参数，整句一次请求、情绪丢掉', parse.elPlan === 1 && parse.mmPlan === 2
  && !/生气|angry|\[/.test(parse.elText), `${parse.elPlan} / ${parse.mmPlan} / ${parse.elText}`);
ok('ElevenLabs v3 不用 <break>，停顿、情绪、声音都写成方括号标签，整句一次',
  parse.v3.length === 1 && parse.v3[0] === '[angry] 你 [short pause] 又 [long pause] 迟到了 [sighs] 算了', JSON.stringify(parse.v3));
ok('MiniMax speech-2.8 的声音写成 (sighs)，不认的声音丢掉', parse.mm28[0] === '唉(sighs)算了吧', JSON.stringify(parse.mm28));
ok('MiniMax 老型号不认声音标签，丢掉', parse.mm02[0] === '唉算了', JSON.stringify(parse.mm02));
ok('OpenAI 兼容没有声音写法，丢掉', parse.oaSound[0] === '唉算了', JSON.stringify(parse.oaSound));
ok('只有一声叹气的台本也算能念', parse.soundOnly === 1);
ok('MiniMax 情绪词：认得的送、neutral 不在枚举里不送、fluent/whisper 只给 2.6',
  parse.emo.join(',') === 'angry,,,,fluent,whisper,calm', parse.emo.join(','));
ok('最后一个情绪词', parse.last === '难过', parse.last);
ok('没写情绪时沿用角色卡那一份', parse.base === '温柔', parse.base);

// ---- 二、世界书用途：对话 / 生图 / 语音 三选一，互不串 ----
const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const svc=(await import('/src/system/ai/services.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
  const mk = (name, extra, content, more = {}) => db.lorebooks.create({ name, global:true, ...extra,
    entries:[{ id:'e-'+name, enabled:true, constant:true, content, ...more }] });
  mk('对话书', {}, '对话设定：这里是东京。');
  mk('生图书', { forImage:true }, '生图设定：胶片颗粒。');
  mk('语音书', { forVoice:true }, '语音规则：句末轻轻叹气。');
  db.lorebooks.create({ name:'语音关键词书', global:true, forVoice:true,
    entries:[{ id:'e-k', enabled:true, constant:false, keys:['晚'], content:'说到晚归时放慢，前面停顿 0.8 秒。' }] });
  const ch = db.characters.create({ name:'緑実', persona:'说话很慢。', voiceId:'v1' });
  const chat = db.chats.create({ characterIds:[ch.id], personaId:'me', title:'緑実' });
  db.messages.create({ chatId: chat.id, role:'user', authorId:'me', kind:'text', content:'我回来了', status:'done' });
  return { ch: ch.id, chat: chat.id };
});
const lore = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const L=(await import('/src/system/ai/context/lorebook.js'));
  const ch = db.characters.get(o.ch);
  const names = xs => xs.map(e => e.bookName).sort().join(',');
  return {
    chat: names(L.activate(ch, '随便', 0).items),
    image: names(L.activateImage(ch, '随便')),
    voiceMiss: names(L.activateVoice(ch, '随便')),
    voiceHit: names(L.activateVoice(ch, '今天怎么这么晚')),
    whole: L.voiceBookText(ch),
    purposes: db.lorebooks.all().map(b => L.purposeOf(b)).sort().join(','),
    patch: JSON.stringify(L.purposePatch('voice')),
  };
}, ids);
ok('语音书不进对话', lore.chat === '对话书', lore.chat);
ok('语音书不进生图', lore.image === '生图书', lore.image);
ok('语音那份：常驻的常在，关键词没命中不进', lore.voiceMiss === '语音书', lore.voiceMiss);
ok('语音那份：关键词命中才进', lore.voiceHit === '语音书,语音关键词书', lore.voiceHit);
ok('通话用的整本：常驻的与带关键词的都在，关键词写在前面',
  /句末轻轻叹气/.test(lore.whole) && /\(晚\) 说到晚归/.test(lore.whole), lore.whole);
ok('用途认得出三种', lore.purposes === 'chat,image,voice,voice', lore.purposes);
ok('改用途时两个字段一起写', lore.patch === '{"forImage":false,"forVoice":true}', lore.patch);

// ---- 三、写台本：关着原样，开着插标记、带上语音世界书，改了台词就不用 ----
const off = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const pw=(await import('/src/system/ai/promptwrite.js'));
  return await pw.scriptFor('今天怎么这么晚？', { chatId:o.chat, char: db.characters.get(o.ch) });
}, ids);
ok('开关关着：原话原样，一次都不调', off === '今天怎么这么晚？' && chatReqs.length === 0, `${off} / ${chatReqs.length}`);

await page.evaluate(async () => {
  (await import('/src/system/db/index.js')).settings.set({ writeVoicePrompt: true });
});
chatReply = '<情绪 生气>今天怎么<停顿 0.8>这么晚？';
const on = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const pw=(await import('/src/system/ai/promptwrite.js'));
  return await pw.scriptFor('今天怎么这么晚？', { chatId:o.chat, char: db.characters.get(o.ch), key:'s1' });
}, ids);
ok('开着：拿回带标记的台本', on === '<情绪 生气>今天怎么<停顿 0.8>这么晚？', on);
const sent = JSON.stringify(chatReqs[0]?.messages || []);
ok('写台本时带上了语音世界书（常驻的与命中的）', /句末轻轻叹气/.test(sent) && /说到晚归/.test(sent), sent.slice(0, 300));
ok('对话书、生图书没混进来', !/这里是东京|胶片颗粒/.test(sent));
ok('那份指令是英文的（第 14 条）', /Do not change, add, remove or reorder any word/.test(sent));

chatReply = '<情绪 生气>你怎么又这么晚回来？';
const changed = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const pw=(await import('/src/system/ai/promptwrite.js'));
  return await pw.scriptFor('今天怎么这么晚？', { chatId:o.chat, char: db.characters.get(o.ch), key:'s2' });
}, ids);
ok('模型改了台词：不用它，照原话念', changed === '今天怎么这么晚？', changed);

chatReply = '<情绪 生气>今天怎么这么晚！';
const punct = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const pw=(await import('/src/system/ai/promptwrite.js'));
  return await pw.scriptFor('今天怎么这么晚？', { chatId:o.chat, char: db.characters.get(o.ch), key:'s3' });
}, ids);
ok('只动了一个标点不算改台词', punct === '<情绪 生气>今天怎么这么晚！', punct);

// ---- 四、语音消息：台本按情绪切段送 MiniMax，停顿写成 <#x#>，音频接成一条 ----
await page.evaluate(async () => {
  const svc=(await import('/src/system/ai/services.js'));
  svc.setVoice({ enabled:true, kind:'minimax', baseUrl:'https://relay.example.com', apiKey:'k', model:'speech-02-hd' });
});
chatReply = '<情绪 平静>你回来了。<停顿 0.6><情绪 生气>今天怎么这么晚？';
const msg = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const r=(await import('/src/system/ai/reply.js'));
  const m = r.materialize({ type:'voice', text:'你回来了。今天怎么这么晚？' },
    { chatId:o.chat, role:'char', authorId:o.ch, status:'done' }, db.characters.get(o.ch));
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 100));
    const x = db.messages.get(m.id);
    if (x.media === 'done' || x.media === 'error') break;
  }
  const x = db.messages.get(m.id);
  const f = x.audioId ? await db.files.blob(x.audioId) : null;
  return { media: x.media, err: x.mediaError || '', script: x.voiceScript || '', content: x.content, bytes: f?.size || 0 };
}, ids);
ok('语音消息合成成功', msg.media === 'done', `${msg.media} ${msg.err}`);
ok('台本另存，正文仍是原话（气泡与历史不露标记）',
  msg.script.includes('<情绪 生气>') && msg.content === '[语音：你回来了。今天怎么这么晚？]', JSON.stringify(msg));
ok('按情绪切成两次请求', mmReqs.length === 2, `${mmReqs.length} 次`);
ok('每段带上各自的情绪（MiniMax 的 emotion）',
  mmReqs.map(r => r.voice_setting?.emotion || '').join(',') === 'calm,angry',
  mmReqs.map(r => r.voice_setting?.emotion || '-').join(','));
ok('送去念的字里没有尖括号标记', mmReqs.every(r => !/[<>]/.test(r.text.replace(/<#[\d.]+#>/g, ''))),
  mmReqs.map(r => r.text).join(' | '));
ok('两段音频接成一条存下', msg.bytes === MP3.length * 2, `${msg.bytes} 字节`);

// 段内停顿 -> <#x#>
mmReqs.length = 0;
await page.evaluate(async () => {
  const v=(await import('/src/system/ai/voice.js'));
  const u = await v.speak({ text:'<情绪 难过>对不起<停顿 1.5>我不是故意的', voiceId:'v1', key:'mm-pause' });
  URL.revokeObjectURL(u);
});
ok('段内停顿写成 <#1.5#>', mmReqs.length === 1 && mmReqs[0].text === '对不起<#1.5#>我不是故意的'
  && mmReqs[0].voice_setting?.emotion === 'sad', JSON.stringify(mmReqs.map(r => [r.text, r.voice_setting?.emotion])));

// speech-2.8：声音写成 (sighs)
mmReqs.length = 0;
await page.evaluate(async () => {
  const svc=(await import('/src/system/ai/services.js'));
  svc.setVoice({ enabled:true, kind:'minimax', baseUrl:'https://relay.example.com', apiKey:'k', model:'speech-2.8-hd' });
  const v=(await import('/src/system/ai/voice.js'));
  URL.revokeObjectURL(await v.speak({ text:'<情绪 中性>唉<声音 叹气>算了', voiceId:'v1', key:'mm-28' }));
});
ok('speech-2.8 收到 (sighs)，填了不在枚举里的情绪就不送 emotion', mmReqs.length === 1 && mmReqs[0].text === '唉(sighs)算了'
  && !('emotion' in (mmReqs[0].voice_setting || {})), JSON.stringify(mmReqs.map(r => [r.text, r.voice_setting])));

// 没有标记：和从前一样一次请求
mmReqs.length = 0;
await page.evaluate(async () => {
  const v=(await import('/src/system/ai/voice.js'));
  URL.revokeObjectURL(await v.speak({ text:'普通的一句', voiceId:'v1', key:'mm-plain' }));
});
ok('没有标记时一次请求、原样送', mmReqs.length === 1 && mmReqs[0].text === '普通的一句', JSON.stringify(mmReqs.map(r => r.text)));

// ---- 五、通话：随台词标，不另调；字幕去掉标记；情绪跨句带着走 ----
await page.evaluate(async () => {
  const svc=(await import('/src/system/ai/services.js'));
  const db=(await import('/src/system/db/index.js'));
  svc.setVoice({ enabled:true, kind:'openai', baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'tts-1' });
  db.settings.set({ callSpeak: true, callSummary: false });
});
callReply = '<情绪 生气>你终于接了。<停顿 0.8>知道现在几点吗？';
chatReqs.length = 0;
await page.evaluate(async (chatId) => {
  const c=(await import('/src/system/call.js'));
  c.ring(chatId); c.accept();
}, ids.chat);
await page.waitForTimeout(4000);
const live = await page.evaluate(async () => {
  const c=(await import('/src/system/call.js'));
  return c.call.get().lines.map(l => ({ role:l.role, text:l.text, script:l.script||'' }));
});
const line = live.find(l => l.role === 'char') || {};
const streamReq = chatReqs.find(j => j.stream);
const sys = JSON.stringify(streamReq?.messages || []);
ok('开关开着：通话提示词里有台本那一段', /\[语音台本\]/.test(sys));
ok('通话提示词里带上了整本语音世界书', /句末轻轻叹气/.test(sys) && /\(晚\) 说到晚归/.test(sys));
ok('通话里写台本不另调接口', chatReqs.filter(j => !j.stream).length === 0, `${chatReqs.filter(j => !j.stream).length} 次非流式`);
ok('字幕里没有标记', line.text === '你终于接了。知道现在几点吗？', JSON.stringify(line));
ok('带标记的原文另存一份', line.script === callReply, JSON.stringify(line));
ok('按句送进语音接口，第二句也还是生气（情绪跨句带着走）',
  oaReqs.length >= 2 && oaReqs.every(r => /生气/.test(r.instructions || '')),
  JSON.stringify(oaReqs.map(r => [r.input, r.instructions])));
ok('送去念的字里没有尖括号', oaReqs.every(r => !/[<>]/.test(r.input)), JSON.stringify(oaReqs.map(r => r.input)));

// 下一轮：历史里还给模型的是带标记的那份
callReply = '算了。';
chatReqs.length = 0;
await page.evaluate(async () => { (await import('/src/system/call.js')).say('对不起'); });
await page.waitForTimeout(2500);
const hist = JSON.stringify(chatReqs.find(j => j.stream)?.messages || []);
ok('下一轮历史里角色那句带着标记（模型照着自己前几轮的样子写）', /<情绪 生气>你终于接了/.test(hist), hist.slice(-300));
await page.evaluate(async () => { (await import('/src/system/call.js')).hangUp(); });
await page.waitForTimeout(1200);
const rec = await page.evaluate(async (chatId) => {
  const db=(await import('/src/system/db/index.js'));
  const m = db.messages.all().find(x => x.chatId === chatId && x.kind === 'call');
  return { content: m?.content || '', log: (m?.callLog || []).map(l => l.text) };
}, ids.chat);
ok('通话记录里是去掉标记的原话', rec.log.includes('你终于接了。知道现在几点吗？') && !/[<>]/.test(rec.content),
  JSON.stringify(rec));

// 开关关着：通话提示词里没有那一段
await page.evaluate(async () => {
  (await import('/src/system/db/index.js')).settings.set({ writeVoicePrompt: false });
});
chatReqs.length = 0;
callReply = '喂。';
await page.evaluate(async (chatId) => {
  const c=(await import('/src/system/call.js'));
  c.ring(chatId); c.accept();
}, ids.chat);
await page.waitForTimeout(2500);
const sysOff = JSON.stringify(chatReqs.find(j => j.stream)?.messages || []);
ok('开关关着：通话提示词里没有台本那一段', sysOff.length > 10 && !/\[语音台本\]/.test(sysOff) && !/句末轻轻叹气/.test(sysOff));
await page.evaluate(async () => { (await import('/src/system/call.js')).hangUp(); });
await page.waitForTimeout(800);

// ---- 六、世界书 app：用途三选一 ----
const bookId = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  return db.lorebooks.all().find(b => b.name === '对话书').id;
});
await page.evaluate(async (id) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('lorebook', `/book/${id}`);
}, bookId);
await page.waitForTimeout(900);
const seg = page.locator('.segmented button, .seg button, [role=tab]', { hasText:'语音' }).first();
const hasSeg = await seg.count();
ok('书的页面上有「语音」用途', hasSeg > 0);
if (hasSeg) {
  await seg.click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(async (id) => {
    const db=(await import('/src/system/db/index.js'));
    const b = db.lorebooks.get(id);
    return { forImage: b.forImage, forVoice: b.forVoice };
  }, bookId);
  ok('点「语音」后这本书成了语音书', after.forVoice === true && after.forImage === false, JSON.stringify(after));
}
await page.screenshot({ path:`${OUT}/vscript.png` });

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
