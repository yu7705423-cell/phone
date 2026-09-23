// 记忆第四批：矛盾的两条不再并存 —— 槽位、自动取代、体检页
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
let reply = null; let seen = '';
await page.route('**/v1/messages', async route => {
  // 开了缓存声明之后 system 是内容块数组，两种形状都要认
  const sys = JSON.parse(route.request().postData() || '{}').system;
  seen = Array.isArray(sys) ? sys.map(b => b.text || '').join('') : String(sys || '');
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] }) });
});
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
  db.memories.create({ charId: c.id, personaId: me.id, content: '她在成都做编辑',
    category: 'fact', rank: 'A', keywords: ['成都'], slot: 'occupation', source: 'manual' });
  return { chat: chat.id, char: c.id, me: me.id };
});

// ---- 1 槽位：同一个槽位来了新的，旧的自动让位 ----
const slot = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mc = await import('/src/system/memcheck.js');
  const row = db.memories.create({ charId: i.char, personaId: i.me,
    content: '她换了工作，现在在书店', category: 'fact', rank: 'A',
    slot: 'occupation', source: 'manual', createdAt: Date.now() });
  const gone = mc.settleNew(row);
  const old = db.memories.all().find(m => /成都做编辑/.test(m.content));
  return { gone: gone.length, by: old.supersededBy === row.id,
    alive: mc.poolOf(i.char, i.me).map(m => m.content) };
}, ids);
check(slot.gone === 1 && slot.by, '同一个槽位，旧那条让位给新的');
check(!slot.alive.some(x => /成都做编辑/.test(x)), `让位的不再参与召回（${JSON.stringify(slot.alive)}）`);
check(await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).memories.all().some(m => /成都做编辑/.test(m.content))),
  '但它还留在库里，没有被删掉');

// ---- 2 几乎一模一样的两条自动合并，谁新留谁 ----
const same = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mc = await import('/src/system/memcheck.js');
  const a = db.memories.create({ charId: i.char, personaId: i.me,
    content: '她怕打雷，打雷的晚上睡不着', category: 'fact', rank: 'A',
    source: 'auto', createdAt: Date.now() - 86400000 });
  const b = db.memories.create({ charId: i.char, personaId: i.me,
    content: '她怕打雷，打雷的晚上总是睡不着', category: 'fact', rank: 'A',
    source: 'auto', createdAt: Date.now() });
  mc.settleNew(b);
  return { oldGone: !!db.memories.get(a.id).supersededBy, newAlive: !db.memories.get(b.id).supersededBy };
}, ids);
check(same.oldGone && same.newAlive, '几乎一样的两条，旧的让位给新的');

// ---- 3 像但不确定的那一档只标出来，不动手 ----
const doubt = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mc = await import('/src/system/memcheck.js');
  const a = db.memories.create({ charId: i.char, personaId: i.me,
    content: '她说她喜欢猫', category: 'fact', rank: 'A', source: 'auto' });
  const b = db.memories.create({ charId: i.char, personaId: i.me,
    content: '她说她怕猫', category: 'fact', rank: 'A', source: 'auto' });
  const gone = mc.settleNew(b);
  const ps = mc.pairs(i.char, i.me);
  return { gone: gone.length,
    both: !db.memories.get(a.id).supersededBy && !db.memories.get(b.id).supersededBy,
    flagged: ps.some(p => /喜欢猫|怕猫/.test(p.a.content) && /喜欢猫|怕猫/.test(p.b.content)) };
}, ids);
check(doubt.gone === 0 && doubt.both, '「喜欢猫」与「怕猫」不自动合并 —— 自动合这一档会误伤');
check(doubt.flagged, '但体检里标出来了，等人裁决');

// ---- 4 体检页：挑一条留下，另一条让位，还能撤回 ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js'); nav.goHome(); nav.openApp('memory', '/check');
});
await page.waitForTimeout(800);
let ui = await page.locator('.app-layer').innerText();
check(/记忆体检/.test(ui), '体检页打得开');
check(/相似度 \d+%/.test(ui), `列出了相似度（${ui.slice(0, 120)}）`);
await page.getByText('她说她喜欢猫', { exact: true }).first().click();
await page.waitForTimeout(400);
await page.locator('.modal-btn-primary').click();
await page.waitForTimeout(600);
const after = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  return db.memories.all().filter(m => /猫/.test(m.content))
    .map(m => `${m.content}${m.supersededBy ? '（已让位）' : ''}`);
});
check(after.some(x => /怕猫（已让位）/.test(x)) && after.some(x => /喜欢猫$/.test(x)),
  `留下了选中那条（${JSON.stringify(after)}）`);
ui = await page.locator('.app-layer').innerText();
check(/已让位/.test(ui) && /撤回/.test(ui), '让过位的单列一栏，可以撤回');
await page.screenshot({ path: `${OUT}/mem-check.png` });
// 「已让位」那一栏里不止这一条，点第一个不一定是它，直接按 id 撤
const back = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const mc = await import('/src/system/memcheck.js');
  const row = db.memories.all().find(m => /怕猫/.test(m.content));
  const before = !!row.supersededBy;
  mc.restore(row.id);
  return { before, after: !!db.memories.get(row.id).supersededBy };
});
check(back.before && !back.after, '撤回之后它回来了');

// ---- 5 让位的不进召回 ----
const recalled = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  const mc = await import('/src/system/memcheck.js');
  const row = db.memories.all().find(m => /怕猫/.test(m.content));
  mc.supersede(row.id, 'x');
  return mem.recall({ settings: db.settings.get(), char: db.characters.get(i.char),
    scanText: '你还喜欢猫吗', budgets: { memory: 4000 }, queryVec: null,
    persona: db.personas.get(i.me) }).map(m => m.content);
}, ids);
check(!recalled.some(x => /怕猫/.test(x)), `让过位的召不出来（${JSON.stringify(recalled)}）`);

// ---- 6 提取时把槽位与分量收下来 ----
reply = { memories: [
  { content: '她现在在一家旧书店上班', category: 'fact', rank: 'A',
    keywords: ['书店'], slot: 'occupation', weight: 1 },
  { content: '她说起父亲时哭了很久', category: 'emotion', rank: 'A',
    keywords: ['父亲'], slot: '乱写的', weight: 2 },
], spending: [] };
const ext = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/ai/tasks/memory-extract.js');
  db.messages.create({ chatId: i.chat, role: 'user', authorId: 'me', kind: 'text',
    content: '你最近在忙什么', status: 'done' });
  db.messages.create({ chatId: i.chat, role: 'char', authorId: i.char, kind: 'text',
    content: '在书店上班', status: 'done' });
  const r = await t.extract(i.chat);
  const rows = db.memories.all();
  return { r,
    slot: rows.find(m => /旧书店/.test(m.content))?.slot,
    bad: rows.find(m => /父亲/.test(m.content))?.slot,
    weight: rows.find(m => /父亲/.test(m.content))?.weight };
}, ids);
check(ext.slot === 'occupation', `槽位收下来了（${ext.slot}）`);
check(ext.bad === '', '不认识的槽位名丢掉，不硬塞');
check(ext.weight === 2, `分量收下来了（${ext.weight}）`);
check(/slot marks an entry that can only hold one value/.test(seen), '提示词里说明了槽位是什么');
check(/weight is how strongly/.test(seen) && /do not rate how important/.test(seen),
  '分量问的是当时反应多大，不是让它评判该有多重要');
check(ext.r.gone >= 1, `新的职业顶掉了旧的（让位 ${ext.r.gone} 条）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
