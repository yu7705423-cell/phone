// 不要写这些：列表进 prompt、本地扫得出来、命中标在消息上、重掷默认不重。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
let calls = [];
let reply = '空气中弥漫着一股甜味\n她抬起头';
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  if (!u.includes('/v1/messages')) return route.abort();
  const body = JSON.parse(route.request().postData() || '{}');
  calls.push(typeof body.system === 'string' ? body.system : (body.system?.[0]?.text || ''));
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: reply }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 纯逻辑 ----
const r1 = await page.evaluate(async () => {
  const ban = await import('/src/system/ban.js');
  const db = await import('/src/system/db/index.js');
  const empty = { on: ban.on(), list: ban.list().length, scan: ban.scan('随便一句话').length };
  db.settings.set({ banPhrases: ['空气中弥漫着', '把*揉进骨血里', ' 不易 察觉的 '] });
  return {
    empty,
    on: ban.on(),
    list: ban.list(),
    plain: ban.scan('空气中弥漫着一股甜味'),
    wild: ban.scan('像是要把她整个人揉进骨血里'),
    wildFar: ban.scan('要把这些年攒下的所有委屈和不甘通通揉进骨血里'),
    space: ban.scan('一个不易察觉的动作'),
    miss: ban.scan('她抬起头看了看'),
    lines: ban.promptLines(),
    reroll: ban.rerollMax(),
  };
});
check(!r1.empty.on && r1.empty.list === 0 && r1.empty.scan === 0, '默认一条都没有，什么都不拦');
check(r1.on && r1.list.length === 3, `填进去就生效（${JSON.stringify(r1.list)}）`);
check(r1.plain.length === 1 && r1.plain[0] === '空气中弥漫着', '直接命中，回来的是词条原文');
check(r1.wild.length === 1, `星号认得下中间换人称的（${JSON.stringify(r1.wild)}）`);
check(r1.wildFar.length === 0, '隔太远的不算，避免误伤');
check(r1.space.length === 1, '词条里的空格不参与比对');
check(r1.miss.length === 0, '没踩的不报');
check(/把…揉进骨血里/.test(r1.lines) && !/\*/.test(r1.lines), `送进 prompt 时星号换成省略号（${JSON.stringify(r1.lines)}）`);
check(r1.reroll === 0, '重掷默认 0 次');

// ---- 2 进 prompt ----
const r2 = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const eng = await import('/src/system/ai/engine.js');
  svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '林', persona: '人设' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
  db.messages.create({ chatId: chat.id, role: 'user', kind: 'text', content: '在吗', status: 'done' });
  const sys = eng.buildChatSystem(chat, c, db.messagesOf(chat.id), {}).system;
  db.settings.set({ banPhrases: [] });
  const sysEmpty = eng.buildChatSystem(chat, c, db.messagesOf(chat.id), {}).system;
  db.settings.set({ banPhrases: ['空气中弥漫着'] });
  return { sys, sysEmpty, chat: chat.id, char: c.id,
    tailIdx: sys.indexOf('[不要写这些]'), coreIdx: sys.indexOf('[消息规则]') };
});
check(/\[不要写这些\]/.test(r2.sys) && /- 空气中弥漫着/.test(r2.sys), '列表写进了 prompt');
check(!/\[不要写这些\]/.test(r2.sysEmpty), '列表空着时整段不出现');
check(r2.tailIdx > r2.coreIdx, '放在收尾段，贴着输出');

// ---- 3 命中标在消息上 ----
const r3 = await page.evaluate(async ([chatId, charId]) => {
  const db = await import('/src/system/db/index.js');
  const rep = await import('/src/system/ai/reply.js');
  const made = await rep.renderTurn({ chat: db.chats.get(chatId), char: db.characters.get(charId),
    raw: '空气中弥漫着一股甜味\n她抬起头', turnId: 't1', instant: true });
  return made.map(m => ({ c: m.content, ban: m.ban || null }));
}, [r2.chat, r2.char]);
check(r3.some(m => m.ban?.includes('空气中弥漫着')), `命中的那一条带上了记号（${JSON.stringify(r3)}）`);
check(r3.some(m => /抬起头/.test(m.c) && !m.ban), '没命中的那条不带记号');

// ---- 4 重掷：默认不重，填了才重 ----
const r4 = await page.evaluate(async ([chatId]) => {
  const db = await import('/src/system/db/index.js');
  const nav = await import('/src/system/nav.js');
  // 桩回的是普通 JSON，流式那条路要 SSE，所以这一段走一次性返回
  db.settings.set({ banReroll: 2, streamMode: 'once' });
  nav.goHome(); nav.openApp('chat', `/chat/${chatId}`);
  return db.settings.get().banReroll;
}, [r2.chat]);
await page.waitForTimeout(800);
calls = [];
// 桩每次都回同一句带禁写词的，所以会一直重掷到用完次数：1 次原本 + 2 次重掷
await page.locator('[aria-label="更多"]').first().waitFor({ timeout: 4000 });
await page.locator('.send-btn').first().click({ timeout: 4000 });
await page.waitForTimeout(3200);
check(r4 === 2 && calls.length === 3, `开了重掷之后按次数重（发了 ${calls.length} 次，要 3 次）`);
const kept = await page.evaluate(async ([chatId]) => {
  const db = await import('/src/system/db/index.js');
  // 候选挂在这一轮的头一条上，不是最后一条
  const mine = db.messagesOf(chatId).filter(m => m.role === 'char');
  const turn = mine[mine.length - 1]?.turnId;
  const head = mine.find(m => m.turnId === turn);
  return { swipes: head?.swipes?.length || 0, ban: mine.some(m => m.ban?.length) };
}, [r2.chat]);
check(kept.swipes === 3, `重掷掉的那几版留在候选里（${kept.swipes} 版）`);
check(!!kept.ban, '重完还是命中，就照实标出来，不假装干净');

// 关掉之后只发一次
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ banReroll: 0 });
});
calls = [];
await page.locator('.send-btn').first().click({ timeout: 4000 });
await page.waitForTimeout(2200);
check(calls.length === 1, `关着就只发一次（${calls.length} 次）`);

// ---- 5 账要摆在用量页上 ----
const r5 = await page.evaluate(async () => {
  const cost = await import('/src/system/ai/cost.js');
  const db = await import('/src/system/db/index.js');
  const listed = cost.EXTRA_CALLS.find(x => x.id === 'banReroll');
  db.settings.set({ banReroll: 0 });
  const offNow = cost.active().some(x => x.id === 'banReroll');
  db.settings.set({ banReroll: 2 });
  const onNow = cost.active().some(x => x.id === 'banReroll');
  db.settings.set({ banReroll: 0, banPhrases: [] });
  return { listed: !!listed, off: listed?.off, offNow, onNow };
});
check(r5.listed && r5.off === 0, '登记进了 EXTRA_CALLS，默认值是关着的');
check(!r5.offNow && r5.onNow, '关着不计入，开了才计入这一轮的账');

// ---- 6 设置页打得开 ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('settings', '/ban');
});
await page.waitForTimeout(700);
const ui = await page.locator('.app-layer').innerText();
check(/不要写这些/.test(ui) && /每行一条/.test(ui), '设置页打得开，说明写清楚了');
check(/命中后重新生成/.test(ui) && /额外调用一次接口/.test(ui), '重掷那一项把账写明白了');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
