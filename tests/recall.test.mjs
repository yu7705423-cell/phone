// 撤回与删除（system/recall.js，ARCHITECTURE 4.207）。
//
//   消息  我长按撤回自己那一条；角色在回复里写一行 [撤回]。两边都折成一行「某某撤回了一条消息」，
//         点一下展开原文。进上下文：我撤回的换成 [撤回了一条消息]（角色回过话的带原文），
//         角色撤回的原文照进、末尾补 [撤回]
//   动态  角色的动态可以手动删；角色在聊天里写 [撤回动态]、或回我评论时交回 recall:true，
//         它最近一条动态就折起来，点开仍看得到原文
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
let reply = '好';
await page.route('https://relay.example.com/**', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ choices: [{ message: { content: reply } }] }) }));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  svc.setActiveChat(svc.newChatPreset({ name: '中转', provider: 'openai', baseUrl: 'https://relay.example.com/v1', apiKey: 'sk', model: 'm' }).id);
  db.settings.set({ streamMode: 'once', retryMax: 0 });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const t = Date.now() - 60000;
  const a = db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '第一句说错了', status: 'done', createdAt: t });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: '嗯？', status: 'done', createdAt: t + 1000 });
  const b = db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '这句还没被回', status: 'done', createdAt: t + 2000 });
  return { char: c.id, chat: chat.id, a: a.id, b: b.id };
});
const go = async (app, route) => {
  await page.evaluate(async ([a, r]) => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp(a, r); }, [app, route]);
  await page.waitForTimeout(700);
};
const hist = () => page.evaluate(async ({ chat, char }) => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.buildHistory(db.chats.get(chat), db.characters.get(char), db.messagesOf(chat)).map(m => `${m.role}|${m.content}`).join('\n');
}, ids);
const msgOf = id => page.evaluate(async i => (await import('/src/system/db/index.js')).db.messages.get(i), id);
const hold = async loc => {
  await loc.dispatchEvent('contextmenu');
  await page.waitForTimeout(400);
};

// ---- 我撤回 ----
await go('chat', `/chat/${ids.chat}`);
await hold(page.locator('.msg', { hasText: '第一句说错了' }).locator('.bubble'));
ok('自己那一条的长按菜单里有「撤回」', await page.locator('.sheet .list-item', { hasText: '撤回' }).count() === 1);
await page.locator('.sheet .list-item', { hasText: '撤回' }).click();
await page.waitForTimeout(400);
await hold(page.locator('.msg', { hasText: '这句还没被回' }).locator('.bubble'));
await page.locator('.sheet .list-item', { hasText: '撤回' }).click();
await page.waitForTimeout(400);
let a = await msgOf(ids.a);
ok('撤回记在这一条上，不是删掉', a && a.recalled?.by === 'user' && a.content === '第一句说错了', JSON.stringify(a?.recalled));
ok('角色回过话的：记下角色已读到', a.recalled.seen === true);
ok('角色没回过的：记为没读到', (await msgOf(ids.b)).recalled.seen === false);
let t = await page.locator('.conv-body').innerText();
ok('会话里折成「你撤回了一条消息」', (t.match(/你撤回了一条消息/g) || []).length === 2 && !/第一句说错了/.test(t), t);
await page.locator('#msg-' + ids.a + ' .recall-line').click();
await page.waitForTimeout(300);
t = await page.locator('.conv-body').innerText();
ok('点一下展开原文', /第一句说错了/.test(t) && !/这句还没被回/.test(t), t);
ok('角色那边的菜单里没有「撤回」', await (async () => {
  await hold(page.locator('.msg', { hasText: '嗯？' }).locator('.bubble'));
  const n = await page.locator('.sheet .list-item', { hasText: '撤回' }).count();
  await page.evaluate(async () => (await import('/src/ui/overlay.js')).closeTopOverlay());
  await page.waitForTimeout(300);
  return n === 0;
})());
let h = await hist();
ok('进上下文：角色读到过的，带原文', /\[撤回了一条消息：第一句说错了\]/.test(h), h);
ok('进上下文：角色没读到的，只有一行标记', /user\|\[撤回了一条消息\]$/m.test(h) && !/这句还没被回/.test(h), h);

// ---- 角色撤回 ----
reply = '好想你\n[撤回]\n刚才手滑了';
await page.evaluate(async ({ chat, char, raw }) => {
  const { db } = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId: 'rt1', instant: true });
}, { ...ids, raw: reply });
await page.waitForTimeout(600);
t = await page.locator('.conv-body').innerText();
ok('角色那一条先照常显示', /好想你/.test(t), t.slice(-200));
ok('标记那一行不成为气泡', !/\[撤回\]/.test(t));
await page.waitForTimeout(2800);
t = await page.locator('.conv-body').innerText();
ok('几秒后折成「阿岚撤回了一条消息」', /阿岚撤回了一条消息/.test(t) && !/好想你/.test(t) && /刚才手滑了/.test(t), t.slice(-200));
h = await hist();
ok('进上下文：角色撤回的原文照进，末尾补 [撤回]', /好想你\n\[撤回\]/.test(h), h.slice(-300));
await go('chat', '/');
ok('会话列表预览照常（最后一条没撤回）', /刚才手滑了/.test(await page.locator('.app-layer').innerText()));

// 能力说明里有 [撤回]；角色卡关掉就不给
let sys = await page.evaluate(async ({ chat, char }) => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.buildChatSystem(db.chats.get(chat), db.characters.get(char), db.messagesOf(chat)).system;
}, ids);
ok('能力说明写了 [撤回] 的写法', /\[撤回\]/.test(sys));
await page.evaluate(async id => (await import('/src/system/db/index.js')).db.characters.update(id, { canRecall: false }), ids.char);
reply = '这句也收回\n[撤回]';
await page.evaluate(async ({ chat, char, raw }) => {
  const { db } = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId: 'rt2', instant: true });
}, { ...ids, raw: reply });
await page.waitForTimeout(300);
ok('角色卡关掉「撤回」：写了也不撤', await page.evaluate(async id => {
  const { db } = await import('/src/system/db/index.js');
  return !db.messagesOf(id).find(m => m.content === '这句也收回').recalled;
}, ids.chat));
await page.evaluate(async id => (await import('/src/system/db/index.js')).db.characters.update(id, { canRecall: true }), ids.char);

// ---- 动态 ----
const mo = await page.evaluate(async char => {
  const { db } = await import('/src/system/db/index.js');
  const a = db.moments.create({ authorId: char, text: '今天好累', images: [], likes: [], comments: [], createdAt: Date.now() - 5000 });
  const b = db.moments.create({ authorId: char, text: '要删的那条', images: [], likes: [], comments: [], createdAt: Date.now() - 9000 });
  return { a: a.id, b: b.id };
}, ids.char);
await go('chat', '/moments');
const card = page.locator('.mo-card', { hasText: '要删的那条' });
ok('角色的动态也有删除按钮', await card.locator('[aria-label="删除"]').count() === 1);
await card.locator('[aria-label="删除"]').click();
await page.waitForTimeout(300);
await page.locator('.modal button', { hasText: '删除' }).click();
await page.waitForTimeout(400);
ok('确认之后删掉', await page.evaluate(async id => !(await import('/src/system/db/index.js')).db.moments.get(id), mo.b));

sys = await page.evaluate(async ({ chat, char }) => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.buildChatSystem(db.chats.get(chat), db.characters.get(char), db.messagesOf(chat)).system;
}, ids);
ok('能力说明里带着它最近一条动态，和 [撤回动态] 的写法', /\[撤回动态\]/.test(sys) && /今天好累/.test(sys), sys.slice(-600));

reply = '算了\n[撤回动态]';
await page.evaluate(async ({ chat, char, raw }) => {
  const { db } = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId: 'rt3', instant: true });
}, { ...ids, raw: reply });
await page.waitForTimeout(500);
ok('聊天里写 [撤回动态]：最近一条动态撤回', await page.evaluate(async id => !!(await import('/src/system/db/index.js')).db.moments.get(id).recalled, mo.a));
await go('chat', '/moments');
t = await page.locator('.moments').innerText();
ok('朋友圈里折成「阿岚撤回了一条动态」，原文收着', /阿岚撤回了一条动态/.test(t) && !/今天好累/.test(t), t.slice(0, 300));
await page.locator('.mo-recalled-line').first().click();
await page.waitForTimeout(300);
t = await page.locator('.moments').innerText();
ok('点开看得到原文', /今天好累/.test(t));
ok('点开之后不收赞、不收评论，只剩删除', await page.locator('.mo-recalled .mo-act').count() === 1);

// 回评论时交回 recall:true
const mo2 = await page.evaluate(async char => {
  const { db } = await import('/src/system/db/index.js');
  return db.moments.create({ authorId: char, text: '新发的一条', images: [], likes: [], comments: [], createdAt: Date.now() }).id;
}, ids.char);
reply = JSON.stringify({ text: '你怎么这么说', recall: true });
await page.evaluate(async id => {
  const ai = await import('/src/system/ai/tasks/moments.js');
  const { db } = await import('/src/system/db/index.js');
  await ai.replyComment(id, db.moments.get(id).authorId, '这条好丑');
}, mo2);
ok('回评论时交回 recall:true：这条动态撤回', await page.evaluate(async id => !!(await import('/src/system/db/index.js')).db.moments.get(id).recalled, mo2));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
