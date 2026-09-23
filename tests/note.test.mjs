// 备忘：并在待办里的第二个标签页，和角色手机里那份不是一回事。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
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

// ---- 1 数据层 ----
const d = await page.evaluate(async () => {
  const n = await import('/src/system/note.js');
  const db = await import('/src/system/db/index.js');
  const a = n.add('买牛奶\n还有鸡蛋\n以及面包');
  const b = n.add('一行的');
  await new Promise(r => setTimeout(r, 5));
  n.update(b.id, '改过了');
  return {
    title: n.titleOf(a), rest: n.restOf(a),
    emptyTitle: n.titleOf({ text: '' }),
    all: n.all().map(r => r.text),
    found: n.search('鸡蛋').length, miss: n.search('不存在').length,
    updated: db.notes.get(b.id).text,
    // 备忘和待办是两个域，互不相干
    todoCount: db.todos.count(), noteCount: db.notes.count(),
  };
});
check(d.title === '买牛奶' && d.rest === '还有鸡蛋 以及面包', `第一行当标题（${d.title} / ${d.rest}）`);
check(d.emptyTitle === '（空）', '空的也有个说法');
check(d.all[0] === '改过了', `改得最近的排前面（${JSON.stringify(d.all)}）`);
check(d.found === 1 && d.miss === 0, '搜得到也搜得空');
check(d.noteCount === 2 && d.todoCount === 0, `备忘和待办是两个域（备忘 ${d.noteCount} / 待办 ${d.todoCount}）`);

// ---- 2 界面 ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('todo', '/notes');
});
await page.waitForTimeout(700);
let body = await txt();
check(/备忘/.test(body) && /买牛奶/.test(body), '备忘页列出来了');
check(/还有鸡蛋/.test(body), '副标题带上了剩下那几行');

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('买牛奶'));
  if (row) row.click();
});
await page.waitForTimeout(600);
body = await txt();
check(/存到系统备忘录|没有系统分享面板/.test(body), `编辑页上说清楚了怎么送出去（${/存到系统备忘录/.test(body) ? '有分享面板' : '无分享面板'}）`);
check(/无法直接写入|需要在面板中选择一次|无法送入/.test(body), '说明了系统不开放直接写入');

// ---- 3 分享面板：取消不算出错 ----
const shared = await page.evaluate(async () => {
  const n = await import('/src/system/note.js');
  const row = n.all()[0];
  const before = n.canShare();
  let gotCancel, gotOk, payload;
  navigator.share = async d => { payload = d; throw Object.assign(new Error('x'), { name: 'AbortError' }); };
  gotCancel = await n.shareOut(row);
  navigator.share = async () => {};
  gotOk = await n.shareOut(row);
  let threwEmpty = '';
  try { await n.shareOut({ text: '  ' }); } catch (e) { threwEmpty = e.message; }
  return { before, gotCancel, gotOk, payload, threwEmpty };
});
check(shared.gotCancel === false, '面板上按取消不当成出错');
check(shared.gotOk === true, '递出去了就是递出去了');
check(!!shared.payload?.text, `递过去的是正文（${JSON.stringify(shared.payload?.title)}）`);
check(/空的/.test(shared.threwEmpty), '空的不往外递');

// ---- 4 长按消息存成备忘 ----
const made = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const n = await import('/src/system/note.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  const m = db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id,
    kind: 'text', content: '那家店周一不开', status: 'done' });
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat', `/chat/${chat.id}`);
  return { chat: chat.id, msg: m.id, before: n.all().length };
});
await page.waitForTimeout(900);
// 气泡的长按挂在 touch 上，鼠标按住触发不了；桌面那条路是 contextmenu，
// 走的是同一个 onHold
await page.locator('.msg').filter({ hasText: '那家店周一不开' }).first()
  .dispatchEvent('contextmenu');
await page.waitForTimeout(700);
// 浮层画在 .app-layer 外面，这几条要读整页
body = await page.evaluate(() => document.body.innerText);
check(/存成备忘/.test(body), `长按菜单里有「存成备忘」（${body.slice(0, 80).replace(/\n/g, '/')}）`);
check(/记住这句/.test(body), '「记住这句」还在，两件事都留着');
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('存成备忘'));
  if (row) row.click();
});
await page.waitForTimeout(900);
const after = await page.evaluate(async () => {
  const n = await import('/src/system/note.js');
  const nav = await import('/src/system/nav.js');
  const s = nav.nav.get();
  return { n: n.all().length, top: n.all()[0]?.text, from: n.all()[0]?.from, app: s.appId };
});
check(after.n === made.before + 1, `存下来了（${after.n} 条）`);
check(/阿岚：那家店周一不开/.test(after.top || ''), `带上了是谁说的（${after.top}）`);
check(after.from === 'chat', '来源记成了来自对话');
check(after.app === 'todo', `跳到了备忘那一头（${after.app}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
