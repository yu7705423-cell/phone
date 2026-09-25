// 翻译：模型真会写出来的那几种走样，都要认得出来；以及点通知那一下不能丢
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
let reply = null;
await page.route('**/v1/messages', route => route.fulfill({ status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] }) }));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 一行译文挂到哪一条上 ----
const shapes = {
  '照模板写的': ['今天好累\n[译文：I am tired]\n出去走走\n[译文：Go for a walk]',
    [['今天好累', 'I am tired'], ['出去走走', 'Go for a walk']]],
  '方括号掉了': ['今天好累\n译文：I am tired', [['今天好累', 'I am tired']]],
  '半角冒号': ['今天好累\n[译文: I am tired]', [['今天好累', 'I am tired']]],
  '译文里本来就有冒号': ['他说\n[译文：He said: come]', [['他说', 'He said: come']]],
  '译文里带方括号': ['看这个\n[译文：Look at [this]]', [['看这个', 'Look at [this]']]],
  // 下面这几种是真实会掉翻译、或者把译文当成一条消息发出去的
  '先写完正文，译文一起补在后面': ['今天好累\n出去走走\n[译文：I am tired]\n[译文：Go for a walk]',
    [['今天好累', 'I am tired'], ['出去走走', 'Go for a walk']]],
  '译文写在原文上面': ['[译文：I am tired]\n今天好累', [['今天好累', 'I am tired']]],
  '括号落在下一行': ['今天好累\n[译文：I am so\ntired]', [['今天好累', 'I am so tired']]],
  '标签单独一行': ['今天好累\n[译文]\nI am tired', [['今天好累', 'I am tired']]],
  '自己加了序号': ['今天好累\n1. [译文：I am tired]', [['今天好累', 'I am tired']]],
  '英文标签': ['今天好累\n[translation: I am tired]', [['今天好累', 'I am tired']]],
  '译文那一行是空的': ['今天好累\n[译文：]', [['今天好累', '']]],
  '时间戳在最前面': ['[时间：2026-09-20 周日 16:00]\n今天好累\n[译文：I am tired]',
    [['今天好累', 'I am tired']]],
};
const got = await page.evaluate(async cs => {
  const r = await import('/src/system/ai/reply.js');
  const out = {};
  for (const [k, [raw]] of Object.entries(cs)) {
    out[k] = r.splitReply(raw).filter(p => p.type === 'text')
      .map(p => [p.text, p.translation || '']);
  }
  return out;
}, shapes);
for (const [k, [, want]] of Object.entries(shapes)) {
  check(JSON.stringify(got[k]) === JSON.stringify(want), `${k}：${JSON.stringify(got[k])}`);
}

// 「翻译」这两个字单独成行是角色说的话，不是标记
const said = await page.evaluate(async () => {
  const r = await import('/src/system/ai/reply.js');
  return r.splitReply('翻译\n下一句').map(p => p.text);
});
check(JSON.stringify(said) === '["翻译","下一句"]',
  `没有冒号也没有方括号的「翻译」当正文（${JSON.stringify(said)}）`);

// ---- 2 单独那套翻译接口：模型换个形状回来也要收得住 ----
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  svc.setTranslate({ mode: 'api', provider: 'anthropic', apiKey: 'k', model: 'm' });
});
check(await page.evaluate(async () =>
  (await import('/src/system/ai/translate.js')).ready()), '选了 api 又填全了就走单独那套接口');

const runOnce = async shape => {
  reply = shape;
  return page.evaluate(async () =>
    (await import('/src/system/ai/translate.js')).run(['a', 'b'], { lang: 'English' }));
};
const shapesOut = {
  lines: await runOnce({ lines: ['一', '二'] }),
  bare: await runOnce(['一', '二']),
  translations: await runOnce({ translations: ['一', '二'] }),
  oneLine: await runOnce({ lines: ['一\n二'] }),
  numbered: await runOnce({ lines: ['1. 一', '2. 二'] }),
};
for (const [k, v] of Object.entries(shapesOut)) {
  check(JSON.stringify(v) === '["一","二"]', `接口回来的形状 ${k}：${JSON.stringify(v)}`);
}

// ---- 3 整轮走一遍：每一条都配上自己的译文 ----
reply = { lines: ['I am tired', 'Go for a walk'] };
const turn = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const r = await import('/src/system/ai/reply.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id, translateTo: '英文' });
  await r.renderTurn({ chat: db.chats.get(chat.id), char: c,
    raw: '今天好累\n出去走走', turnId: 't1', instant: true });
  return db.messagesOf(chat.id).map(m => [m.content, m.translation || '']);
});
check(JSON.stringify(turn) === '[["今天好累","I am tired"],["出去走走","Go for a walk"]]',
  `一轮两条，两条都有译文（${JSON.stringify(turn)}）`);

// ---- 4 点通知那一下，比 js 早到也要兑现 ----
const jump = await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  const push = await import('/src/system/push.js');
  const db = await import('/src/system/db/index.js');
  const chat = db.chats.all()[0];
  nav.goHome();
  // index.html 里那个占位函数接住的那一下。开机时 push.js 已经换上了真函数，
  // 这里换回占位的那一个，模拟「js 还没起来时点了通知」
  window.phoneNotifyOpen = d => {
    window.__notifyOpen = d || null;
    try { sessionStorage.setItem('notify-open', JSON.stringify(d || null)); } catch { /* */ }
    return true;
  };
  window.phoneNotifyOpen({ appId: 'chat', route: `/chat/${chat.id}` });
  const before = nav.nav.get().screen;
  push.installClickBridge();
  const s = nav.nav.get();
  return { before, screen: s.screen, appId: s.appId,
    stack: s.stacks[s.appId] || [], want: `/chat/${chat.id}` };
});
check(jump.before === 'home', '点之前还在桌面上');
check(jump.screen === 'app' && jump.appId === 'chat' && jump.stack.slice(-1)[0] === jump.want,
  `起来之后补跳到那段对话（${JSON.stringify(jump)}）`);
check(jump.stack.length > 1, `底下垫着首页，退得回去（${JSON.stringify(jump.stack)}）`);

// 冷启动那条路：地址里带着去处
const cold = await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  const push = await import('/src/system/push.js');
  const db = await import('/src/system/db/index.js');
  const chat = db.chats.all()[0];
  nav.goHome();
  history.replaceState(null, '', `${location.pathname}#n=${encodeURIComponent(`chat|/chat/${chat.id}`)}`);
  push.installClickBridge();
  const s = nav.nav.get();
  return { screen: s.screen, appId: s.appId, hash: location.hash,
    stack: s.stacks[s.appId] || [], want: `/chat/${chat.id}` };
});
check(cold.screen === 'app' && cold.appId === 'chat' && cold.stack.slice(-1)[0] === cold.want,
  `地址里带着去处也跳得过去（${JSON.stringify(cold)}）`);
check(cold.hash === '', '跳完把地址抹干净，下次刷新不会再跳一遍');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
