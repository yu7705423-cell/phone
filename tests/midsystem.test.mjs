// 对话中间插入的设定（设了深度的世界书、本轮召回、时间与状态）在 OpenAI 兼容接口上要能被模型看见。
//
// 从前它们以 role: system 插在历史中间原样发出。中转转给 Claude、Gemini 时常被丢掉或只留第一条 ——
// 请求记录里看得见，模型却没看见。现在默认转成 user 轮、用 <context> 包住；接口编辑页可以改回原样。
// 请求记录记的是真正发出去的样子。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const bodies = [];
await page.route('https://relay.example.com/**', async r => {
  bodies.push(JSON.parse(r.request().postData() || '{}'));
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '好' } }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const trace = await import('/src/system/ai/trace.js');
  trace.setOn(true);
  const p = svc.newChatPreset({ name: '中转', provider: 'openai', baseUrl: 'https://relay.example.com/v1', apiKey: 'sk', model: 'claude-x' });
  svc.setActiveChat(p.id);
  db.settings.set({ streamMode: 'once', retryMax: 0, chatFallback: false });
  db.lorebooks.create({ name: '书', global: true, entries: [
    { id: 'e1', enabled: true, constant: true, content: 'LORE-AT-TOP', depth: 0, part: 'before' },
    { id: 'e2', enabled: true, constant: true, content: 'LORE-AT-DEPTH-ONE', depth: 1 },
    { id: 'e3', enabled: true, constant: true, content: 'LORE-AT-DEPTH-THREE', depth: 3 },
  ] });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  for (let i = 0; i < 6; i++) {
    db.messages.create({ chatId: chat.id, role: i % 2 ? 'char' : 'user', authorId: i % 2 ? c.id : 'me',
      kind: 'text', content: `第 ${i + 1} 句`, status: 'done' });
  }
  return { preset: p.id, chat: chat.id, char: c.id };
});

const reply = () => page.evaluate(async ({ chat, char }) => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.streamReply({ chat: db.chats.get(chat), char: db.characters.get(char) });
}, ids);
const lastTrace = () => page.evaluate(async () => {
  const trace = await import('/src/system/ai/trace.js');
  const rows = trace.list ? trace.list() : [];
  return rows[0] || rows[rows.length - 1] || null;
});

// ---- 默认：转成 user ----
await reply();
let msgs = bodies.at(-1)?.messages || [];
const roles = msgs.map(m => m.role);
ok('只有开头那一条是 system', roles[0] === 'system' && roles.slice(1).every(r => r !== 'system'), roles.join(','));
ok('留在设定区的条目在开头的 system 里', /LORE-AT-TOP/.test(msgs[0]?.content || ''));
const withDepth1 = msgs.find(m => /LORE-AT-DEPTH-ONE/.test(m.content));
ok('深度 1 的条目发出去了，作为用户消息、用 <context> 标注', withDepth1?.role === 'user' && /<context>[\s\S]*LORE-AT-DEPTH-ONE[\s\S]*<\/context>/.test(withDepth1.content),
  JSON.stringify(withDepth1));
ok('深度 3 的条目也发出去了', msgs.some(m => m.role === 'user' && /LORE-AT-DEPTH-THREE/.test(m.content)));
const at1 = msgs.findIndex(m => /LORE-AT-DEPTH-ONE/.test(m.content));
ok('深度 1 的条目贴在最后一条之前', at1 >= msgs.length - 2, `${at1} / ${msgs.length}`);
ok('没有连续两条同角色的消息', msgs.every((m, i) => i === 0 || m.role !== msgs[i - 1].role), roles.join(','));
const tr = await lastTrace();
ok('请求记录记的是真正发出去的样子（中间没有 system）', !tr || (tr.messages || []).every(m => m.role !== 'system'),
  JSON.stringify((tr?.messages || []).map(m => m.role)));

// ---- 改回原样 ----
await page.evaluate(async id => (await import('/src/system/ai/services.js')).updateChatPreset(id, { midSystem: 'system' }), ids.preset);
await reply();
msgs = bodies.at(-1)?.messages || [];
ok('选了「原样 system」：中间的条目以 system 发送', msgs.slice(1).some(m => m.role === 'system' && /LORE-AT-DEPTH-ONE/.test(m.content)),
  msgs.map(m => m.role).join(','));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
