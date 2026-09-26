// 本体与小号互通（ARCHITECTURE 4.259）
//
// 用户问：角色开了小号之后，本体知道小号那边聊了什么吗？从前不知道：记忆按角色 id 各算各的，
// 本体只在开新号那一刻看一眼小号那边。现在本体上的「本体与小号互通」默认开：
//   一、记忆互通：小号那边记下的事，本体的记忆列表里也有；反过来也是
//   二、上下文里多一块「你的其他账号」：本体看到小号那边最近几条，小号看到本体那边最近几条；
//       关掉开关整块没有、记忆也不通；条数填 0 只通记忆不带对话
//   三、真发一次请求：本体的系统提示里带着小号那边刚说的话
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  if (body.stream) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: '嗯' } }] })}\n\ndata: [DONE]\n\n` });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '嗯' } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '甲', provider: 'openai' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm1' });
  svc.setActiveChat(p.id);
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const root = db.characters.create({ name: '林晓', charAlt: true });
  const alt = db.characters.create({ name: '晚风', parentId: root.id, altReason: '想换个身份认识你', altOpenedAt: Date.now() });
  const rc = db.chats.create({ characterIds: [root.id], personaId: me.id, lastMessageAt: Date.now() });
  const ac = db.chats.create({ characterIds: [alt.id], personaId: me.id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: rc.id, role: 'user', authorId: 'me', kind: 'text', content: '今天加班', status: 'done' });
  db.messages.create({ chatId: rc.id, role: 'char', authorId: root.id, kind: 'text', content: '早点休息', status: 'done' });
  db.messages.create({ chatId: ac.id, role: 'user', authorId: 'me', kind: 'text', content: '你也喜欢看雨吗', status: 'done' });
  db.messages.create({ chatId: ac.id, role: 'char', authorId: alt.id, kind: 'text', content: '小号这边说的悄悄话', status: 'done' });
  db.memories.create({ charId: alt.id, personaId: me.id, content: '对方喜欢下雨天出门散步', category: 'fact', rank: 'A', keywords: ['雨'] });
  db.memories.create({ charId: root.id, personaId: me.id, content: '对方最近在加班', category: 'fact', rank: 'A', keywords: ['加班'] });
  return { root: root.id, alt: alt.id, rc: rc.id, ac: ac.id, me: me.id };
});

const mems = (charId) => ev(async ({ charId, me }) => (await import('/src/system/ai/context/memory.js')).listFor(charId, me).map(m => m.content), { charId, me: ids.me });
// 一
ok('一、默认开：本体的记忆里有小号那边记下的事', (await mems(ids.root)).includes('对方喜欢下雨天出门散步'), JSON.stringify(await mems(ids.root)));
ok('一、默认开：小号的记忆里有本体那边记下的事', (await mems(ids.alt)).includes('对方最近在加班'), JSON.stringify(await mems(ids.alt)));

// 二
const block = (charId, chatId) => ev(async ({ charId, chatId, me }) => {
  const { db } = await import('/src/system/db/index.js');
  const alts = await import('/src/system/ai/context/alts.js');
  return alts.build({ char: db.characters.get(charId), chat: db.chats.get(chatId), persona: db.personas.get(me), settings: db.settings.get(), messages: [] });
}, { charId, chatId, me: ids.me });
let b = await block(ids.root, ids.rc);
ok('二、本体的区块：列出小号、开号原因、那边最近说的话', /\[你的其他账号\]/.test(b) && /晚风/.test(b) && /想换个身份认识你/.test(b) && /小号这边说的悄悄话/.test(b), b);
b = await block(ids.alt, ids.ac);
ok('二、小号的区块：说明这是自己开的号，带本体那边最近的话', /林晓 \(your main account\)/.test(b) && /早点休息/.test(b) && /想换个身份认识你/.test(b), b);
await ev(async id => { const { db } = await import('/src/system/db/index.js'); db.characters.update(id, { altShareLines: 0 }); }, ids.root);
b = await block(ids.root, ids.rc);
ok('二、条数填 0：只列账号，不带对话', /晚风/.test(b) && !/小号这边说的悄悄话/.test(b) && !/nothing said/.test(b), b);
await ev(async id => { const { db } = await import('/src/system/db/index.js'); db.characters.update(id, { altShare: false, altShareLines: 8 }); }, ids.root);
b = await block(ids.root, ids.rc);
ok('二、关掉互通：整块没有', b === '', b);
ok('二、关掉互通：记忆也各算各的', !(await mems(ids.root)).includes('对方喜欢下雨天出门散步') && !(await mems(ids.alt)).includes('对方最近在加班'));
await ev(async id => { const { db } = await import('/src/system/db/index.js'); db.characters.update(id, { altShare: true }); }, ids.root);

// 三
await ev(async id => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${id}`); }, ids.rc);
await page.waitForTimeout(1200);
// 会话页把「让角色接着说」登记在 quickball.chatStore 上（悬浮球用的那一份），直接调它：正好一次请求，不等连发收紧的延时
await ev(async id => {
  const { db } = await import('/src/system/db/index.js');
  db.messages.create({ chatId: id, role: 'user', authorId: 'me', kind: 'text', content: '在吗', status: 'done' });
  (await import('/src/system/quickball.js')).chatStore.get().api.generate();
}, ids.rc);
await page.waitForTimeout(2500);
const sys = reqs.length ? JSON.stringify(reqs[reqs.length - 1].messages || reqs[reqs.length - 1]) : '';
const dbg = await ev(async id => { const { db } = await import('/src/system/db/index.js'); return { last: db.messagesOf(id).slice(-2).map(m => [m.role, m.kind, m.status, String(m.content).slice(0, 40)]), toasts: [...document.querySelectorAll('.toast')].map(t => t.innerText), route: location.hash, send: document.querySelector('.ph-send')?.className }; }, ids.rc);
ok('三、真发一次请求：本体的提示里带着小号那边刚说的话', reqs.length === 1 && /你的其他账号/.test(sys) && /小号这边说的悄悄话/.test(sys), `${reqs.length} ${JSON.stringify(dbg)} ${sys.slice(0, 200)}`);

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
