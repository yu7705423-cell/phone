// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
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
  const bookMod = await import('/src/system/book.js');
  db.settings.set({ services: { chat: { presets: [{ id: 'p1', name: '主用',
    provider: 'openai', kind: 'openai', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }],
    activeId: 'p1', fallbackId: 'p1' } }, injectChars: 300, injectMaxRuns: 2 });
  const a = db.characters.create({ name: '甲', persona: '旧书店店员' });
  // 12 段，每段约 60 字 —— 300 字大约能覆盖前 5 段
  const bk = await bookMod.add({ title: '雨城旧事', author: '某人', kind: 'txt',
    text: Array.from({ length: 12 }, (_, i) => `第 ${i} 段。` + '正文内容。'.repeat(9)).join('\n\n') });
  return { book: bk.id, a: a.id };
});

const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

const r = await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const ahead = await import('/src/system/readahead.js');
  const task = await import('/src/system/ai/tasks/readahead.js');
  const para = await import('/src/system/paracomment.js');
  const bookMod = await import('/src/system/book.js');
  const out = {};
  let calls = 0, seen = '';
  const mock = c => { window.fetch = async (u, init) => {
    calls += 1;
    const bd = JSON.parse(init.body);
    seen = bd.system || bd.messages?.find(m => m.role === 'system')?.content || '';
    return new Response(JSON.stringify({ choices: [{ message: { content: c } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }); }; };

  const text = await bookMod.textOf(i.book);
  const paras = bookMod.paragraphsOf(text, 0, text.length);
  out.totalParas = paras.length;

  // 一次注入 = 一次调用；模型只挑了 2 段，越界与重复丢掉
  calls = 0;
  mock(JSON.stringify({ notes: [
    { para: 2, text: '这一段写得静。' },
    { para: 4, text: '这里我读过。' },
    { para: 2, text: '重复的，丢掉' },
    { para: 99, text: '越界的，丢掉' }] }));
  ahead.begin(i.book, i.a, 0);
  const r1 = await task.run({ bookId: i.book, charId: i.a, from: 0 });
  ahead.advance(i.book, r1.to);
  out.firstRun = { calls, added: r1.added, read: r1.read, paragraphs: r1.paragraphs };
  out.numbered = /\[1\] 第 0 段/.test(seen) && /\[2\] 第 1 段/.test(seen);
  out.english = /Note the paragraphs you want to say something about/.test(seen);
  out.picksOwn = /Leave out any paragraph you have nothing to say about/.test(seen);
  out.noRetell = /Do not retell the paragraph/.test(seen);
  out.onlyInjected = !/第 11 段/.test(seen);   // 只注入了前面一截

  // 评论落在被挑中那两段上，不是第一段
  // 加了影片段评之后 listFor 收的是 subject（'book:<id>'），不再是 bookId
  const subject = para.subjectOf(para.BOOK, i.book);
  out.anchored = [paras[1].at, paras[3].at].map(at => para.listFor(subject, at).length);
  out.notOnFirst = para.listFor(subject, paras[0].at).length;

  // 追上没有
  const st = ahead.stateOf(i.book);
  out.readTo = st.at;
  out.caughtUpEarly = ahead.caughtUp(i.book, 0, 100);
  out.caughtUpLate = ahead.caughtUp(i.book, st.at, 100);

  // 默认不自动续
  out.autoByDefault = ahead.canAuto(i.book);
  ahead.setAlways(i.book, true);
  out.autoAfterAlways = ahead.canAuto(i.book);

  // 续到上限就停
  ahead.advance(i.book, st.at, { auto: true });
  out.runs1 = ahead.stateOf(i.book).runs;
  out.autoAt1 = ahead.canAuto(i.book);
  ahead.advance(i.book, st.at, { auto: true });
  out.runs2 = ahead.stateOf(i.book).runs;
  out.autoAt2 = ahead.canAuto(i.book);
  out.cappedAt2 = ahead.hitCap(i.book);
  // 手动继续把计数清零
  ahead.advance(i.book, st.at, { auto: false });
  out.runsAfterManual = ahead.stateOf(i.book).runs;

  // 注入 0 字 = 一次读到书末
  db.settings.set({ injectChars: 0 });
  out.endWhenZero = task.endOf(text, 0) === text.length;
  db.settings.set({ injectChars: 300 });
  return out;
}, ids);

ck('一次注入一次调用', r.firstRun.calls === 1);
ck('只留下模型挑的 2 处', r.firstRun.added === 2);
ck('按段编号发过去', r.numbered);
ck('prompt 是英文', r.english);
ck('明写了没话说的段落留空', r.picksOwn);
ck('明写了不要复述', r.noRetell);
ck('只发了注入的那一截，不是整本', r.onlyInjected);
ck('评论挂在被挑中的段上', JSON.stringify(r.anchored) === '[1,1]');
ck('没有全堆在第一段', r.notOnFirst === 0);
ck('只读了约 300 字 ('+r.firstRun.read+')', r.firstRun.read <= 300 && r.firstRun.read > 200);
ck('还没追上时不弹', r.caughtUpEarly === false);
ck('追上了', r.caughtUpLate === true);
ck('默认不自动续', r.autoByDefault === false);
ck('选了一直继续才自动', r.autoAfterAlways === true);
ck('续 1 次还能续', r.runs1 === 1 && r.autoAt1 === true);
ck('续到上限 2 次就停', r.runs2 === 2 && r.autoAt2 === false && r.cappedAt2 === true);
ck('手动继续把计数清零', r.runsAfterManual === 0);
ck('注入 0 字读到书末', r.endWhenZero);

// 界面：追上之后弹窗
await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const ahead = await import('/src/system/readahead.js');
  ahead.setAlways(i.book, false);
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('theater', `/read/${i.book}`);
}, ids);
await page.waitForTimeout(1000);
ck('阅读页显示它读到哪儿', await page.locator('.ra-line').count() > 0);
await page.screenshot({ path: `${OUT}/ahead1.png` });
ck('追上了会弹窗', await page.getByText('已经看完了').count() > 0);
ck('弹窗有一直继续', await page.getByText('一直继续，不再询问', { exact: true }).count() > 0);
ck('弹窗有先不用', await page.getByText('先不用', { exact: true }).count() > 0);
await page.screenshot({ path: `${OUT}/ahead2.png` });
await page.getByText('先不用', { exact: true }).click(); await page.waitForTimeout(500);
ck('选先不用之后不再弹', await page.getByText('一直继续，不再询问', { exact: true }).count() === 0);

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '先读全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
