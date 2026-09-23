// 待办：本地线索词一道、角色标记一道，两道都只落成待确认。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);
const txt = () => page.evaluate(() => (document.querySelector('.app-layer') || document.body).innerText);

// ---- 1 本地识别 ----
const d = await page.evaluate(async () => {
  const t = await import('/src/system/todo.js');
  const hit = s => { const r = t.detect(s); return r && r.text; };
  return {
    plain: hit('我想去看那个展览'),
    stop: hit('我打算下周去趟医院，然后再说别的'),
    skip: hit('我想你了'),
    skip2: hit('我要睡了，晚安'),
    bare: hit('我想'),
    none: hit('今天天气不错'),
    mid: hit('对了，记得帮我买牛奶'),
    cues: t.cues().length, skips: t.skips().length, on: t.localOn(),
  };
});
check(d.plain === '我想去看那个展览', `直说的认得出（${d.plain}）`);
check(d.stop === '我打算下周去趟医院', `一句一条，逗号就断（${d.stop}）`);
check(!d.skip && !d.skip2, `「我想你了」「我要睡了」不算（${d.skip} / ${d.skip2}）`);
check(!d.bare, '光一个线索词不算，那是半句话');
check(!d.none, '没线索词的不报');
check(d.mid === '记得帮我买牛奶', `线索词在句子中间也认（${d.mid}）`);
check(d.cues > 10 && d.skips > 10 && d.on, '默认给了一份线索词与排除词，本地这一道是开着的');

// ---- 2 词表可以自己改 ----
const e = await page.evaluate(async () => {
  const t = await import('/src/system/todo.js');
  const db = await import('/src/system/db/index.js');
  db.settings.set({ todoCues: ['待会'] });
  const a = { mine: t.detect('待会去取快递')?.text, old: t.detect('我想去看展') };
  db.settings.set({ todoCues: [] });
  const b = t.localOn();
  db.settings.set({ todoCues: null });
  return { ...a, offWhenEmpty: b, backToDefault: t.cues().length > 10 };
});
check(e.mine === '待会去取快递' && !e.old, '换成自己的词表就只认自己那份');
check(!e.offWhenEmpty, '词表清空等于把本地这一道关了');
check(e.backToDefault, '恢复默认拿得回来');

// ---- 3 两道都只落成待确认 ----
const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const t = await import('/src/system/todo.js');
  const rep = await import('/src/system/ai/reply.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  // 角色那一道：回复里写标记
  const made = await rep.renderTurn({ chat, char: c, turnId: 't1', instant: true,
    raw: '好啊\n[待办：周末一起去美术馆]\n那就说定了' });
  const rows = t.pendingOf(chat.id);
  return {
    chat: chat.id, char: c.id,
    bubbles: made.map(m => m.content),
    pending: rows.map(r => ({ text: r.text, from: r.from, state: r.state })),
    openNow: t.openOnes().length,
  };
});
check(!ids.bubbles.some(c => /待办/.test(c)), `标记不占气泡（${JSON.stringify(ids.bubbles)}）`);
check(ids.pending.length === 1 && ids.pending[0].text === '周末一起去美术馆'
  && ids.pending[0].from === 'char', `角色那一道落成待确认（${JSON.stringify(ids.pending)}）`);
check(ids.openNow === 0, '没点头之前，一条正式的待办都没有');

// ---- 4 会话页上问一句 ----
await page.evaluate(async ([chatId]) => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat', `/chat/${chatId}`);
}, [ids.chat]);
await page.waitForTimeout(800);
check(/周末一起去美术馆/.test(await txt()) && /计入/.test(await txt()), '会话页上压着一条问你要不要计入');

// 发一句带线索词的，本地那一道接上
await page.locator('.composer-input').fill('我要把那本书看完');
await page.locator('.send-btn').first().click();
await page.waitForTimeout(700);
const after = await page.evaluate(async ([chatId]) => {
  const t = await import('/src/system/todo.js');
  return t.pendingOf(chatId).map(r => ({ text: r.text, from: r.from }));
}, [ids.chat]);
check(after.length === 2 && after.some(r => r.from === 'local' && r.text === '我要把那本书看完'),
  `发出去那句也被本地识别出来（${JSON.stringify(after)}）`);

// 点「计入」
await page.getByText('计入', { exact: true }).first().click();
await page.waitForTimeout(600);
const acc2 = await page.evaluate(async () => {
  const t = await import('/src/system/todo.js');
  return { open: t.openOnes().map(r => r.text), pend: t.pendingAll().length };
});
check(acc2.open.length === 1 && acc2.pend === 1, `点了才算（已计入 ${JSON.stringify(acc2.open)}）`);

// 点「忽略」
await page.getByText('忽略', { exact: true }).first().click();
await page.waitForTimeout(600);
const ig = await page.evaluate(async ([chatId]) => {
  const t = await import('/src/system/todo.js');
  const db = await import('/src/system/db/index.js');
  const before = t.pendingOf(chatId).length;
  // 同一句再发一遍，不该再问第二次
  t.propose({ text: '我要把那本书看完', chatId, from: t.FROM_LOCAL });
  return { before, after: t.pendingOf(chatId).length, dropped: t.listOfState(t.DROP).length };
}, [ids.chat]);
check(ig.before === 0 && ig.dropped === 1, '忽略掉的不再问');
check(ig.after === 0, '同一件事不会重新冒出来');

// ---- 5 待办这个 app ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('todo', '/');
});
await page.waitForTimeout(700);
let body = await txt();
check(/待办/.test(body) && /周末一起去美术馆/.test(body), '待办页上列着已计入的那条');
check(/未完成 1/.test(body), `未完成那一栏数对了（${(body.match(/未完成 \d+/) || [])[0]}）`);

await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  nav.openApp('todo', '/detect');
});
await page.waitForTimeout(700);
body = await txt();
check(/线索词/.test(body) && /排除词/.test(body), '识别设置里两份词表都摆出来了');
check(/不额外调用接口/.test(body), '写明了两道都不多花接口');

// ---- 6 一次接口都没多打 ----
const cost = await page.evaluate(async () => {
  const c = await import('/src/system/ai/cost.js');
  return c.EXTRA_CALLS.some(x => /待办|todo/i.test(x.id + x.label));
});
check(!cost, '不进 EXTRA_CALLS —— 标记搭在本来就要发的那次回复上');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
