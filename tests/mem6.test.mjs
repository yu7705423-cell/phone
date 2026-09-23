// 记忆第六批：关于谁、保底名额、待办过期、自动总结摆到台面上
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
  const sys = JSON.parse(route.request().postData() || '{}').system;
  seen = Array.isArray(sys) ? sys.map(b => b.text || '').join('') : String(sys || '');
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);
const day = n => {
  const d = new Date(Date.now() + n * 86400000);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const ids = await page.evaluate(async ([soon, past]) => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  svc.newChatPreset({ name: 'A', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  const mk = (content, o = {}) => db.memories.create({ charId: c.id, personaId: me.id,
    content, category: o.category || 'fact', rank: 'A', keywords: o.kw || [],
    source: 'manual', about: o.about || '', dueAt: o.due || '',
    createdAt: Date.now() - (o.ago || 10) * 86400000 });
  mk('她在成都做编辑', { about: 'char' });
  mk('她习惯晚睡', { about: 'char' });
  mk('她很少主动开口', { about: 'char', category: 'pattern' });
  mk('你对花生过敏', { about: 'user' });
  mk('那天她在雨里等了两个小时', { about: 'both', category: 'emotion' });
  mk('她答应周末来看你', { category: 'pending', due: soon });
  mk('她说下周三面试', { category: 'pending', due: past, ago: 30 });
  return { chat: chat.id, char: c.id, me: me.id };
}, [day(3), day(-20)]);

// ---- 1 过期的待办不再当成未了结 ----
const due = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  const rows = db.memories.all();
  const soon = rows.find(m => /周末/.test(m.content));
  const gone = rows.find(m => /面试/.test(m.content));
  return { soon: mem.isOpen(soon), gone: mem.isOpen(gone),
    over: mem.overdue().map(m => m.content) };
}, ids);
check(due.soon === true, '还没到日子的照旧算未了结');
check(due.gone === false, '过了期的不再顶上来 —— 不会三个月后还在问面试');
check(due.over.some(x => /面试/.test(x)), '过期的进了待复查那一栏');

// ---- 2 行里把到期日写出来 ----
const line = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  return mem.recallText([db.memories.all().find(m => /周末/.test(m.content))]);
});
check(/\(due \d{4}-\d{2}-\d{2}\)/.test(line), `到期日写在行里（${line.split('\n').pop()}）`);

// ---- 3 保底名额：关于你的、以及具体那一件 ----
const q = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  // 这段话把好几条都带进候选池，名额只给三个，逼着保底名额起作用
  const got = mem.recall({ settings: { ...db.settings.get(), memoryTopK: 3 },
    char: db.characters.get(i.char),
    scanText: '她晚睡，很少主动开口，在成都做编辑；你对花生过敏；那天她在雨里等了很久',
    budgets: { memory: 4000 }, queryVec: null, persona: db.personas.get(i.me) });
  return got.map(m => `${m.content}｜${m.about || ''}｜${m.category}`);
}, ids);
check(q.some(x => x.includes('｜user｜')), `挑三条里保住了一条关于你的（${JSON.stringify(q)}）`);
check(q.some(x => /emotion|relation|pending/.test(x.split('｜')[2])),
  '也保住了一条具体发生过的事');

// ---- 4 提取时把这两样收下来 ----
reply = { memories: [
  { content: '你下周要去体检', category: 'pending', rank: 'A', keywords: ['体检'],
    about: 'user', dueAt: '2026-10-08', weight: 1 },
  { content: '她讨厌香菜', category: 'fact', rank: 'A', keywords: ['香菜'],
    about: '乱写的', dueAt: '下周', weight: 1 },
], spending: [] };
const ext = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/ai/tasks/memory-extract.js');
  db.messages.create({ chatId: i.chat, role: 'user', authorId: 'me', kind: 'text',
    content: '我下周要体检', status: 'done' });
  db.messages.create({ chatId: i.chat, role: 'char', authorId: i.char, kind: 'text',
    content: '记得空腹', status: 'done' });
  await t.extract(i.chat);
  const rows = db.memories.all();
  const a = rows.find(m => /体检/.test(m.content));
  const b = rows.find(m => /香菜/.test(m.content));
  return { about: a?.about, due: a?.dueAt, badAbout: b?.about, badDue: b?.dueAt };
}, ids);
check(ext.about === 'user' && ext.due === '2026-10-08', `关于谁与到期日都收下了（${JSON.stringify(ext)}）`);
check(ext.badAbout === '' && ext.badDue === '', '写乱的那两项丢掉，不硬塞');
check(/about says whose life the entry concerns/.test(seen), '提示词里说明了「关于谁」');
check(/dueAt applies to a pending entry/.test(seen), '提示词里说明了到期日');

// ---- 5 自动总结摆到台面上 ----
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ autoSummarizeInterval: 0 });
  const nav = await import('/src/system/nav.js'); nav.goHome(); nav.openApp('memory', '/');
});
await page.waitForTimeout(800);
let ui = await page.locator('.app-layer').innerText();
check(/自动总结：未开启/.test(ui), `记忆页第一眼就看得见开没开（${ui.slice(0, 160).replace(/\n/g, ' / ')}）`);
check(/条尚未总结/.test(ui), '写了积压多少条');
check(/这些内容不会成为记忆/.test(ui), '写明了关着的后果');
await page.getByText('自动总结：未开启', { exact: false }).first().click();
await page.waitForTimeout(400);
check(/每次额外调用一次接口/.test(await page.locator('.modal').innerText()), '开之前先把账说清楚');
await page.locator('.modal-btn-primary').click();
await page.waitForTimeout(600);
ui = await page.locator('.app-layer').innerText();
check(/自动总结：每 6 轮一次/.test(ui), '一键开起来了');
check(await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.get().autoSummarizeInterval) === 6, '落库了');
await page.screenshot({ path: `${OUT}/mem-home.png` });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
