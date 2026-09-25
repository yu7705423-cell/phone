// 视频通话的几处（ARCHITECTURE 4.234）
//
//   一、通话提示词不再整份照搬聊天那份：没有「每轮分几条发」、没有各项能力的方括号标记；
//       视频通话写明是视频，画面是对方的摄像头
//   二、角色本来就说目标语言：不送去翻，字幕不出第二行（中译中）
//   三、通话界面、来电通知显示备注，不是本名；进提示词的仍是本名
//   四、开小号：最近这段对话、已经开过的号（名字、原因），删掉的也记得
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
const MP3 = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7', 'base64');
const reqs = [];
let callReply = '喂，在吗？今天下雨了。';
let altNo = 0;
await ctx.route('**/relay.example.com/**', async route => {
  const req = route.request(); const u = req.url(); const body = req.postData() || '';
  if (u.includes('/audio/speech')) return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: MP3 });
  if (u.includes('/chat/completions')) {
    const j = JSON.parse(body || '{}');
    reqs.push(j);
    const sys = JSON.stringify(j.messages || []);
    if (j.stream) {
      const chunks = [...callReply].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`);
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: chunks.join('') + 'data: [DONE]\n\n' });
    }
    if (/second account/.test(sys)) {
      altNo += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content:
        JSON.stringify({ name: `号${altNo}`, signature: '签名', persona: 'You are ...', reason: `第${altNo}次的原因` }) } }] }) });
    }
    if (/Translate|translat/i.test(sys) && /lines/.test(sys)) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines: ['喂，在吗？今天下雨了。'] }) } }] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: '通话记录。' } }] }) });
  }
  return route.fulfill({ status: 404, body: '' });
});
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  svc.setVoice({ enabled: true, kind: 'openai', baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'tts-1' });
  db.settings.set({ translateMode: 'inline', callSpeak: true, callSummary: false });
  const ch = db.characters.create({ name: '林岚', remark: '小岚', persona: '说中文。', voiceId: 'alloy' });
  const chat = db.chats.create({ characterIds: [ch.id], personaId: 'me', title: '', translateTo: '中文' });
  for (let i = 0; i < 6; i++) {
    db.messages.create({ chatId: chat.id, role: i % 2 ? 'char' : 'user', kind: 'text', content: `第${i}句：周末去看海`, status: 'done', createdAt: Date.now() - (10 - i) * 1000 });
  }
  return { ch: ch.id, chat: chat.id };
});

// ---- 一、三：打进来一通视频电话 ----
await page.evaluate(async chatId => {
  const n = await import('/src/system/nav.js'); n.unlock();
  const c = await import('/src/system/call.js');
  c.ring(chatId, { video: true });
}, ids.chat);
await page.waitForSelector('.call-name', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(300);
const ringing = await page.evaluate(async () => ({
  name: document.querySelector('.call-name')?.textContent || '',
  note: (await import('/src/system/notify.js')).notifications.get().items[0]?.title || '',
}));
ok('来电界面显示备注', ringing.name.includes('小岚') && !ringing.name.includes('林岚'), JSON.stringify(ringing));
ok('来电通知显示备注', ringing.note.includes('小岚'), JSON.stringify(ringing));
await page.evaluate(async () => (await import('/src/system/call.js')).accept());
await page.waitForTimeout(4000);

const stream = reqs.find(j => j.stream);
const sys = String(stream?.messages?.[0]?.content || '');
ok('通话提示词：没有「每轮分几条发」', !/3 to 5 separate messages|\[消息规则\]/.test(sys), sys.slice(-600));
ok('通话提示词：没有能力清单与方括号标记的写法', !/\[可用的功能\]|\[图片：/.test(sys), sys.slice(-600));
ok('通话提示词：写明是视频通话、画面来自对方摄像头', /a video call/.test(sys) && /camera/.test(sys));
ok('通话提示词：进的是本名', /林岚/.test(sys));
ok('开口那一句是英文', /you called them|they called you/.test(JSON.stringify(stream?.messages || [])));

const lines = await page.evaluate(async () => (await import('/src/system/call.js')).call.get().lines);
const first = lines.find(l => l.role === 'char');
ok('角色说的就是中文、翻译也设成中文：字幕不出第二行', first && !first.trans, JSON.stringify(first));
ok('也没有为它发翻译请求', !reqs.some(j => !j.stream && /lines/.test(JSON.stringify(j.messages || []))),
  String(reqs.length));
await page.evaluate(async () => (await import('/src/system/call.js')).hangUp());
await page.waitForTimeout(500);

// 聊天里的判断
const same = await page.evaluate(async () => {
  const t = await import('/src/system/ai/translate.js');
  return [
    t.alreadyIn('今天下雨了', '中文'), t.alreadyIn('OK，好的', '简体中文'),
    t.alreadyIn('It is raining', '中文'), t.alreadyIn('もしもし、元気？', '中文'),
    t.alreadyIn('もしもし', '日语'), t.alreadyIn('Hello there', 'English'),
    t.alreadyIn('今天下雨了', 'Français'),
  ];
});
ok('判断是不是已经是目标语言', JSON.stringify(same) === JSON.stringify([true, true, false, false, true, true, false]), JSON.stringify(same));

// 普通聊天里：模型自己给的译文和原文一模一样，不挂
const hung = await page.evaluate(async chatId => {
  const reply = await import('/src/system/ai/reply.js');
  const db = await import('/src/system/db/index.js');
  const chat = db.chats.get(chatId);
  const char = db.characters.get(chat.characterIds[0]);
  await reply.renderTurn({ chat, char, raw: '今天下雨了\n[译文：今天下雨了]', turnId: 't1', instant: true });
  const m = db.messages.where(x => x.chatId === chatId && x.turnId === 't1')[0];
  return m ? (m.translation || '') : 'missing';
}, ids.chat);
ok('聊天里模型照抄原文当译文：不挂译文', hung === '', hung);

// ---- 四、小号 ----
const alt1 = await page.evaluate(async charId => {
  const db = await import('/src/system/db/index.js');
  db.characters.update(charId, { charAlt: true });
  const t = await import('/src/system/ai/tasks/char-alt.js');
  const r = await t.openAlt(charId, 'me');
  return r.alt.id;
}, ids.ch);
const firstAltReq = JSON.stringify(reqs.filter(j => /second account/.test(JSON.stringify(j.messages || []))).pop()?.messages || []);
ok('开小号：给了最近这段对话', /周末去看海/.test(firstAltReq), firstAltReq.slice(0, 300));
await page.evaluate(async id => (await import('/src/system/db/index.js')).characters.remove(id), alt1);
await page.evaluate(async charId => {
  const t = await import('/src/system/ai/tasks/char-alt.js');
  await t.openAlt(charId, 'me');
}, ids.ch);
await page.evaluate(async charId => {
  const t = await import('/src/system/ai/tasks/char-alt.js');
  await t.openAlt(charId, 'me');
}, ids.ch);
const thirdReq = JSON.stringify(reqs.filter(j => /second account/.test(JSON.stringify(j.messages || []))).pop()?.messages || []);
ok('再开：知道之前开过的号和各自的原因', /号2/.test(thirdReq) && /第2次的原因/.test(thirdReq), thirdReq.slice(-500));
ok('删掉的那个号也记得，写明已删除', /号1/.test(thirdReq) && /第1次的原因/.test(thirdReq) && /since deleted/.test(thirdReq), thirdReq.slice(-500));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
