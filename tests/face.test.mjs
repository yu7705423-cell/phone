// 会话页上的线上 / 线下切换（ARCHITECTURE 4.269）：
//   切过去之后开场是面对面、旁白必写、手机上的动作不给、世界书按会话关掉的、文风按会话选的；
//   历史里按 side 的变化插「以下当面」「以下在手机上」；切回来开场回到发消息。
//   线下期间不主动发消息、延迟回复按发完就回。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
let reply = '好。';
await ctx.route('**/relay.example.com/**', async route => {
  reqs.push(JSON.parse(route.request().postData() || '{}'));
  return route.fulfill({ status: 200, contentType: 'text/event-stream',
    body: [...reply].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const A = db.lorebooks.create({ name: '线上用的', global: false, entries: [
    { id: 'a1', comment: 'a', content: 'ONLINE-BOOK', keys: [], constant: true, enabled: true, part: 'before', depth: 0 }] });
  const G = db.lorebooks.create({ name: '全局', global: true, entries: [
    { id: 'g1', comment: 'g', content: 'GLOBAL-BOOK', keys: [], constant: true, enabled: true, part: 'before', depth: 0 }] });
  const c = db.characters.create({ name: '阿岚', lorebookIds: [A.id], proactive: true });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now(), paceMode: 'paced' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '到了吗', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: '快了', status: 'done' });
  return { char: c.id, chat: chat.id, A: A.id };
});
const turn = (text, turnId) => ev(async ({ chat, char, text, turnId }) => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  const face = await import('/src/system/face.js');
  db.messages.create({ chatId: chat, role: 'user', authorId: 'me', kind: 'text', content: text, status: 'done',
    ...(face.on(db.chats.get(chat)) ? { side: 'face' } : {}) });
  const raw = await e.streamReply({ chat: db.chats.get(chat), char: db.characters.get(char) });
  const made = await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId, instant: true });
  return made.map(m => ({ kind: m.kind, side: m.side || '', content: m.content }));
}, { ...ids, text, turnId });
const last = () => reqs[reqs.length - 1];
const sysOf = () => String(last()?.messages?.[0]?.content || '');
const histOf = () => (last()?.messages || []).slice(1).map(m => m.content).join('\n----\n');

// 线上：照旧
reply = '到了。';
await turn('好', 't0');
ok('线上：开场是发消息', /texting .* on a phone/.test(sysOf()), sysOf().slice(0, 120));
ok('线上：世界书照旧', /ONLINE-BOOK/.test(sysOf()) && /GLOBAL-BOOK/.test(sysOf()), '');
ok('线上：历史里没有当面的标记', !/以下当面/.test(histOf()), '');

// 切到线下
const st = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const face = await import('/src/system/face.js');
  const pace = await import('/src/system/pace.js');
  const pro = await import('/src/system/ai/proactive.js');
  face.setBooks(o.chat, { off: [o.A] });
  face.setTones(o.chat, ['lean']);
  const line = face.enter(o.chat, { place: '旧书店', at: '周三 14:30', note: '对方迟到了四十分钟' });
  const chat = db.chats.get(o.chat);
  return { on: face.on(chat), line: { kind: line.kind, side: line.side, content: line.content },
    mode: pace.modeOf(chat), state: pace.stateOf(chat).kind, ready: !!pro.chatReady(o.char) };
}, ids);
ok('切过去：会话记着在线下', st.on, JSON.stringify(st));
ok('切过去：消息流里落一条分隔线', st.line.kind === 'side' && st.line.side === 'face' && st.line.content === '[线下 · 旧书店 · 周三 14:30]', JSON.stringify(st.line));
ok('线下期间延迟回复档位不变、状态按空闲算（调用次数不变）', st.mode === 'paced' && st.state === 'free', `${st.mode} ${st.state}`);
ok('线下期间不主动发消息', st.ready === false, String(st.ready));

reply = '[旁白：他抬起头。]\n你来了。\n坐。';
const made = await turn('我到了', 't1');
const sys = sysOf(); const hist = histOf();
ok('线下：开场是面对面', /in the same place, face to\s+face/.test(sys) && !/texting .* on a phone/.test(sys), sys.slice(0, 160));
ok('线下：这一场的事实（地点、时刻、情境）', /\[这一场\]/.test(sys) && /地点：旧书店/.test(sys) && /时刻：周三 14:30/.test(sys) && /情境：对方迟到了四十分钟/.test(sys), '');
ok('线下：仍是每轮 3 到 5 条', /3 to 5 separate messages/.test(sys), '');
ok('线下：旁白必写（会话没开旁白也给）', /at least one\s+narration line/.test(sys), '');
ok('线下：转账、外卖、表情这些手机上的动作不给', !/\[转账/.test(sys) && !/\[外卖/.test(sys) && !/\[表情：/.test(sys) && !/\[图片：/.test(sys), (sys.match(/\[(转账|外卖|表情|图片)[^\]]*\]/) || [''])[0]);
ok('线下：关掉的书不进，全局照旧', !/ONLINE-BOOK/.test(sys) && /GLOBAL-BOOK/.test(sys), '');
ok('线下：会话选的文风写进去', /\[文风\]/.test(sys) && /No metaphor/.test(sys), '');
ok('线下：历史里有「以下当面」，带着地点', /\[以下当面\]/.test(hist) && /地点：旧书店/.test(hist) && hist.indexOf('以下当面') > hist.indexOf('快了'), hist.slice(-400));
ok('线下：生成的每条记着 side', made.length === 3 && made.every(m => m.side === 'face') && made[0].kind === 'narration', JSON.stringify(made));

// 切回线上
const back = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const face = await import('/src/system/face.js');
  const pace = await import('/src/system/pace.js');
  const line = face.leave(o.chat);
  return { on: face.on(db.chats.get(o.chat)), line: line.content, mode: pace.modeOf(db.chats.get(o.chat)) };
}, ids);
ok('切回来：分隔线写「回到线上」，节奏照旧', !back.on && back.line === '[回到线上]' && back.mode === 'paced', JSON.stringify(back));
reply = '到家了？';
await turn('到家了', 't2');
ok('切回来：开场回到发消息，世界书恢复', /texting .* on a phone/.test(sysOf()) && /ONLINE-BOOK/.test(sysOf()), '');
const h2 = histOf();
ok('切回来：历史里当面那一段夹在两条标记之间', /\[以下当面\]/.test(h2) && /\[以下在手机上\]/.test(h2) && h2.indexOf('以下当面') < h2.indexOf('你来了') && h2.indexOf('你来了') < h2.indexOf('以下在手机上'), h2.slice(-500));

// 记忆提取：对话里带着分界
const dlg = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const mx = await import('/src/system/ai/tasks/memory-extract.js');
  return mx.pendingOf(o.chat).map(m => (m.kind === 'side' ? `<${m.side}>` : m.content)).join('|');
}, ids);
ok('记忆提取吃到的对话里带着分界', /<face>/.test(dlg) && /<phone>/.test(dlg), dlg);

// 界面：面板里「线下」先问一句；顶上一条；分隔线
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(900);
const lines = await ev(() => [...document.querySelectorAll('.ph-side')].map(x => x.textContent.trim()));
ok('消息流里画着两条分隔线', JSON.stringify(lines) === '["线下 · 旧书店 · 周三 14:30","回到线上"]', JSON.stringify(lines));
const faced = await ev(() => document.querySelectorAll('.ph-msg-face').length);
ok('线下的那几条气泡挂着 ph-msg-face（旁白那一行不是气泡）', faced === 3, String(faced));
await page.locator('.ph-plus').first().click();
await page.waitForTimeout(500);
await page.locator('.composer-panel').getByText('线下', { exact: true }).first().click();
await page.waitForTimeout(500);
ok('面板里点「线下」先问就在这里还是写成长文', await page.getByText('就在这里', { exact: true }).count() > 0 && await page.getByText('写成长文', { exact: true }).count() > 0, '');
await page.getByText('就在这里', { exact: true }).first().click();
await page.waitForTimeout(600);
const sheetTxt = await ev(() => [...document.querySelectorAll('.sheet, .full-sheet, [class*="sheet"]')].map(x => x.innerText).join('\n'));
ok('那张单子上有地点、时刻、情境、世界书、文风', /地点/.test(sheetTxt) && /时刻/.test(sheetTxt) && /情境/.test(sheetTxt) && /线下时生效的世界书/.test(sheetTxt) && /线下时的文风/.test(sheetTxt), sheetTxt.slice(0, 300));
ok('单子上预填着上次的地点', (await page.locator('input[placeholder="例如 旧书店"]').inputValue()) === '旧书店', '');
await page.getByText('开始', { exact: true }).last().click();
await page.waitForTimeout(600);
const bar = await ev(() => document.querySelector('.face-bar')?.innerText || '');
ok('切过去之后顶上一条写着在哪，旁边「回到线上」', /旧书店/.test(bar) && /回到线上/.test(bar), bar);
await page.locator('.face-bar-back').click();
await page.waitForTimeout(500);
const barGone = await ev(() => !document.querySelector('.face-bar'));
const n = await ev(async o => (await import('/src/system/db/index.js')).db.messagesOf(o.chat).filter(m => m.kind === 'side').length, ids);
ok('点「回到线上」：条子消失，又落两条分隔线', barGone && n === 4, `${barGone} ${n}`);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
