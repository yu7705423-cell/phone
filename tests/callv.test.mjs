// 通话：打字进去，配了音色的角色用那个音色回；没配就说清楚是哪一环。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const tts = [];
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  if (/t2a_v2|audio\/speech|text-to-speech/.test(u)) {
    tts.push(u);
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: '4944330300' } }) });
  }
  if (/v1\/messages|chat\/completions/.test(u)) {
    // 通话那条路是写死流式的（按句切播放靠它），所以要给 SSE 而不是整块 JSON
    const post = route.request().postDataJSON?.() || {};
    if (!post.stream) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ content: [{ type: 'text', text: '我在的。你说。' }] }) });
    }
    const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: ev('content_block_delta', { type: 'content_block_delta', index: 0,
        delta: { type: 'text_delta', text: '我在的。你说。' } })
        + ev('message_stop', { type: 'message_stop' }) });
  }
  return route.abort();
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);
const txt = () => page.evaluate(() => document.body.innerText);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
  db.settings.set({ streamMode: 'once' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  return { chat: chat.id, char: c.id };
});

// ---- 1 没配语音时，说得出是哪一环 ----
const why = await page.evaluate(async ([charId]) => {
  const call = await import('/src/system/call.js');
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const out = {};
  const ch = () => db.characters.get(charId);
  out.noApi = call.voiceWhy(ch());
  svc.setVoice({ enabled: true, kind: 'minimax', apiKey: 'sk-cp-x', model: 'speech-01' });
  out.noVoiceId = call.voiceWhy(ch());
  db.characters.update(charId, { voiceId: 'v-1' });
  out.okNow = call.voiceWhy(ch());
  db.characters.update(charId, { canSendVoice: false });
  out.turnedOff = call.voiceWhy(ch());
  db.characters.update(charId, { canSendVoice: true });
  return out;
}, [ids.char]);
check(/尚未配置语音接口/.test(why.noApi), `没配接口时说得出（${why.noApi}）`);
check(/尚未设置音色/.test(why.noVoiceId), `配了接口但角色没音色，也说得出（${why.noVoiceId}）`);
check(why.okNow === '', '都配好了就不再啰嗦');
check(/语音已关闭/.test(why.turnedOff), `角色把语音关了也说得出（${why.turnedOff}）`);

// ---- 2 配好了，喇叭默认就是开的 ----
const dialed = await page.evaluate(async ([chatId]) => {
  const call = await import('/src/system/call.js');
  const db = await import('/src/system/db/index.js');
  db.settings.set({ callSpeak: null });     // 还没碰过那个喇叭
  call.dial(chatId);
  const s = call.call.get();
  return { speak: s.speak, mic: s.mic, phase: s.phase };
}, [ids.chat]);
check(dialed.speak === true, `配了音色，打电话默认就出声（speak=${dialed.speak}）`);
check(dialed.mic === false, '默认还是打字那一档，不擅自开麦');

// ---- 3 打字进去，回话走语音接口 ----
// 等它自己接；到点还没接就自己推一把（接不接由角色作息决定，见 call.js）
for (let i = 0; i < 30; i++) {
  const ph = await page.evaluate(async () => (await import('/src/system/call.js')).call.get().phase);
  if (ph === 'active') break;
  if (ph === 'idle') { await page.evaluate(async ([c]) => (await import('/src/system/call.js')).dial(c), [ids.chat]); }
  else await page.evaluate(async () => { const c = await import('/src/system/call.js'); c.accept(); });
  await page.waitForTimeout(400);
}
const phase = await page.evaluate(async () => (await import('/src/system/call.js')).call.get().phase);
check(phase === 'active', `电话接通了（phase=${phase}）`);
tts.length = 0;
const said = await page.evaluate(async () => {
  const call = await import('/src/system/call.js');
  try { await call.say('在吗'); return 'ok'; }
  catch (e) { return 'THREW ' + (e.message || e); }
});
await page.waitForTimeout(3000);
console.log('  ..   say() 回来：', said, '| 错：', JSON.stringify(errs.slice(0, 2)));
const after = await page.evaluate(async () => {
  const call = await import('/src/system/call.js');
  const s = call.call.get();
  return { lines: s.lines.map(l => `${l.role}:${l.text}`), phase: s.phase };
});
check(after.lines.some(l => l.startsWith('user:在吗')), `打进去的字进了通话记录（${JSON.stringify(after.lines)}）`);
check(after.lines.some(l => /char:/.test(l)), '角色回话了');
check(tts.length > 0, `回话走了语音合成接口（${tts.length} 次：${(tts[0] || '').slice(0, 50)}）`);

// ---- 4 手动关掉喇叭，下一通要记住 ----
const remembered = await page.evaluate(async ([chatId]) => {
  const call = await import('/src/system/call.js');
  if (call.call.get().speak) call.toggleSpeak();
  call.hangUp();
  await new Promise(r => setTimeout(r, 400));
  call.dial(chatId);
  const s = call.call.get();
  return s.speak;
}, [ids.chat]);
check(remembered === false, `手动关过就记住，不再自作主张打开（speak=${remembered}）`);

// ---- 5 账要摆在用量页上 ----
const cost = await page.evaluate(async () => {
  const c = await import('/src/system/ai/cost.js');
  const db = await import('/src/system/db/index.js');
  db.settings.set({ callSpeak: true });
  const on = c.active().some(x => x.id === 'callVoice');
  db.settings.set({ callSpeak: false });
  const off = c.active().some(x => x.id === 'callVoice');
  return { on, off, listed: c.EXTRA_CALLS.some(x => x.id === 'callVoice') };
});
check(cost.listed && cost.on && !cost.off, `登记在用量页上，开了才计入（${JSON.stringify(cost)}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
