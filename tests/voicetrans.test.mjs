// 语音与译文：译文写进 [语音：…] 里、或跟在语音下一行时，念出来的只有原话，译文收进这条语音；
// 通话里开口打断角色时，角色已经说出口的那半句留在字幕里，不凭空消失
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
const tts = [];
let reply = '';
let hold = null;          // 通话里要「卡住」的那一轮：先不回，等测试放行
await ctx.route('**/relay.example.com/**', async route => {
  const u = route.request().url();
  const body = route.request().postData() || '';
  if (/audio\/speech/.test(u)) {
    tts.push(JSON.parse(body).input);
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from([0xff, 0xfb, 0x90]) });
  }
  const j = JSON.parse(body || '{}');
  if (hold) await hold;
  const text = reply;
  if (j.stream) {
    const chunks = [...text].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`);
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: chunks.join('') + 'data: [DONE]\n\n' });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: text } }] }) });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = (await import('/src/system/db/index.js'));
  const svc = (await import('/src/system/ai/services.js'));
  const acc = (await import('/src/system/accounts.js'));
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  svc.setVoice({ enabled: true, kind: 'openai', apiKey: 'k', model: 'tts-1', baseUrl: 'https://relay.example.com/v1' });
  const me = acc.current();
  const a = db.characters.create({ name: '小林', persona: 'x', voiceId: 'v1' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, title: '', translateTo: '中文' });
  return { char: a.id, chat: chat.id };
});

const split = raw => page.evaluate(async r => (await import('/src/system/ai/reply.js')).splitReply(r)
  .map(p => ({ type: p.type, text: p.text, translation: p.translation || '' })), raw);

// ---- 一、拆分 ----
let p = await split('[语音：元気だよ（译文：我很好）]');
ok('括号里夹着「译文：」：念的只有原话，译文收进这条语音', p.length === 1 && p[0].type === 'voice'
  && p[0].text === '元気だよ' && p[0].translation === '我很好', JSON.stringify(p));
p = await split('[语音：元気だよ [译文：我很好]]');
ok('括号里再套一层 [译文：…]', p[0]?.type === 'voice' && p[0].text === '元気だよ' && p[0].translation === '我很好', JSON.stringify(p));
p = await split('[语音：元気だよ\n[译文：我很好]\n今日は晴れ\n[译文：今天晴天]');
ok('语音的括号没收口、译文落在下一行：不把译文吞进语音', p[0]?.type === 'voice' && p[0].text === '元気だよ'
  && p[0].translation === '我很好' && p[1]?.text === '今日は晴れ' && p[1].translation === '今天晴天', JSON.stringify(p));
p = await split('[语音：元気だよ]\n[译文：我很好]\n今日は晴れ\n[译文：今天晴天]');
ok('语音下一行的译文挂在这条语音上，后面那条不错位', p[0]?.translation === '我很好'
  && p[1]?.text === '今日は晴れ' && p[1].translation === '今天晴天', JSON.stringify(p));
p = await split('こんにちは\n[译文：你好]\n[语音：元気だよ]\n今日は晴れ\n[译文：今天晴天]');
ok('语音没跟译文时：别人的译文不挂到语音上', p[0]?.translation === '你好' && p[1]?.type === 'voice' && !p[1].translation
  && p[2]?.translation === '今天晴天', JSON.stringify(p));
await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.set({ translateFormats: '{原文}（{译文}）' }));
p = await split('[语音：元気だよ（我很好）]');
ok('用户配的行内形状同样认', p[0]?.type === 'voice' && p[0].text === '元気だよ' && p[0].translation === '我很好', JSON.stringify(p));
await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.set({ translateFormats: '' }));
p = await split('[语音：今天（其实是昨天）的事]');
ok('没配行内形状时，语音里的普通括号照念', p[0]?.text === '今天（其实是昨天）的事' && !p[0].translation, JSON.stringify(p));

// ---- 二、整轮落下来：送去合成的只有原话 ----
const made = await page.evaluate(async (o) => {
  const db = (await import('/src/system/db/index.js'));
  const r = (await import('/src/system/ai/reply.js'));
  const chat = db.chats.get(o.chat); const char = db.characters.get(o.char);
  const out = await r.renderTurn({ chat, char, raw: '[语音：元気だよ（译文：我很好）]', turnId: 't1', instant: true });
  await new Promise(res => setTimeout(res, 1200));
  const m = db.messages.get(out[0].id);
  return { id: m.id, voiceText: m.voiceText, translation: m.translation, content: m.content, media: m.media };
}, ids);
ok('送去语音接口的只有原话', tts.length === 1 && tts[0] === '元気だよ', JSON.stringify(tts));
ok('消息上：语音文字是原话，译文另存', made.voiceText === '元気だよ' && made.translation === '我很好'
  && made.content === '[语音：元気だよ]', JSON.stringify(made));

// 旧消息里已经混进了译文：重新生成语音时同样只念原话
tts.length = 0;
await page.evaluate(async (o) => {
  const db = (await import('/src/system/db/index.js'));
  const r = (await import('/src/system/ai/reply.js'));
  const m = db.messages.create({ chatId: o.chat, role: 'char', authorId: o.char, kind: 'voice',
    content: '[语音：おやすみ 译文：晚安]', voiceText: 'おやすみ 译文：晚安', media: 'error', status: 'done' });
  r.regenMedia(m.id);
  await new Promise(res => setTimeout(res, 1200));
}, ids);
ok('旧消息重新生成：同样只念原话', tts.length === 1 && tts[0] === 'おやすみ', JSON.stringify(tts));

// 气泡：点开文字能看到译文
await page.evaluate(async (o) => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(900);
await page.locator(`#msg-${made.id} [aria-label="文字"]`).click();
await page.waitForTimeout(300);
const vt = await page.locator(`#msg-${made.id}`).innerText();
ok('语音气泡展开文字：原话下面是译文', /元気だよ/.test(vt) && /我很好/.test(vt), vt);

// ---- 三、通话里开口打断：角色说到一半的那句留在字幕里 ----
reply = '喂，是我。';
const callState = async () => page.evaluate(async () => {
  const c = (await import('/src/system/call.js')).call.get();
  return { phase: c.phase, lines: c.lines.map(l => `${l.role}:${l.text}`), draft: c.draft };
});
await page.evaluate(async (o) => {
  const c = await import('/src/system/call.js');
  const db = (await import('/src/system/db/index.js'));
  db.settings.set({ callSpeak: false, callMic: false });
  // 接不接带一点随机（见 call.willAnswer），免打扰时段里多半不接。这里测的不是接不接，
  // 拨号这一段把随机数钉在「接」上、把免打扰关掉，接通之后再放回去
  db.characters.update(o.char, { proactiveQuietFrom: 0, proactiveQuietTo: 0 });
  window.__rand = Math.random; Math.random = () => 0.01;
  c.dial(o.chat, { video: false });
}, ids);
for (let i = 0; i < 60 && (await callState()).phase !== 'active'; i++) await page.waitForTimeout(300);
await page.evaluate(() => { if (window.__rand) Math.random = window.__rand; });
for (let i = 0; i < 30 && !(await callState()).lines.length; i++) await page.waitForTimeout(300);
let st = await callState();
ok('接通，角色先开口', st.phase === 'active' && st.lines[0] === 'char:喂，是我。', JSON.stringify(st));

// 下一轮卡住：角色正在说（字幕上已经有半句），这时我又说了一句
let release;
hold = new Promise(r => { release = r; });
reply = '我刚才想说的是';
await page.evaluate(async () => { (await import('/src/system/call.js')).say('第一句'); });
await page.waitForTimeout(300);
await page.evaluate(async () => { (await import('/src/system/call.js')).call.set({ thinking: false, draft: '其实我一直想' }); });
await page.evaluate(async () => { (await import('/src/system/call.js')).say('第二句'); });
await page.waitForTimeout(300);
st = await callState();
ok('打断时，角色已经说出口的半句留在字幕里，排在我这一句前面',
  JSON.stringify(st.lines) === JSON.stringify(['char:喂，是我。', 'user:第一句', 'char:其实我一直想', 'user:第二句']), JSON.stringify(st.lines));
hold = null; release();
for (let i = 0; i < 30 && (await callState()).lines.length < 5; i++) await page.waitForTimeout(300);
await page.waitForTimeout(800);
st = await callState();
ok('被打断的那一轮不再补一条，新的一轮接在后面', st.lines.length === 5 && st.lines[4] === 'char:我刚才想说的是', JSON.stringify(st.lines));
await page.evaluate(async () => (await import('/src/system/call.js')).hangUp());

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
