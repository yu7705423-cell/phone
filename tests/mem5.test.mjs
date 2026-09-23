// 记忆第五批：一直记着的、不要主动提起的、以及「这句你给我记住」
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/v1/messages', route => route.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '嗯' }] }) }));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  svc.newChatPreset({ name: 'A', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  const mk = (content, o = {}) => db.memories.create({ charId: c.id, personaId: me.id,
    content, category: o.category || 'fact', rank: 'A', keywords: o.kw || [],
    source: 'manual', ...o.extra });
  mk('不要叫她全名', { extra: { pinned: true } });
  mk('她怕黑，睡觉要留一盏灯', { extra: { pinned: true } });
  mk('她和前任的那段不要主动提', { extra: { taboo: true } });
  mk('她在成都做编辑', { kw: ['成都'] });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text',
    content: '在吗', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text',
    content: '我明天要去看牙医，怕得要死', status: 'done' });
  return { chat: chat.id, char: c.id, me: me.id };
});

// ---- 1 钉住的每轮常驻 ----
const sys = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const eng = await import('/src/system/ai/engine.js');
  return eng.buildChatSystem(db.chats.get(i.chat), db.characters.get(i.char),
    db.messagesOf(i.chat), {}).system;
}, ids);
check(/\[一直记着\]/.test(sys), '设定区里有「一直记着」这一段');
check(/不要叫她全名/.test(sys) && /她怕黑/.test(sys), '钉住的两条都在');
check(/Do not raise the following yourself/.test(sys), '忌讳那一段写明了不主动提');
check(/她和前任的那段不要主动提/.test(sys), '忌讳的内容在忌讳那一段里');
check(sys.indexOf('Do not raise the following yourself') > sys.indexOf('不要叫她全名'),
  '钉住的在前，忌讳的在后，两段分开');
check(!/她在成都做编辑/.test(sys), '没钉住的不在常驻里');

// ---- 2 钉住的不再去挤召回名额 ----
const rec = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  return mem.recall({ settings: db.settings.get(), char: db.characters.get(i.char),
    scanText: '她怕黑吗　不要叫全名', budgets: { memory: 4000 }, queryVec: null,
    persona: db.personas.get(i.me) }).map(m => m.content);
}, ids);
check(!rec.some(x => /怕黑|全名|前任/.test(x)),
  `常驻的那几条不再出现在本轮召回里（${JSON.stringify(rec)}）`);

// ---- 3 上限：默认八条，填 0 不限 ----
const cap = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  for (let k = 0; k < 12; k++) {
    db.memories.create({ charId: i.char, personaId: i.me, content: `钉住的第 ${k} 条`,
      category: 'fact', rank: 'A', source: 'manual', pinned: true,
      updatedAt: Date.now() - k * 1000 });
  }
  const eight = mem.pinnedOf(i.char, i.me, 8);
  const all = mem.pinnedOf(i.char, i.me, 0);
  return { def: db.settings.get().pinnedMax,
    eight: eight.keep.length + eight.taboo.length, over: eight.over,
    all: all.keep.length + all.taboo.length };
}, ids);
check(cap.def === 8, `默认上限八条（${cap.def}）`);
check(cap.eight === 8 && cap.over === 7, `超出的记了个数（带 ${cap.eight} 条，超出 ${cap.over} 条）`);
check(cap.all === 15, `填 0 就是全都要（${cap.all}）`);

// ---- 4 记忆页上标出来，也改得了 ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js'); nav.goHome(); nav.openApp('memory', '/');
});
await page.waitForTimeout(800);
const list = await page.locator('.app-layer').innerText();
check(/一直记着/.test(list) && /不主动提起/.test(list), '列表上分得出哪几条是常驻的');

const edited = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const nav = await import('/src/system/nav.js');
  const row = db.memories.all().find(m => /成都做编辑/.test(m.content));
  nav.push(`/edit/${row.id}`);
  return row.id;
});
await page.waitForTimeout(700);
const sw = await page.locator('.app-layer').innerText();
check(/一直记着/.test(sw) && /不要主动提起/.test(sw), '编辑页上有这两个开关');
await page.locator('.switch').first().click();
await page.waitForTimeout(400);
check(await page.evaluate(async id =>
  !!(await import('/src/system/db/index.js')).memories.get(id).pinned, edited),
  '点一下就钉住了');
// 两个开关互斥
await page.locator('.switch').nth(1).click();
await page.waitForTimeout(400);
const both = await page.evaluate(async id => {
  const m = (await import('/src/system/db/index.js')).memories.get(id);
  return { p: !!m.pinned, t: !!m.taboo };
}, edited);
check(both.t && !both.p, `改成忌讳之后不再是钉住（${JSON.stringify(both)}）`);
await page.screenshot({ path: `${OUT}/mem-pinned.png` });

// ---- 5 「记住这句」 ----
await page.evaluate(async i => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat', `/chat/${i.chat}`);
}, ids);
await page.waitForTimeout(900);
const before = await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).memories.count());
// 长按角色那条消息。鼠标的 click({delay}) 触发不了这套手势，要发 touch
const bubble = page.locator('.msg').filter({ hasText: '牙医' }).first();
await bubble.dispatchEvent('touchstart');
await page.waitForTimeout(700);
await bubble.dispatchEvent('touchend');
await page.waitForTimeout(500);
let menu = await page.locator('.sheet').innerText().catch(() => '(没打开)');
check(/记住这句/.test(menu), `长按菜单里有「记住这句」（${menu.slice(0, 120).replace(/\n/g, ' / ')}）`);
if (/记住这句/.test(menu)) await page.getByText('记住这句', { exact: true }).click();
await page.waitForTimeout(900);
const made = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const nav = await import('/src/system/nav.js');
  const rows = db.memories.all().filter(m => /牙医/.test(m.content));
  const s = nav.nav.get();
  return { n: rows.length, content: rows[0]?.content, source: rows[0]?.source,
    rank: rows[0]?.rank, app: s.appId, route: (s.stacks[s.appId] || []).slice(-1)[0],
    back: s.returnTo?.appId };
});
check(made.n === 1 && /阿岚说：我明天要去看牙医/.test(made.content),
  `存下来了，写明是谁说的（${made.content}）`);
check(made.source === 'manual' && made.rank === 'A', '记成手写、长期有效');
check(made.app === 'memory' && /^\/edit\//.test(made.route), '直接跳到那一条的编辑页');
check(made.back === 'chat', '退回去还是这段对话');
check(before + 1 === await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).memories.count()), '只加了一条');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
