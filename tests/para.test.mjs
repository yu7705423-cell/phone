import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const bookMod = await import('/src/system/book.js');
  db.settings.set({ services: { chat: { presets: [{ id: 'p1', name: '主用',
    provider: 'openai', kind: 'openai', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }],
    activeId: 'p1', fallbackId: 'p1' } }, crowdCount: 3 });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '旧书店店员' });
  const b = db.characters.create({ name: '乙', persona: '气象站的人' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  const bk = await bookMod.add({ title: '雨城旧事', author: '某人', kind: 'txt',
    text: '第一段。天还没亮。\n\n第二段。老板娘说只剩一间。\n\n第三段。雨一直没停。' });
  // 加了影片段评之后，这几个 API 统一收 subject（'book:<id>' / 'video:<id>'），
  // 不再单收 bookId
  const para = await import('/src/system/paracomment.js');
  return { book: bk.id, subject: para.subjectOf(para.BOOK, bk.id),
    chat: chat.id, a: a.id, b: b.id };
});

const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

// 段落锚点
const ps = await page.evaluate(async i => {
  const bookMod = await import('/src/system/book.js');
  const t = await bookMod.textOf(i.book);
  return { all: bookMod.paragraphsOf(t, 0, 2400), text: t };
}, ids);
ck('切出三段', ps.all.length === 3);
ck('起点对得上原文', ps.all.every(p => ps.text.slice(p.at, p.at + p.text.length) === p.text));
const P2 = ps.all[1].at;

// 三种来路
const gen = await page.evaluate(async ([i, at]) => {
  const t = await import('/src/system/ai/tasks/para-comment.js');
  const para = await import('/src/system/paracomment.js');
  const db = await import('/src/system/db/index.js');
  const out = {};
  let calls = 0, seen = [];
  const mock = content => { window.fetch = async (u, init) => {
    calls += 1; const bd = JSON.parse(init.body);
    seen.push(bd.system || bd.messages?.find(m => m.role === 'system')?.content || '');
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }); }; };

  // 1. 一个角色
  calls = 0; seen = [];
  mock('这一段我读过很多次。');
  const r1 = await t.one({ subject: i.subject, at, charId: i.a });
  out.one = { calls, n: r1.length, author: r1[0].authorName, kind: r1[0].kind };

  // 2. 多人共读，默认一次调用写全部
  para.setCrew(i.subject, [i.a, i.b]);
  calls = 0; seen = [];
  mock(JSON.stringify({ comments: [
    { name: '甲', text: '老板娘这句话像真的。' },
    { name: '乙', text: '这种天气确实只剩一间。' },
    { name: '不存在的人', text: '应当被丢掉' }] }));
  const r2 = await t.crew({ subject: i.subject, at, charIds: [i.a, i.b] });
  out.crewTogether = { calls, n: r2.length, names: r2.map(x => x.authorName),
    english: /Several people are reading it/.test(seen[0]),
    noRetell: /Do not retell it/.test(seen[0]),
    crewListed: /甲/.test(seen[0]) && /乙/.test(seen[0]),
    passage: (seen[0].match(/老板娘说只剩一间。/) || [''])[0] };
  out.callsTogether = t.callsForCrew([i.a, i.b]);
  t.keep(i.subject, at, r2);

  // 3. 切成一人一次
  db.settings.set({ crowdSeparate: true });
  calls = 0; seen = [];
  mock('分开写的一条。');
  const r3 = await t.crew({ subject: i.subject, at, charIds: [i.a, i.b] });
  out.crewSeparate = { calls, n: r3.length };
  out.callsSeparate = t.callsForCrew([i.a, i.b]);
  db.settings.set({ crowdSeparate: false });

  // 4. 随机读者
  calls = 0; seen = [];
  mock(JSON.stringify({ comments: [
    { name: '路人甲', text: '好。' }, { name: '路人乙', text: '一般。' },
    { name: '路人甲', text: '重名的应当丢掉' }] }));
  const r4 = await t.readers({ subject: i.subject, at });
  out.readers = { calls, n: r4.length, kind: r4[0].kind, noId: r4.every(x => !x.authorId) };
  out.charsBefore = db.characters.count();
  t.keep(i.subject, at, r4);
  out.charsAfter = db.characters.count();

  // 落库
  t.keep(i.subject, at, r1);
  out.onPara = para.listFor(i.subject, at).length;
  out.counts = [...para.countsIn(i.subject, 0, 2400).entries()];
  return out;
}, [ids, P2]);

ck('单人一次调用', gen.one.calls === 1 && gen.one.n === 1 && gen.one.author === '甲');
ck('共读合写只调一次', gen.crewTogether.calls === 1);
ck('名单外的名字被丢掉', gen.crewTogether.n === 2);
ck('两人都写了', JSON.stringify(gen.crewTogether.names) === '["甲","乙"]');
ck('共读 prompt 是英文且不许复述', gen.crewTogether.english && gen.crewTogether.noRetell);
ck('人设发过去了', gen.crewTogether.crewListed);
ck('整段原文发过去了，不是一个字 ("'+gen.crewTogether.passage+'")', gen.crewTogether.passage === '老板娘说只剩一间。');
ck('合写算 1 次', gen.callsTogether === 1);
ck('分开写调了 2 次', gen.crewSeparate.calls === 2 && gen.crewSeparate.n === 2);
ck('分开写算 2 次', gen.callsSeparate === 2);
ck('随机评论一次调用', gen.readers.calls === 1);
ck('重名的读者被丢掉', gen.readers.n === 2);
ck('读者不入库', gen.charsBefore === gen.charsAfter);
ck('读者没有角色 id', gen.readers.noId);
ck('评论都挂在这一段上', gen.onPara >= 5);

// 界面
await page.evaluate(async i => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('theater', `/read/${i.book}`);
}, ids);
await page.waitForTimeout(900);
ck('每段都有气泡', await page.locator('.rd-dot').count() === 3);
ck('有评论的那个显示条数', await page.locator('.rd-dot.has-n').count() === 1);
await page.screenshot({ path: `${OUT}/bubbles.png` });
await page.locator('.rd-dot.has-n').click();
await page.waitForTimeout(700);
ck('点开进评论页', await page.getByText('多人共读', { exact: true }).count() > 0);
ck('评论页列出了评论', await page.getByText('老板娘这句话像真的。', { exact: true }).count() > 0);
ck('原文在顶上', await page.locator('.pr-passage').count() > 0);
await page.screenshot({ path: `${OUT}/parapage.png` });

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '段评全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
