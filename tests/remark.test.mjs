// 互相改备注（system/remark.js，ARCHITECTURE 4.200）。
//
//   我给角色改：会话菜单里「备注」。会话列表、会话标题、联系人列表显示备注；角色知道我给它设了什么
//   角色给我改：回复里写一行 [备注：…]。会话里落一行提示；查它手机时「与你」那一栏显示这个名字
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
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '在吗', status: 'done' });
  return { char: c.id, chat: chat.id };
});
const go = async (app, route) => {
  await page.evaluate(async ([a, r]) => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp(a, r); }, [app, route]);
  await page.waitForTimeout(700);
};
const text = () => page.locator('.app-layer').innerText();
const sysOf = () => page.evaluate(async ({ chat, char }) => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  const r = engine.buildChatSystem(db.chats.get(chat), db.characters.get(char), db.messagesOf(chat));
  return r.system + '\n' + (r.volatile || '');
}, ids);

// 角色回一轮：把 reply 那段原文照真实回复的路子拆开落库
let turnNo = 0;
const turn = () => page.evaluate(async ({ chat, char, raw, t }) => {
  const { db } = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId: 'rt' + t, instant: true });
}, { ...ids, raw: reply, t: ++turnNo });

// ---- 我给角色改 ----
await go('chat', `/chat/${ids.chat}`);
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(400);
await page.locator('.fullsheet .list-item', { hasText: '备注' }).first().click();
await page.waitForTimeout(300);
await page.locator('.modal input, .modal textarea').first().fill('小岚');
await page.locator('.modal button', { hasText: '保存' }).click();
await page.waitForTimeout(400);
ok('会话菜单里改备注：存在角色上', await page.evaluate(async id => (await import('/src/system/db/index.js')).db.characters.get(id).remark, ids.char) === '小岚');
await page.locator('.fullsheet .navbar button').first().click().catch(() => {});
await page.evaluate(async () => (await import('/src/ui/overlay.js')).closeTopOverlay());
await page.waitForTimeout(300);
ok('会话标题显示备注', /小岚/.test(await page.locator('.app-layer > .page > .navbar .nav-title').innerText()));
await go('chat', '/');
ok('会话列表显示备注', /小岚/.test(await text()) && !/阿岚/.test(await text()), (await text()).slice(0, 200));
let sys = await sysOf();
ok('角色知道你给它设的备注', /saved as: 小岚/.test(sys), sys.slice(-800));
ok('prompt 里角色仍用本名', /阿岚/.test(sys));

// ---- 角色给我改 ----
reply = '在呢\n[备注：小笨蛋]';
await turn();
await page.waitForTimeout(600);
const st = await page.evaluate(async id => {
  const { db } = await import('/src/system/db/index.js');
  return { remark: db.chats.get(id).charRemark, msgs: db.messagesOf(id).map(m => `${m.kind}:${m.content}`) };
}, ids.chat);
ok('角色写 [备注：…]：存在这段会话上', st.remark === '小笨蛋', JSON.stringify(st));
ok('会话里落一行提示', st.msgs.includes('notice:[阿岚将你的备注改为「小笨蛋」]'), JSON.stringify(st.msgs));
ok('标记这一行本身不成为气泡', !st.msgs.some(m => /\[备注：/.test(m)), JSON.stringify(st.msgs));
sys = await sysOf();
ok('之后角色看得见自己给你起的备注', /Currently: 小笨蛋|saved as: 小笨蛋/.test(sys));

// 同一个名字再写一遍：不重复落提示
await turn();
await page.waitForTimeout(600);
const n = await page.evaluate(async id => (await import('/src/system/db/index.js')).db.messagesOf(id).filter(m => m.remark).length, ids.chat);
ok('名字没变：不重复落提示', n === 1, n);

// 查手机（先把那台手机的锁屏解开：这里查的不是锁屏）
await page.evaluate(async id => (await import('/src/system/theirs.js')).open(id), ids.char);
await go('theirs', `/chats/${ids.char}`);
ok('查角色手机：「与你」那一栏显示角色给你的备注', /小笨蛋/.test(await text()), (await text()).slice(0, 200));
await go('theirs', `/real/${ids.char}/${ids.chat}`);
ok('点进去：标题也是这个备注', /小笨蛋/.test(await page.locator('.app-layer > .page > .navbar .nav-title').innerText()));

// 角色卡里关掉：能力不给、写了也不生效
await page.evaluate(async id => (await import('/src/system/db/index.js')).db.characters.update(id, { canRemark: false }), ids.char);
sys = await sysOf();
ok('关掉之后：prompt 里不再有改备注的写法', !/\[备注：/.test(sys));
reply = '嗯\n[备注：大笨蛋]';
await turn();
await page.waitForTimeout(600);
ok('关掉之后：写了也不改', await page.evaluate(async id => (await import('/src/system/db/index.js')).db.chats.get(id).charRemark, ids.chat) === '小笨蛋');

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
