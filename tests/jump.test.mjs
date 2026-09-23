// 跨 app 那一跳：「与你」不再跳出去；「去那边改一下」的都回得来。
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
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const t = await import('/src/system/theirs.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文', healthOn: true });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  for (let i = 0; i < 8; i += 1) {
    db.messages.create({ chatId: chat.id, role: i % 2 ? 'assistant' : 'user',
      authorId: i % 2 ? a.id : me.id, kind: 'text',
      content: i % 2 ? `它说第 ${i} 句` : `我说第 ${i} 句`, status: 'done' });
  }
  t.open(a.id);
  return { a: a.id, chat: chat.id };
});
const where = () => page.evaluate(async () => {
  const { nav } = await import('/src/system/nav.js');
  const s = nav.get();
  return { app: s.appId, route: (s.stacks[s.appId] || []).slice(-1)[0], screen: s.screen };
});
const go = async (app, r) => {
  await page.evaluate(([x, y]) => import('/src/system/nav.js').then(n => n.openApp(x, y)), [app, r]);
  await page.waitForTimeout(700);
};
const txt = () => page.evaluate(() => document.body.innerText);
const back = async () => {
  await page.evaluate(() => import('/src/system/nav.js').then(n => n.pop()));
  await page.waitForTimeout(700);
};
const menu = async label => {
  await page.evaluate(() => document.querySelector('.nav-right button')?.click());
  await page.waitForTimeout(600);
  await page.evaluate(l => {
    const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith(l));
    if (!el) throw new Error('菜单里没有：' + l);
    el.click();
  }, label);
  await page.waitForTimeout(900);
};
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 角色手机里点「与你」：留在这台手机上 ----
await go('theirs', `/chats/${ids.a}`);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.includes('它说第 7 句'));
  (el || document.querySelector('.list-item')).click();
});
await page.waitForTimeout(800);
let at = await where();
check(at.app === 'theirs' && /^\/real\//.test(at.route),
  `点「与你」没有跳出角色手机（${JSON.stringify(at)}）`);
let body = await txt();
check(/我说第 0 句/.test(body) && /它说第 7 句/.test(body), '真实的那几句都在');
check(/以.*的身份写入这段对话/.test(body),
  '写明了在这儿发出去的那一句算谁发的');
const sides = await page.evaluate(() => [...document.querySelectorAll('.tp-line')]
  .map(e => (e.classList.contains('is-me') ? 'char' : 'you')));
check(sides[0] === 'you' && sides[1] === 'char',
  `这是它的手机，所以它说的在右边（${JSON.stringify(sides.slice(0, 2))}）`);
// 登着它的手机就该打得出字（见 send.mjs）。这里只确认输入框在
const inputs = await page.evaluate(() =>
  document.querySelectorAll('.page .composer textarea').length);
check(inputs === 1, `有一个输入框，登着它的手机能发消息（${inputs}）`);
await page.screenshot({ path: `${OUT}/tp-real.png` });

// 想去真的会话页仍然去得了，而且回得来
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.includes('在「聊天」中打开')).click());
await page.waitForTimeout(900);
at = await where();
check(at.app === 'chat', `按那个按钮才去「聊天」（${JSON.stringify(at)}）`);
await back();
at = await where();
check(at.app === 'theirs' && /^\/real\//.test(at.route),
  `从「聊天」退回来还在这台手机上（${JSON.stringify(at)}）`);

// 退出去仍然回得到会话列表
await back();
at = await where();
check(at.app === 'theirs' && at.route === `/chats/${ids.a}`,
  `再退一级回到这台手机的会话列表（${JSON.stringify(at)}）`);

// ---- 2 会话页右上角「每轮的接口调用」：过去看一眼，退回来还在原处 ----
await go('chat', `/chat/${ids.chat}`);
await menu('每轮的接口调用');
at = await where();
check(at.app === 'settings' && at.route === '/limits',
  `点了之后到了「用量与上限」（${JSON.stringify(at)}）`);
await back();
at = await where();
check(at.app === 'chat' && at.route === `/chat/${ids.chat}`,
  `退一下就回到刚才那段会话，不是落在设置首页、也不是回桌面（${JSON.stringify(at)}）`);

// ---- 3 去的那一页里再往下翻，退回来仍然一级一级走 ----
await go('chat', `/chat/${ids.chat}`);
await menu('每轮的接口调用');
await page.evaluate(() => import('/src/system/nav.js').then(n => n.push('/about')));
await page.waitForTimeout(500);
await back();
at = await where();
check(at.app === 'settings' && at.route === '/limits', '目标 app 里翻进去的那一级照常先退');
await back();
at = await where();
check(at.app === 'chat' && at.route === `/chat/${ids.chat}`, '再退才回出发地');

// ---- 4 中途回了桌面，就不再记得那条回头路 ----
await go('chat', `/chat/${ids.chat}`);
await menu('每轮的接口调用');
await page.evaluate(() => import('/src/system/nav.js').then(n => n.goHome()));
await page.waitForTimeout(500);
await go('settings', '/limits');
await back();
at = await where();
check(at.screen === 'home' || at.app === 'settings',
  `回过桌面之后那条回头路就作废了（${JSON.stringify(at)}）`);

// ---- 4b 在多任务里把那个 app 关掉，回头路也跟着作废 ----
await go('chat', `/chat/${ids.chat}`);
await menu('每轮的接口调用');
await page.evaluate(() => import('/src/system/nav.js').then(n => n.closeApp('settings')));
await page.waitForTimeout(500);
check(!await page.evaluate(async () =>
  !!(await import('/src/system/nav.js')).nav.get().returnTo),
  '把跳过去那个 app 关掉之后，回头路不再留着');

// ---- 5 真正的交接不带回头路：从资料页「去聊天」，去了就待在那儿 ----
await go('contact', `/char/${ids.a}`);
const hasReturn = await page.evaluate(async () => {
  const { nav } = await import('/src/system/nav.js');
  return !!nav.get().returnTo;
});
check(!hasReturn, '没有那一跳时不留回头路');

// ---- 6 角色手机里「前往「健康」设定」：改完回得来 ----
await go('theirs', `/body/${ids.a}`);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.includes('前往「健康」设定'));
  el.click();
});
await page.waitForTimeout(800);
at = await where();
check(at.app === 'health', `跳到了健康（${JSON.stringify(at)}）`);
await back();
at = await where();
check(at.app === 'theirs' && at.route === `/body/${ids.a}`,
  `改完退回来还在这台手机的身体状态页（${JSON.stringify(at)}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
