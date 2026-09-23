// 登着它的手机打字：头像站对边、发给你、发给别人、发给还没聊过的人。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

// 模型在网络那一层假掉。回话一次一条请求，数得出来
let calls = [];
await page.route('**/v1/messages', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  calls.push(String(body.system || ''));
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text',
      text: JSON.stringify({ lines: [{ text: '对面回的第一句' }, { text: '对面回的第二句' }] }) }] }) });
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const card = await import('/src/system/ai/tasks/card.js');
  const t = await import('/src/system/theirs.js');
  svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文' });
  const mom = db.characters.create({ name: '妈妈', persona: '母亲', isNpc: true });
  const lin = db.characters.create({ name: '小林', persona: '同学', isNpc: true });
  card.link(mom.id, a.id, '女儿', '母亲');
  card.link(lin.id, a.id, '同学', '同学');
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: me.id, kind: 'text',
    content: '我说的一句', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'assistant', authorId: a.id, kind: 'text',
    content: '它说的一句', status: 'done' });
  // 一条已经有正文的生成会话
  const pc = t.addChat(a.id, { npcId: mom.id, name: '妈妈', preview: '早点睡' });
  t.fillChat(pc.id, [{ from: 'other', text: '早点睡' }]);
  t.open(a.id);
  return { a: a.id, chat: chat.id, pc: pc.id, mom: mom.id, me: me.id };
});

const go = async r => {
  await page.evaluate(([x]) => import('/src/system/nav.js').then(n => n.openApp('theirs', x)), [r]);
  await page.waitForTimeout(800);
};
const txt = () => page.evaluate(() => document.body.innerText);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
// 每一行里，头像和气泡谁在左边（按画出来的坐标算，不按 DOM 顺序）
const sides = () => page.evaluate(() => [...document.querySelectorAll('.tp-line')].map(el => {
  const av = el.querySelector('.avatar');
  const bu = el.querySelector('.tp-bubble');
  if (!av || !bu) return '?';
  return `${el.classList.contains('is-me') ? 'me' : 'you'}:${
    av.getBoundingClientRect().left < bu.getBoundingClientRect().left ? '头像在左' : '头像在右'}`;
}));
const type = async (t) => {
  await page.evaluate(v => {
    const el = document.querySelector('.composer textarea');
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('.composer .send-btn').click());
  await page.waitForTimeout(1300);
};

// ---- 1 与你那一段：头像各站各边 ----
await go(`/real/${ids.a}/${ids.chat}`);
let s = await sides();
check(JSON.stringify(s) === JSON.stringify(['you:头像在左', 'me:头像在右']),
  `你说的头像在左、它说的头像在右（${JSON.stringify(s)}）`);
await page.screenshot({ path: `${OUT}/tp-real.png` });

// ---- 2 在它手机上给你发一句：以它的身份，不调接口 ----
calls = [];
await type('这是我登他手机发的');
let body = await txt();
check(/这是我登他手机发的/.test(body), '发出去的那一句出现在这一段里');
check(calls.length === 0, `这一下不调接口（${calls.length} 次）`);
const stored = await page.evaluate(async ([c]) => {
  const db = await import('/src/system/db/index.js');
  const m = db.messagesOf(c).slice(-1)[0];
  return { role: m.role, author: m.authorId, text: m.content };
}, [ids.chat]);
check(stored.role === 'assistant' && stored.author === ids.a
  && stored.text === '这是我登他手机发的',
  `落进真的那段对话里，而且是它发的（${JSON.stringify(stored)}）`);
s = await sides();
check(s.slice(-1)[0] === 'me:头像在右', '新发的那一句也在右边');

// 「聊天」那边看得见
await page.evaluate(([c]) => import('/src/system/nav.js').then(n => n.openApp('chat', `/chat/${c}`)), [ids.chat]);
await page.waitForTimeout(900);
check(/这是我登他手机发的/.test(await txt()), '「聊天」那边看见的就是角色发来的一条新消息');

// ---- 3 给别人发：一次发送一次请求，对面回话 ----
calls = [];
await go(`/chat/${ids.pc}`);
s = await sides();
check(s[0] === 'you:头像在左', '生成出来那一段里，对方的头像也在左边');
await type('妈我到家了');
body = await txt();
check(/妈我到家了/.test(body), '发出去的那一句在');
check(/对面回的第一句/.test(body) && /对面回的第二句/.test(body), '对面回话了');
check(calls.length === 1, `一次发送只发一次请求（${calls.length} 次）`);
check(/Who 妈妈 is/.test(calls[0]) && /妈我到家了/.test(calls[0]),
  '请求里带上了对方的设定与刚说的那一句');
const rows = await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).chat(id).lines.map(l => `${l.from}:${l.text}`), [ids.pc]);
check(JSON.stringify(rows) === JSON.stringify(
  ['other:早点睡', 'char:妈我到家了', 'other:对面回的第一句', 'other:对面回的第二句']),
  `接在后面，不是把这一段换掉（${JSON.stringify(rows)}）`);
s = await sides();
check(s[1] === 'me:头像在右', '它发的那一句头像在右');
await page.screenshot({ path: `${OUT}/tp-send.png` });

// 列表上那条最后一句跟着变
await go(`/chats/${ids.a}`);
check(/对面回的第二句/.test(await txt()), '会话列表上那条最后一句跟着更新了');

// ---- 4 给还没聊过的人发消息 ----
await page.evaluate(() => [...document.querySelectorAll('.nav-text')]
  .find(b => b.innerText.trim() === '发消息').click());
await page.waitForTimeout(600);
body = await txt();
check(/该角色认识的人/.test(body) && /小林/.test(body), '名单里列出了它认识、但还没聊过的人');
check(!/妈妈/.test(body.split('该角色认识的人')[1] || ''), '已经聊过的那个不再列一遍');
calls = [];
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.sheet .list-item')].find(e => e.innerText.includes('小林'));
  el.click();
});
await page.waitForTimeout(900);
body = await txt();
check(/小林/.test(body) && !/正在生成这一段对话/.test(body),
  '起出来的是一条空会话，不自动生成一整段');
check(calls.length === 0, `起一条会话不调接口（${calls.length} 次）`);
await type('在吗');
body = await txt();
check(/在吗/.test(body) && /对面回的第一句/.test(body), '第一句发出去，对面回了');
check(calls.length === 1, `还是一次发送一次请求（${calls.length} 次）`);

// ---- 5 重名的起不了第二条 ----
await go(`/chats/${ids.a}`);
const dup = await page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  try { t.startChat(id, { name: '小林' }); return 'ok'; }
  catch (e) { return String(e.message); }
}, [ids.a]);
check(/已经有这个人/.test(dup), `重名起不了第二条（${dup}）`);

// ---- 6 「重新生成」会整段换掉，问一声再动手 ----
await go(`/chat/${ids.pc}`);
await page.evaluate(() => [...document.querySelectorAll('.nav-text')]
  .find(b => b.innerText.trim() === '重新生成').click());
await page.waitForTimeout(600);
check(/自行发送的消息也会一并删除/.test(await txt()), '先说清楚自己打的那几句会一起没');
await page.evaluate(() => [...document.querySelectorAll('.overlay button')]
  .find(b => b.innerText.trim() === '取消')?.click());
await page.waitForTimeout(400);
check((await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).chat(id).lines.length, [ids.pc])) === 4,
  '按取消就什么也没动');

console.log(ok.map(x => '  ok   ' + x).join('\n'));
if (fail.length) console.log(fail.map(x => '  FAIL ' + x).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
