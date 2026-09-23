// 记忆第三批：本地相似度、综合打分、去冗余、召回解释
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/v1/messages', route => route.fulfill({ status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: '嗯' }] }) }));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 本地二元组：说得委婉也召得回 ----
const sim = await page.evaluate(async () => {
  const t = await import('/src/system/textsim.js');
  return {
    near: t.sim('她有胃病，不能吃辣', '我今天胃不舒服'),
    far: t.sim('她有胃病，不能吃辣', '明天要交房租了'),
    en: t.sim('she works at a bookstore', 'the bookstore closes late'),
    empty: t.sim('', 'x'),
  };
});
// 这个数天生偏小（十个字里对上两三个就算有关系），所以看的是相对高低
check(sim.near > 0.05, `「胃不舒服」够得着「胃病」（${sim.near.toFixed(3)}）`);
check(sim.near > sim.far * 2, `不相干的那句分明显低（${sim.far.toFixed(3)}）`);
check(sim.en > 0.1, `英文按词也算得上（${sim.en.toFixed(3)}）`);
check(sim.empty === 0, '空的一边返回 0');

const DAY = 86400000;
const ids = await page.evaluate(async d => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  svc.newChatPreset({ name: 'A', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚', persona: 'x', gender: '女' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  const mk = (content, o = {}) => db.memories.create({
    charId: c.id, personaId: me.id, content,
    category: o.category || 'fact', rank: o.rank || 'A', keywords: o.kw || [],
    source: o.source || 'auto',
    createdAt: Date.now() - (o.ago ?? 30) * d, updatedAt: Date.now() - (o.ago ?? 30) * d,
    ...(o.extra || {}),
  });
  mk('她有胃病，吃不了辣的', { kw: ['胃病'], ago: 200 });
  mk('她答应周末来看你', { category: 'pending', kw: ['周末'], ago: 3 });
  mk('她在成都做编辑', { kw: ['成都'], ago: 300 });
  mk('她喜欢下雨天', { kw: ['下雨'], ago: 100 });
  mk('她说她喜欢猫', { kw: ['猫'], ago: 150 });
  mk('她说她喜欢猫，尤其是橘猫', { kw: ['猫'], ago: 2 });   // 同一件事的两个版本
  return { chat: chat.id, char: c.id, me: me.id };
}, DAY);

const recall = async scan => page.evaluate(async ([i, text]) => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  const items = mem.recall({
    settings: db.settings.get(), char: db.characters.get(i.char), scanText: text,
    budgets: { memory: 4000 }, queryVec: null, persona: db.personas.get(i.me) });
  return { got: items.map(m => m.content), last: mem.lastRecall() };
}, [ids, scan]);

// ---- 2 线索：绕着说也召得回 ----
let r = await recall('我今天胃不太舒服');
check(r.got.some(x => /胃病/.test(x)), `说「胃不舒服」召回了胃病那条（${JSON.stringify(r.got)}）`);
check(!r.got.some(x => /成都/.test(x)) || r.got.indexOf(r.got.find(x => /胃病/.test(x))) === 0,
  '胃病那条排在最前面');

// ---- 3 未了结的不需要线索也上场 ----
check(r.got.some(x => /周末/.test(x)),
  `没人提周末，那条待办照样上场（${JSON.stringify(r.got)}）`);
const openRow = r.last.rows.find(x => /周末/.test(x.content));
check(openRow && openRow.parts.open === 1, '它的分里有「未了结」那一项');

// ---- 4 去冗余：同一件事只出一条 ----
r = await recall('你还喜欢猫吗');
const cats = r.got.filter(x => /猫/.test(x));
check(cats.length === 1, `两个版本的猫只出一条（${JSON.stringify(cats)}）`);
check(/橘猫/.test(cats[0]), `出的是更新的那一条（${cats[0]}）`);
const dropped = r.last.rows.find(x => x.dropped === 'same');
check(!!dropped, '被让位的那条记了原因，解释页上看得见');

// ---- 5 强度与疲劳：用过之后先压一轮 ----
const fat = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  const row = db.memories.all().find(m => /下雨/.test(m.content));
  const before = mem.scoreOf({ ...row }, { text: '', grams: null, w: mem.WEIGHTS });
  mem.markRecalled([row]);
  const after = db.memories.get(row.id);
  const s2 = mem.scoreOf(after, { text: '', grams: null, w: mem.WEIGHTS });
  // 把上次用过的时间往前推一小时，疲劳该退了
  db.memories.update(row.id, { lastUsedAt: Date.now() - 3600000 });
  const s3 = mem.scoreOf(db.memories.get(row.id), { text: '', grams: null, w: mem.WEIGHTS });
  return { used: after.useCount, hot: s2.parts.fatigue, cold: s3.parts.fatigue,
    strength: s3.parts.strength, before: before.parts.strength };
}, ids);
check(fat.used === 1, '用过一次就记了一笔');
check(fat.hot > 0.9, `刚用过的疲劳几乎拉满（${fat.hot.toFixed(2)}）`);
check(fat.cold === 0, '过一阵疲劳就退了');
check(fat.strength > fat.before, `强度涨了（${fat.before.toFixed(2)} -> ${fat.strength.toFixed(2)}）`);

// ---- 6 真发一轮之后才记，拼好没发不算 ----
//
// 这一库只有六条，而「固定带上最近几条」默认十条 —— 六条全进常驻档，
// 召回没东西可挑，自然也没有「被想起过」。那不是毛病：六条本来就都在
// prompt 里。要验的是召回这套机制，所以先把常驻档关掉隔离出来。
const marked = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const eng = await import('/src/system/ai/engine.js');
  db.memories.all().forEach(m => db.memories.update(m.id, { useCount: 0, lastUsedAt: 0 }));
  db.messages.create({ chatId: i.chat, role: 'user', authorId: 'me', kind: 'text',
    content: '在吗', status: 'done' });

  db.settings.set({ memoryRecent: 0 });
  await eng.streamReply({ chat: db.chats.get(i.chat), char: db.characters.get(i.char) });
  const recalled = db.memories.all().filter(m => (m.useCount || 0) > 0).length;

  // 常驻档一开，这一库全被它吃掉，召回就挑不到了
  db.memories.all().forEach(m => db.memories.update(m.id, { useCount: 0, lastUsedAt: 0 }));
  db.settings.set({ memoryRecent: 10 });
  // 常驻档在 VOLATILE 里，下沉到对话末尾，所以两段都要看
  const b = eng.buildChatSystem(db.chats.get(i.chat), db.characters.get(i.char),
    db.messagesOf(i.chat).filter(m => m.status !== 'error'), {});
  const sys = b.system + '\n' + (b.volatile || '');
  db.settings.set({ memoryRecent: 10 });
  return { recalled, allIn: /胃病/.test(sys) && /周末/.test(sys) };
}, ids);
check(marked.recalled > 0 && marked.recalled <= 6,
  `发出去之后那几条记上了（${marked.recalled} 条）`);
check(marked.allIn,
  '库小于常驻档时召回挑不到东西，但那几条本来就全在 prompt 里');

// ---- 7 权重能改，改了立刻生效 ----
const tuned = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  const call = () => mem.recall({ settings: db.settings.get(), char: db.characters.get(i.char),
    scanText: '随便说点什么', budgets: { memory: 4000 }, queryVec: null,
    persona: db.personas.get(i.me) }).map(m => m.content);
  // 比分，不比名次。名次取决于这一份库里几条的相对高低，改了权重也可能
  // 恰好还是那个顺序；而「权重生效」说的是它对分数的那一项真的乘上去了
  const scoreOf = () => {
    call();
    const row = mem.lastRecall().rows.find(x => /周末/.test(x.content));
    return row ? Math.round(row.score * 1e4) / 1e4 : null;
  };
  const before = scoreOf();
  db.settings.set({ memoryWeights: { open: 0 } });
  const after = scoreOf();
  db.settings.set({ memoryWeights: {} });
  return { before, after };
}, ids);
check(tuned.before !== null && tuned.after !== null && tuned.before > tuned.after,
  `把「未了结」调成 0，那一条的分跟着掉（${tuned.before} -> ${tuned.after}）`);

// ---- 8 召回解释那一页 ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js'); nav.goHome(); nav.openApp('memory', '/last');
});
await page.waitForTimeout(800);
const ui = await page.locator('.app-layer').innerText();
check(/上一轮召回/.test(ui), '页面打得开');
check(/候选 \d+ 条，注入 \d+ 条/.test(ui), `写了候选与注入各几条（${ui.slice(0, 80)}）`);
check(/线索|未了结|新近/.test(ui), '每条列出了是哪几项把它顶上来的');
check(/本地二元组|语义向量/.test(ui), '写明了这一轮用的哪种检索');
await page.screenshot({ path: `${OUT}/mem-last.png` });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
