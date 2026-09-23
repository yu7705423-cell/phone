// 记忆第二批：易变块下沉，设定区连成一整段稳定前缀
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
let sent = null;
await page.route('**/v1/messages', async route => {
  sent = JSON.parse(route.request().postData() || '{}');
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: '嗯' }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  svc.newChatPreset({ name: 'A', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚', persona: '人设正文',
    gender: '女', timezone: 'Asia/Tokyo' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  db.memories.create({ charId: c.id, personaId: me.id, content: '她在成都做编辑',
    category: 'fact', rank: 'A', keywords: ['成都'], source: 'manual' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text',
    content: '在吗', status: 'done' });
  return { chat: chat.id, char: c.id, me: me.id };
});

const built = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const eng = await import('/src/system/ai/engine.js');
  const mem = await import('/src/system/ai/context/memory.js');
  const chat = db.chats.get(i.chat), char = db.characters.get(i.char);
  const msgs = db.messagesOf(i.chat);
  const s0 = db.settings.get();
  const recall = mem.recall({ settings: s0, char, scanText: '在吗',
    budgets: { memory: 2000 }, queryVec: null, persona: db.personas.get(i.me) });
  const { system, volatile: hot } = eng.buildChatSystem(chat, char, msgs, { recall });
  const hist = eng.buildHistory(chat, char, msgs, { recall, volatile: hot });
  return { system, hot, hist: hist.map(h => ({ role: h.role, c: h.content })) };
}, ids);

// ---- 1 时间这一块不在设定区了 ----
check(!built.system.includes('[现在几点]'), '设定区里没有「现在几点」了');
check(built.hot.includes('[现在几点]'), `它落在下沉那一段里（${built.hot.slice(0, 40)}）`);
check(built.system.includes('[你是谁]') || built.system.includes('人设正文'), '人设照旧在设定区');
check(built.system.includes('[消息规则]'), '消息规则照旧在设定区');

// ---- 2 稳的在前，变的在后：设定区里最后一段仍然是性别锚点 ----
check(built.system.trimEnd().endsWith('keep them consistent throughout.'),
  `设定区收尾还是性别锚点（${built.system.slice(-60)}）`);

// ---- 3 下沉那一段和召回合成一条，召回排在状态后面 ----
const injected = built.hist.find(h => h.role === 'system');
check(!!injected, '对话里插了一条上下文');
check(injected.c.includes('[现在几点]') && injected.c.includes('[相关记忆]'),
  '状态与召回在同一条里');
check(injected.c.indexOf('[现在几点]') < injected.c.indexOf('[相关记忆]'),
  '召回排在状态后面，离最后一句话更近');
check(built.hist[built.hist.length - 1].role === 'user', '最后一条仍然是用户那句');

// ---- 4 真发一轮：Anthropic 那边照样只有 user / assistant ----
await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const eng = await import('/src/system/ai/engine.js');
  await eng.streamReply({ chat: db.chats.get(i.chat), char: db.characters.get(i.char) });
}, ids);
const roles = (sent?.messages || []).map(m => m.role);
check(!roles.includes('system'), `messages 里没有 system（${JSON.stringify(roles)}）`);
check(!/\[现在几点\]/.test(sent?.system || ''), '顶层 system 里也没有时间块了');
check(/\[现在几点\]/.test(String(sent?.messages?.[0]?.content || '')), '时间块跟着对话末尾走');

// ---- 5 设定区这一段在两轮之间是稳的（缓存前缀） ----
const twice = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const eng = await import('/src/system/ai/engine.js');
  const chat = db.chats.get(i.chat), char = db.characters.get(i.char);
  const a = eng.buildChatSystem(chat, char, db.messagesOf(i.chat), {}).system;
  // 时间往前推一小时：从前这一下会让设定区整段变样
  db.settings.set({ timeMode: 'virtual', timeVirtualAt: Date.now() - 3600000, timeSetAt: Date.now() });
  const b = eng.buildChatSystem(chat, char, db.messagesOf(i.chat), {}).system;
  db.settings.set({ timeMode: 'real' });
  return a === b;
}, ids);
check(twice, '时间变了，设定区一个字都没变 —— 前缀稳住了');

// ---- 6 通话与主动发起不能把下沉那几块弄丢 ----
const call = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const eng = await import('/src/system/ai/engine.js');
  return eng.buildCallSystem(db.chats.get(i.chat), db.characters.get(i.char));
}, ids);
check(/\[现在几点\]/.test(call), '通话那份 system 里时间块接回来了');
check(/\[通话中\]|call/i.test(call), '通话说明也在');

// ---- 7 设定区声明成可缓存 ----
const sys = sent?.system;
check(Array.isArray(sys) && sys[0]?.cache_control?.type === 'ephemeral',
  `system 带上了缓存声明（${JSON.stringify(sys).slice(0, 80)}）`);
check(Array.isArray(sys) && typeof sys[0]?.text === 'string' && sys[0].text.includes('[消息规则]'),
  '正文原样在里面');
await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const eng = await import('/src/system/ai/engine.js');
  db.settings.set({ promptCache: false });
  await eng.streamReply({ chat: db.chats.get(i.chat), char: db.characters.get(i.char) });
  db.settings.set({ promptCache: true });
}, ids);
check(typeof sent?.system === 'string', '关掉之后退回原来那种纯字符串');

// 一次性任务的 system 每次都不同，声明了也命中不了，只会按写入价多付两成五。
// 开着开关也不该带
await page.evaluate(async () => {
  const eng = await import('/src/system/ai/engine.js');
  // 桩回的是流式格式，非流式那条解析不了也无妨：要看的是发出去的请求
  try { await eng.runTextTask('theirs.notes', { system: 'Write one line.', user: 'go' }); } catch {}
});
check(typeof sent?.system === 'string' && sent.system === 'Write one line.',
  `一次性任务不带缓存声明（${JSON.stringify(sent?.system).slice(0, 60)}）`);

// ---- 8 界面上把这笔账写清楚 ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js'); nav.goHome(); nav.openApp('settings', '/limits');
});
await page.waitForTimeout(700);
const ui = await page.locator('.app-layer').innerText();
check(/缓存设定区那一段/.test(ui), '用量页上有这个开关');
check(/十分之一/.test(ui) && /一点二五倍/.test(ui), '两头的账都写了');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
