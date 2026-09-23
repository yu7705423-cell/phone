// 记忆第一批：Anthropic 收得下深度注入、召回块换成分栏、条数封顶
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
let sent = null;
await page.route('**/v1/messages', async route => {
  sent = JSON.parse(route.request().postData() || '{}');
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: '嗯' }] }) });
});
await page.route('**/chat/completions', async route => {
  sent = JSON.parse(route.request().postData() || '{}');
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: '嗯' } }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

const DAY = 86400000;
const ids = await page.evaluate(async d => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  const mk = (content, category, rank, keywords, ago) => db.memories.create({
    charId: c.id, personaId: me.id, content, category, rank, keywords,
    source: 'manual', createdAt: Date.now() - ago * d, updatedAt: Date.now() - ago * d,
  });
  mk('她在成都做编辑', 'fact', 'A', ['成都'], 200);
  mk('她说话很短，不解释', 'pattern', 'A', ['说话'], 120);
  mk('她答应周末来看你', 'pending', 'A', ['周末'], 10);
  mk('提到前任时她沉默了很久', 'emotion', 'A', ['前任'], 130);
  mk('两人在雨里和好了', 'relation', 'A', ['和好'], 1);
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text',
    content: '在吗', status: 'done' });
  return { chat: chat.id, char: c.id, me: me.id };
}, DAY);

// ---- 1 召回块：分栏、相对时间、冲突规则 ----
const text = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  // 这段话把三栏各沾一点：编辑、前任、周末
  const items = mem.recall({
    settings: db.settings.get(), char: db.characters.get(i.char),
    scanText: '你还在做编辑吗　上次说到前任　这个周末呢',
    budgets: { memory: 4000 }, queryVec: null, persona: db.personas.get(i.me) });
  return { n: items.length, text: mem.recallText(items) };
}, ids);
check(/Still unresolved:/.test(text.text), '分出了「还没了结的」这一栏');
check(/Always true:/.test(text.text), '分出了「一直如此的」这一栏');
check(/That happened:/.test(text.text), '分出了「发生过的事」这一栏');
check(text.text.indexOf('Still unresolved:') < text.text.indexOf('Always true:'),
  '没了结的排在最前面');
check(/她答应周末来看你/.test(text.text.split('Always true:')[0]), '待办落在第一栏');
check(/- \d{4}-\d{2}-\d{2} \(\d+ (days|weeks|months) ago\) /.test(text.text),
  `每一行带日期与多久以前（${text.text.split('\n').find(l => l.startsWith('- '))}）`);
check(!/【/.test(text.text), '不再有【类别 日期】那种装饰');
check(/the one with the later date is current/.test(text.text), '写明了冲突时以日期新的为准');
check(text.text.startsWith('[相关记忆]'), '抬头照旧是中文区块名');
check(/\n\n/.test(text.text.split('\n').slice(1).join('\n')), '说明与数据之间空一行隔开');

// 「今天」「昨天」也认
const words = await page.evaluate(async () => {
  const mem = await import('/src/system/ai/context/memory.js');
  const d = 86400000;
  return [0, 1, 3, 20, 100, 500].map(n => mem.agoText({ createdAt: Date.now() - n * d }));
});
check(JSON.stringify(words) === '["today","yesterday","3 days ago","3 weeks ago","3 months ago","about a year ago"]',
  `多久以前的说法（${JSON.stringify(words)}）`);

// ---- 2 条数封顶：没有向量接口的那一档也要封 ----
const capped = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const mem = await import('/src/system/ai/context/memory.js');
  const c = db.characters.get(i.char);
  // 待办不需要线索也上场，所以这二十条一定都在候选池里，
  // 用它们查条数封顶最干净 —— 不受相似度高低的影响
  // 二十件互不相干的事：内容要各不相同，否则会被「同一件事只出一条」
  // 那一步合掉，测不出条数封顶
  const TODO = ['看电影', '还伞', '寄明信片', '换灯泡', '交房租', '拔智齿',
    '补办证件', '退货', '订蛋糕', '修自行车', '剪头发', '买猫粮', '改论文',
    '还书', '拍证件照', '调闹钟', '洗窗帘', '取快递', '换轮胎', '预约体检'];
  TODO.forEach(x => db.memories.create({ charId: c.id, personaId: i.me,
    content: `还没去${x}`, category: 'pending', rank: 'A', keywords: [], source: 'manual' }));
  const q = '在吗';
  const one = mem.recall({ settings: db.settings.get(), char: c, scanText: q,
    budgets: { memory: 9000 }, queryVec: null, persona: db.personas.get(i.me) }).length;
  const all = mem.recall({ settings: { ...db.settings.get(), memoryTopK: 0 }, char: c,
    scanText: q, budgets: { memory: 9000 }, queryVec: null,
    persona: db.personas.get(i.me) }).length;
  return { topK: db.settings.get().memoryTopK, one, all };
}, ids);
check(capped.topK === 6, `默认一轮六条（${capped.topK}）`);
check(capped.one === 6, `候选一大堆，也只召回六条（${capped.one}）`);
check(capped.all > 15, `填 0 就是不限，照旧全给（${capped.all}）`);

// ---- 3 Anthropic：深度注入那一条不能是 system 角色 ----
const anth = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const eng = await import('/src/system/ai/engine.js');
  svc.newChatPreset({ name: 'A', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const chat = db.chats.get(i.chat), char = db.characters.get(i.char);
  await eng.streamReply({ chat, char });
  return true;
}, ids);
check(anth === true, '这一轮发得出去');
const roles = (sent?.messages || []).map(m => m.role);
check(!roles.includes('system'), `messages 里没有 system 角色（${JSON.stringify(roles)}）`);
check(roles[0] === 'user', `第一条是 user（${JSON.stringify(roles)}）`);
const first = String(sent?.messages?.[0]?.content || '');
check(/<context>[\s\S]*\[相关记忆\][\s\S]*<\/context>/.test(first),
  `召回被 <context> 裹住，不会当成用户说的话（${first.slice(0, 60)}）`);
check(/在吗/.test(first), '和紧随其后的那条用户消息合并成了一条');
// 开了缓存声明之后 system 是内容块数组，关掉才是纯字符串。两种都算走顶层参数
const sysText = Array.isArray(sent?.system) ? sent.system.map(b => b.text).join('') : sent?.system;
check(typeof sysText === 'string' && sysText.length > 0, 'system 仍然走顶层参数');

// 相邻同角色合并之后不该连着两条 user
const pairs = roles.slice(1).map((r, k) => `${roles[k]}>${r}`);
check(!pairs.includes('user>user'), `没有连着两条 user（${JSON.stringify(roles)}）`);

// ---- 4 OpenAI 那一档照旧用 system 角色 ----
const oaRoles = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const eng = await import('/src/system/ai/engine.js');
  const p = svc.newChatPreset({ name: 'O', provider: 'openai',
    baseUrl: `${BASE}/v1`, apiKey: 'k', model: 'm' });
  svc.setActiveChat(p.id);
  await eng.streamReply({ chat: db.chats.get(i.chat), char: db.characters.get(i.char) });
  return true;
}, ids);
check(oaRoles === true, 'OpenAI 那一档也发得出去');
const oa = (sent?.messages || []).map(m => m.role);
check(oa.includes('system') && oa.filter(r => r === 'system').length >= 2,
  `OpenAI 照旧收 system：一条是设定区，一条是召回（${JSON.stringify(oa)}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
