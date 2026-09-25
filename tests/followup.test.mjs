// 角色说完、我没再开口时按「让对方回复」，以及主动发起（engine.withFollowUp、proactive.js）。
//
//   从前请求以角色自己那几句收尾，前面最近的 user 还是上一轮那句，模型就把上一轮换个说法
//   再说一遍。现在末尾补一行「对方还没回，这次写的排在那几句后面」。
//   主动发起从前一条聊天记录都不带，角色不知道聊到哪儿、也不记得自己上次发过什么。
//   现在带着记录发，仍然只调一次
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const reqs = [];
let reply = '好';
await page.route('https://relay.example.com/**', r => {
  try { reqs.push(r.request().postDataJSON()); } catch { reqs.push(null); }
  return r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  svc.setActiveChat(svc.newChatPreset({ name: '中转', provider: 'openai', baseUrl: 'https://relay.example.com/v1', apiKey: 'sk', model: 'm' }).id);
  db.settings.set({ streamMode: 'once', retryMax: 0 });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
});
const lastOf = body => (body?.messages || []).filter(m => m.role !== 'system').slice(-1)[0] || {};
const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
const all = body => (body?.messages || []).map(textOf).join('\n');

await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${id}`); }, ids.chat);
await page.waitForTimeout(800);

// ---- 我说一句，角色回 ----
await page.locator('.composer-input').fill('今天好热');
reply = '是啊\n\n开空调了吗';
await page.locator('[aria-label="发送"]').click();
await page.waitForTimeout(400);
if (!reqs.length) { await page.locator('[aria-label="让对方回复"]').click(); }
await page.waitForTimeout(1500);
let body = reqs[reqs.length - 1];
ok('我刚说完：最后一条就是我那句，不补说明', /今天好热/.test(textOf(lastOf(body))) && !/No new message from the other party/.test(all(body)),
  JSON.stringify(lastOf(body)).slice(0, 200));

// ---- 角色说完，我没开口，再按一次 ----
reply = '怎么不说话';
const n0 = reqs.length;
await page.locator('[aria-label="让对方回复"]').click();
await page.waitForTimeout(1500);
body = reqs[n0];
ok('又按了一次回复：发出去了一次', reqs.length === n0 + 1, reqs.length - n0);
ok('请求里带着角色上一轮说的话', /开空调了吗/.test(all(body)), all(body).slice(-400));
ok('末尾补了「对方还没回」', lastOf(body).role === 'user' && /No new message from the other party/.test(textOf(lastOf(body))),
  JSON.stringify(lastOf(body)).slice(0, 300));
let st = await page.evaluate(async id => (await import('/src/system/db/index.js')).db.messagesOf(id).map(m => m.content), ids.chat);
ok('上一轮的话还在，新的接在后面', st.join('|') === '今天好热|是啊|开空调了吗|怎么不说话', st.join('|'));

// ---- 主动发起 ----
reply = '在忙吗';
const n1 = reqs.length;
await page.evaluate(async ({ chat, char }) => (await import('/src/system/ai/proactive.js')).sendProactive(chat, char), ids);
await page.waitForTimeout(600);
body = reqs[n1];
ok('主动发起：一次调用', reqs.length === n1 + 1, reqs.length - n1);
ok('主动发起：带着聊天记录（我说的、它说的）', /今天好热/.test(all(body)) && /怎么不说话/.test(all(body)), all(body).slice(-400));
ok('主动发起：末尾是「这次由你开口」', /You are the one opening this time/.test(textOf(lastOf(body))), textOf(lastOf(body)));
reply = '还在吗';
const n2 = reqs.length;
await page.evaluate(async ({ chat, char }) => (await import('/src/system/ai/proactive.js')).sendProactive(chat, char), ids);
await page.waitForTimeout(600);
ok('再主动一次：记得上次主动发过什么', /在忙吗/.test(all(reqs[n2])), all(reqs[n2]).slice(-300));

// ---- 群里 ----
const g = await page.evaluate(async ({ char }) => {
  const { db } = await import('/src/system/db/index.js');
  const grp = await import('/src/system/group.js');
  const b = db.characters.create({ name: '小林' });
  const chat = grp.create({ ids: [char, b.id], title: '小组' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '出来吃饭', status: 'done', createdAt: Date.now() - 5000 });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: char, kind: 'text', content: '好呀', status: 'done', createdAt: Date.now() - 4000 });
  return chat.id;
}, ids);
reply = '阿岚：几点\n小林：我也去';
const n3 = reqs.length;
await page.evaluate(async id => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  await e.streamGroupReply({ chat: db.chats.get(id) });
}, g);
ok('群里成员说完、我没开口：同样补一行', /No new message from the other party/.test(textOf(lastOf(reqs[n3]))), textOf(lastOf(reqs[n3])));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
