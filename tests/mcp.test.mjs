// MCP：三代服务器都连得上（2026-07-28 无状态、Streamable HTTP 握手、旧版 SSE）；
// 设置页添加、连接、逐个关工具；角色卡上勾服务器；角色写 [调用：…] 会真的调、
// 要确认的等你点允许；结果以 [工具结果：…] 进历史；结果回来后接着回复默认关、开了按轮数停
import http from 'node:http';
import { BASE, OUT, EXE, chromium } from './_env.mjs';

// ---- 三台真的 MCP 服务器 ----
const seen = { a: [], b: [], c: [] };
const cors = (res, allow) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', allow);
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
};
const readBody = req => new Promise(ok => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => ok(b)); });
const listen = srv => new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(srv.address().port)));
const reply = (res, id, result) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result })); };
const fail = (res, id, code, message) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })); };

// A：2026-07-28。要密钥；tools/list 分两页；tools/call 用 SSE 回，前面先塞一条通知
const TOOLS_A = [
  { name: 'weather', description: '查询天气', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { city: { type: 'string' }, days: { type: 'array', items: { type: 'number' } } }, required: ['city'] } },
  { name: 'send_note', description: '发送一条便签', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'secret', description: '不该告诉角色的工具', inputSchema: { type: 'object' } },
];
const srvA = http.createServer(async (req, res) => {
  cors(res, 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.headers.authorization !== 'Bearer t') { res.statusCode = 401; return res.end('need key'); }
  const msg = JSON.parse(await readBody(req));
  seen.a.push({ method: msg.method, h: req.headers['mcp-method'], name: req.headers['mcp-name'],
    pv: req.headers['mcp-protocol-version'], meta: msg.params?._meta?.['io.modelcontextprotocol/protocolVersion'], args: msg.params?.arguments });
  if (msg.method === 'initialize') return fail(res, msg.id, -32601, 'modern only');
  if (msg.method === 'server/discover') {
    return reply(res, msg.id, { supportedVersions: ['2026-07-28'], capabilities: { tools: {} },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'modern-srv', version: '2.0' } } });
  }
  if (msg.method === 'tools/list') {
    return reply(res, msg.id, msg.params?.cursor ? { tools: TOOLS_A.slice(2) } : { tools: TOOLS_A.slice(0, 2), nextCursor: 'p2' });
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: a } = msg.params;
    const text = name === 'weather' ? `${a.city} 晴 ${(a.days || []).join('/')}` + '。'.repeat(50) : `已发送：${a.text}`;
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`);
    res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } })}\n\n`);
    return res.end();
  }
  fail(res, msg.id, -32601, 'no such method');
});

// B：2025-06-18 Streamable HTTP。CORS 白名单里没有新一代那两个头 —— 浏览器会在预检时拒掉探测
let sessions = new Set();
const srvB = http.createServer(async (req, res) => {
  cors(res, 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const msg = JSON.parse(await readBody(req));
  seen.b.push({ method: msg.method, sid: req.headers['mcp-session-id'], pv: req.headers['mcp-protocol-version'] });
  if (msg.method === 'initialize') {
    const sid = `s${sessions.size + 1}-${Date.now()}`;
    sessions.add(sid);
    res.setHeader('Mcp-Session-Id', sid);
    return reply(res, msg.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-srv', version: '1.0' } });
  }
  const sid = req.headers['mcp-session-id'];
  if (!sid) { res.statusCode = 400; return res.end('no session'); }
  if (!sessions.has(sid)) { res.statusCode = 404; return res.end('session gone'); }
  if (msg.method === 'notifications/initialized') { res.statusCode = 202; return res.end(); }
  if (msg.method === 'tools/list') {
    return reply(res, msg.id, { tools: [{ name: 'add', description: '两数相加', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } }] });
  }
  if (msg.method === 'tools/call') return reply(res, msg.id, { content: [{ type: 'text', text: String(msg.params.arguments.a + msg.params.arguments.b) }] });
  fail(res, msg.id, -32601, 'no such method');
});

// C：2024-11-05 旧版 SSE。POST 到 /sse 不认；GET /sse 开流，流里告诉你往 /messages 发
let stream = null;
const srvC = http.createServer(async (req, res) => {
  cors(res, 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/sse' && req.method === 'POST') { res.statusCode = 405; return res.end(); }
  if (u.pathname === '/sse' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('event: endpoint\ndata: /messages?sid=1\n\n');
    stream = res;
    return undefined;
  }
  if (u.pathname === '/messages') {
    const msg = JSON.parse(await readBody(req));
    seen.c.push(msg.method);
    res.statusCode = 202; res.end();
    if (msg.id == null) return undefined;
    const result = msg.method === 'initialize'
      ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sse-srv', version: '0.1' } }
      : msg.method === 'tools/list' ? { tools: [{ name: 'echo', description: '原样返回', inputSchema: { type: 'object', properties: { s: { type: 'string' } } } }] }
      : msg.method === 'tools/call' ? { content: [{ type: 'text', text: `echo:${msg.params.arguments.s}` }] } : {};
    stream?.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
    return undefined;
  }
  res.statusCode = 404; res.end();
});
const [pA, pB, pC] = await Promise.all([listen(srvA), listen(srvB), listen(srvC)]);

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
let modelSays = '好';
let modelCalls = 0;
await ctx.route('**/relay.example.com/**', route => {
  modelCalls += 1;
  return route.fulfill({ status: 200, contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ choices: [{ delta: { content: modelSays } }] })}\n\ndata: [DONE]\n\n` });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const c = db.characters.create({ name: '林晚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id });
  return { char: c.id, chat: chat.id };
});

// ---- 一、设置页：添加、连接、关掉一个工具 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/'); });
await page.waitForTimeout(700);
await page.locator('.list-item', { hasText: 'MCP 工具' }).tap();
await page.waitForTimeout(500);
await page.locator('.nav-text', { hasText: '添加' }).tap();
await page.waitForTimeout(500);
const field = label => page.locator('.field', { hasText: label }).locator('input, textarea').first();
await field('名称').fill('天气');
await field('地址').fill(`http://127.0.0.1:${pA}/mcp`);
await page.locator('.btn', { hasText: '连接' }).tap();
await page.waitForTimeout(1200);
let txt = await page.locator('.page').last().innerText();
ok('没填密钥：连接失败，写明没有权限', /连接失败/.test(txt) && /没有权限/.test(txt), txt.slice(0, 400));
await field('请求头').fill('Authorization: Bearer t');
await page.locator('.btn', { hasText: /连接/ }).tap();
await page.waitForTimeout(1500);
txt = await page.locator('.page').last().innerText();
ok('填了密钥：连上新一代服务器，两页工具都取回来了', /modern-srv 2\.0/.test(txt) && /MCP 2026-07-28/.test(txt)
  && /weather/.test(txt) && /send_note/.test(txt) && /secret/.test(txt), txt.slice(0, 600));
const probe = seen.a.find(x => x.method === 'server/discover');
const list1 = seen.a.find(x => x.method === 'tools/list');
ok('新一代请求：头里带 Mcp-Method 与协议版本，_meta 里带版本，不发 initialize', probe?.h === 'server/discover' && probe.pv === '2026-07-28'
  && list1?.meta === '2026-07-28' && !seen.a.some(x => x.method === 'initialize'), JSON.stringify(seen.a.slice(0, 3)));
await page.screenshot({ path: `${OUT}/mcp-server.png` });
await page.locator('.list-item', { hasText: 'secret' }).locator('.switch, input[type=checkbox]').first().tap();
await page.waitForTimeout(300);
const srvId = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const s = svc.mcpServers()[0];
  svc.updateMcpServer(s.id, { approve: 'read' });
  return { id: s.id, off: s.toolsOff };
});
ok('关掉一个工具：记在 toolsOff', JSON.stringify(srvId.off) === '["secret"]', JSON.stringify(srvId.off));

// ---- 二、另外两代 ----
const other = await page.evaluate(async ([b, c]) => {
  const svc = await import('/src/system/ai/services.js');
  const t = await import('/src/system/mcptools.js');
  const mcp = await import('/src/system/mcp.js');
  const sb = svc.addMcpServer({ name: '计算', url: `http://127.0.0.1:${b}/mcp`, approve: 'auto' });
  const sc = svc.addMcpServer({ name: '回声', url: `http://127.0.0.1:${c}/sse`, approve: 'auto' });
  const rb = await t.refresh(sb.id).catch(e => ({ err: e.message }));
  const rc = await t.refresh(sc.id).catch(e => ({ err: e.message }));
  const sum = mcp.resultText(await mcp.callTool(svc.mcpServer(sb.id), 'add', { a: 2, b: 3 }));
  const echo = mcp.resultText(await mcp.callTool(svc.mcpServer(sc.id), 'echo', { s: 'hi' }));
  return { b: sb.id, c: sc.id, rb: { gen: rb.gen, v: rb.version, n: rb.tools?.length, err: rb.err },
    rc: { gen: rc.gen, n: rc.tools?.length, err: rc.err }, sum, echo };
}, [pB, pC]);
ok('Streamable HTTP：新一代探测被跨域拦下，退回握手，连上', other.rb.gen === 'http' && other.rb.v === '2025-06-18' && other.rb.n === 1, JSON.stringify(other.rb));
ok('握手之后每个请求都带着会话 id 与协议版本', seen.b.filter(x => x.method === 'tools/call').every(x => /^s\d/.test(x.sid) && x.pv === '2025-06-18')
  && other.sum === '5', JSON.stringify(seen.b.slice(-2)));
ok('旧版 SSE：POST 不认之后开事件流，回复从流里回来', other.rc.gen === 'sse' && other.rc.n === 1 && other.echo === 'echo:hi', JSON.stringify(other.rc) + other.echo);
sessions = new Set();
const again = await page.evaluate(async b => {
  const svc = await import('/src/system/ai/services.js');
  const mcp = await import('/src/system/mcp.js');
  try { return mcp.resultText(await mcp.callTool(svc.mcpServer(b), 'add', { a: 10, b: 1 })); } catch (e) { return 'ERR ' + e.message; }
}, other.b);
ok('会话过期（404）：自动重新握手再调一次', again === '11' && seen.b.filter(x => x.method === 'initialize').length === 2, again);

// ---- 三、角色卡上勾服务器 ----
await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/edit/${o.char}`); }, ids);
await page.waitForTimeout(900);
await page.locator('.list-item', { hasText: '天气' }).locator('.switch, input[type=checkbox]').first().tap();
await page.waitForTimeout(300);
const picked = await page.evaluate(async o => (await import('/src/system/db/index.js')).characters.get(o.char).mcpServers, ids);
ok('角色卡上勾了「天气」', JSON.stringify(picked) === JSON.stringify([srvId.id]), JSON.stringify(picked));

const sys = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.buildChatSystem(db.chats.get(o.chat), db.characters.get(o.char), [], {}).system;
}, ids);
ok('prompt 里有工具清单与写法，关掉的那个不在', /## Tools/.test(sys) && /\[调用：tool name/.test(sys) && /- weather: 查询天气/.test(sys)
  && /"days"/.test(sys) && /send_note/.test(sys) && !/secret/.test(sys) && !/add/.test(sys.split('## Tools')[1] || ''), (sys.split('## Tools')[1] || '').slice(0, 400));

// ---- 四、角色调用：只读的直接调，不是只读的等你允许 ----
await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(800);
await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(o.chat), char: db.characters.get(o.char), turnId: 't1', instant: true,
    raw: '我查一下\n[调用：weather {"city": "上海", "days": [1, 2]}]\n顺便记一笔\n【调用：send_note {\n  "text": "带伞]"\n}】\n[调用：nope {}]' });
}, ids);
await page.waitForTimeout(1200);
let tools = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.chat)
  .filter(m => m.kind === 'tool').map(m => ({ n: m.toolName, st: m.toolState, a: m.toolArgs, r: (m.toolResult || '').slice(0, 12), e: m.toolError })), ids);
ok('参数里有方括号、跨行也读得出来', tools.length === 3 && JSON.stringify(tools[0].a) === '{"city":"上海","days":[1,2]}'
  && tools[1].a.text === '带伞]', JSON.stringify(tools));
ok('只读的 weather：当场调，拿到结果', tools[0].st === 'done' && /^上海 晴 1\/2/.test(tools[0].r), JSON.stringify(tools[0]));
ok('不是只读的 send_note：停在等你允许，没发出去', tools[1].st === 'ask' && !seen.a.some(x => x.name === 'send_note'), JSON.stringify(tools[1]));
ok('没有这个工具：落一条失败，写明原因', tools[2].st === 'error' && /没有名为「nope」的工具/.test(tools[2].e), JSON.stringify(tools[2]));
txt = await page.locator('.conv-body').innerText();
ok('卡片：结果、等你允许、失败原因都看得见', /weather/.test(txt) && /上海 晴/.test(txt) && /等待你允许后执行/.test(txt) && /调用失败/.test(txt), txt.slice(0, 500));
await page.screenshot({ path: `${OUT}/mcp-chat.png` });
await page.locator('.tool-card', { hasText: 'send_note' }).locator('.btn', { hasText: '允许' }).tap();
await page.waitForTimeout(800);
tools = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.chat).filter(m => m.kind === 'tool').map(m => m.toolState), ids);
ok('点允许：发出去，拿到结果', tools[1] === 'done' && seen.a.some(x => x.name === 'send_note' && x.h === 'tools/call'), JSON.stringify(tools));

// ---- 五、结果进历史 ----
await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.set({ mcpResultChars: 10 }));
let h = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.buildHistory(db.chats.get(o.chat), db.characters.get(o.char), db.messagesOf(o.chat), {}).map(m => `${m.role}> ${m.content}`).join('\n');
}, ids);
ok('调用跟着结果进历史：调用在角色那一侧，结果在对方那一侧', /assistant> 我查一下\n\[调用：weather[^\n]*\]\nuser> /.test(h) && /user> \[工具结果：weather\]\n上海 晴 1\/2/.test(h), h.slice(0, 600));
ok('结果按设置的字数截断，并写明截断了', /\(truncated: first 10 of \d+ characters\)/.test(h), h.slice(0, 600));
ok('失败的那条：角色读到失败原因', /\[工具结果：nope\]\nThe call failed: 没有名为「nope」的工具/.test(h));

// ---- 六、结果回来后接着回复：默认关；开了之后按轮数停 ----
const pend = await page.evaluate(async o => (await import('/src/system/db/index.js')).chats.get(o.chat).pacePending, ids);
ok('默认：结果回来不自动接着回复，也没多调模型', !pend && modelCalls === 0, JSON.stringify(pend) + ' ' + modelCalls);
await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.set({ mcpFollowUp: true, mcpFollowMax: 1, mcpResultChars: 4000 }));
modelSays = '上海明天晴，出门不用带伞\n[调用：weather {"city": "北京"}]';
await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  db.messages.create({ chatId: o.chat, role: 'user', authorId: 'me', kind: 'text', content: '明天呢', status: 'done' });
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(o.chat), char: db.characters.get(o.char), turnId: 't2', instant: true,
    raw: '[调用：weather {"city": "上海"}]' });
}, ids);
await page.waitForTimeout(3500);
const after = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const list = db.messagesOf(o.chat);
  const i = list.findIndex(m => m.content === '明天呢');
  return { rest: list.slice(i + 1).map(m => m.kind === 'tool' ? `tool:${m.toolArgs.city}:${m.toolState}` : m.content),
    pend: db.chats.get(o.chat).pacePending };
}, ids);
ok('开了：结果回来后角色接着回复一次（模型多调一次）', modelCalls === 1 && after.rest.includes('上海明天晴，出门不用带伞'), JSON.stringify(after) + ' ' + modelCalls);
ok('接着回复里又调了一次工具：到了轮数上限，不再接着回复', after.rest.includes('tool:北京:done') && !after.pend && modelCalls === 1, JSON.stringify(after));

// ---- 七、拒绝 ----
await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.set({ mcpFollowUp: false }));
await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(o.chat), char: db.characters.get(o.char), turnId: 't3', instant: true,
    raw: '[调用：send_note {"text": "不要发"}]' });
}, ids);
await page.waitForTimeout(500);
await page.locator('.tool-card', { hasText: '不要发' }).locator('.btn', { hasText: '拒绝' }).tap();
await page.waitForTimeout(400);
h = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.buildHistory(db.chats.get(o.chat), db.characters.get(o.char), db.messagesOf(o.chat), {}).map(m => m.content).join('\n');
}, ids);
ok('点拒绝：不发出去，角色读到被拒绝', /\[工具结果：send_note\]\nThe user declined this call\./.test(h) && !seen.a.some(x => x.args?.text === '不要发'), h.slice(-200));
const row = await page.locator('.msg-row').count();
// 会话 app 已经开着时 openApp('chat', '/') 回到它原来那一页，所以一页页退回首页
await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  for (let i = 0; i < 6 && n.currentRoute() !== '/'; i++) n.pop();
});
await page.waitForTimeout(600);
txt = await page.locator('.msg-row', { hasText: '林晚' }).first().innerText();
ok('会话列表预览：[工具] 名字', /\[工具\] send_note/.test(txt), txt + row);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
[srvA, srvB, srvC].forEach(s => s.close());
stream?.end();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
