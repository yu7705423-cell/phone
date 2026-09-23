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
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  const b = await bookMod.add({ title: '雨城旧事', author: '某人', kind: 'txt',
    text: Array.from({length:40},(_,i)=>`第 ${i} 段。`+'正文内容。'.repeat(30)).join('\n\n'),
    chapters: [{ title: '第一章', start: 0, end: 3000 }, { title: '第二章', start: 3000, end: 99999 }] });
  return { book: b.id, chat: chat.id, char: a.id };
});

const fail = [];
const ck = (n, c) => { if (!c) fail.push(n); };
const open = r => page.evaluate(async ([rt]) => {
  const nav = await import('/src/system/nav.js'); nav.goHome(); nav.openApp('theater', rt);
}, [r]);

await open(`/read/${ids.book}`); await page.waitForTimeout(800);
ck('阅读页打开', await page.locator('.rd-body').count() > 0);

// 翻页动画
const at0 = await page.evaluate(async i => (await import('/src/system/db/index.js')).ebooks.get(i).at, ids.book);
await page.locator('[aria-label="下一页"]').click(); await page.waitForTimeout(600);
const at1 = await page.evaluate(async i => (await import('/src/system/db/index.js')).ebooks.get(i).at, ids.book);
ck('翻页推进了进度', at1 > at0);

// 阅读设置
await page.locator('[aria-label="阅读设置"]').click(); await page.waitForTimeout(500);
ck('阅读设置打得开', await page.getByText('全屏阅读', { exact: true }).count() > 0);
ck('四种翻页方式都在', await page.getByText('淡入淡出', { exact: true }).count() > 0);
await page.getByText('米黄', { exact: true }).click(); await page.waitForTimeout(300);
ck('纸色存下来了', await page.evaluate(async () =>
  (await import('/src/system/reader.js')).get().paper === 'sepia'));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const bg = await page.locator('.rd').evaluate(e => getComputedStyle(e).backgroundColor);
ck('纸色真的用上了 ('+bg+')', bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)');

// 字体链接分流
const font = await page.evaluate(async () => {
  const r = await import('/src/system/reader.js');
  return {
    file: r.isFontFile('https://x.com/a/NotoSerifSC-Regular.woff2'),
    sheet: r.isFontFile('https://fonts.googleapis.com/css2?family=Noto+Serif+SC'),
    guessFile: r.familyFromUrl('https://x.com/a/Noto_Serif-Regular.ttf'),
    guessSheet: r.familyFromUrl('https://fonts.googleapis.com/css2?family=Noto+Serif+SC'),
  };
});
ck('字体文件认得出', font.file === true);
ck('样式表不当成字体文件', font.sheet === false);
ck('字体文件能推出名字 ('+font.guessFile+')', !!font.guessFile);
ck('样式表推不出名字，留给用户填', font.guessSheet === '');

// 全屏
await page.locator('[aria-label="阅读设置"]').click(); await page.waitForTimeout(400);
await page.locator('.switch').first().click(); await page.waitForTimeout(300);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
ck('全屏后顶栏收起', await page.locator('.navbar').count() === 0);
ck('全屏后翻页条收起', await page.locator('.rd-bar').count() === 0);
await page.locator('.rd-tap').click({ position: { x: 215, y: 400 } }); await page.waitForTimeout(400);
ck('点中间唤回顶栏', await page.locator('.navbar').count() > 0);

// 书摘
await page.locator('[aria-label="书摘"]').click(); await page.waitForTimeout(500);
ck('书摘浮层打得开', await page.getByText('摘录', { exact: true }).count() > 0);
await page.locator('textarea').first().fill('天还没亮，车就停了。');
await page.locator('input').last().fill('这一句我记了很久。');
await page.getByText('选择角色并发送', { exact: true }).click(); await page.waitForTimeout(400);
await page.getByText('甲', { exact: true }).first().click(); await page.waitForTimeout(600);
const msg = await page.evaluate(async c => {
  const db = await import('/src/system/db/index.js');
  const m = db.messages.where(x => x.chatId === c && x.kind === 'excerpt')[0];
  return m ? { quote: m.quote, note: m.note, title: m.bookTitle, content: m.content } : null;
}, ids.chat);
ck('书摘发出去了', !!msg && msg.quote === '天还没亮，车就停了。');
ck('书名带上了', msg?.title === '雨城旧事');
ck('正文里有标记，模型看得到', /\[书摘：《雨城旧事》\]/.test(msg?.content || ''));

await page.evaluate(async c => {
  const nav = await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat', `/chat/${c}`);
}, ids.chat);
await page.waitForTimeout(800);
ck('会话里画出了卡片', await page.locator('.xc-card').count() > 0);
await page.screenshot({ path: `${OUT}/xc.png` });

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '阅读设置与书摘全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
