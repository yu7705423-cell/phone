// 引用掉格式（reply.quoteOfLine、engine.withQuote，ARCHITECTURE 4.211），外加主屏图标名称的颜色。
//
//   从前只认整行、摘录里不许有括号的 [引用：…]；历史里还把引用写成 (in reply to 「…」)，
//   模型照着抄回来，解析不认，括号原样漏进气泡，「修正格式」也修不动
//   现在认得宽：摘录里有（动作）、标记和正文同一行、(in reply to 「…」)、【引用】「…」、> 摘录；
//   历史里写成和要它写的一样的 [引用：…]；旧消息里掉了格式的，「修正格式」能修回来
//
//   图标名称颜色：外观里选一个颜色，写到 --ph-tile-name-color，有没有壁纸都用它
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const P = raw => page.evaluate(async raw => (await import('/src/system/ai/reply.js')).splitReply(raw)
  .map(p => ({ q: p.quote || '', t: p.text || '', type: p.type })), raw);

let r = await P('[引用：（摸摸头）好乖]\n嗯');
ok('摘录里有（动作）：认得出', r.length === 1 && r[0].q === '（摸摸头）好乖' && r[0].t === '嗯', JSON.stringify(r));
r = await P('[引用：你说的那句] 好啊');
ok('标记和正文写在同一行：拆开', r.length === 1 && r[0].q === '你说的那句' && r[0].t === '好啊', JSON.stringify(r));
r = await P('(in reply to 「今天下雨了」) 是啊');
ok('照着旧历史写的 (in reply to 「…」)：认得出', r.length === 1 && r[0].q === '今天下雨了' && r[0].t === '是啊', JSON.stringify(r));
r = await P('【引用】「今天下雨了」\n是啊');
ok('【引用】「…」没有冒号：认得出', r.length === 1 && r[0].q === '今天下雨了' && r[0].t === '是啊', JSON.stringify(r));
r = await P('> 今天下雨了\n是啊');
ok('> 摘录：认得出', r.length === 1 && r[0].q === '今天下雨了' && r[0].t === '是啊', JSON.stringify(r));
r = await P('[引用：「今天下雨了」]\n是啊');
ok('摘录外面多包了「」：剥掉', r[0]?.q === '今天下雨了', JSON.stringify(r));
r = await P('>_< 好害羞');
ok('>_< 这种颜文字不当引用', r.length === 1 && !r[0].q && r[0].t === '>_< 好害羞', JSON.stringify(r));
r = await P('（回复得很快）');
ok('正文里的「（回复…）」不当引用', r.length === 1 && !r[0].q && r[0].t === '（回复得很快）', JSON.stringify(r));
r = await P('[引用：今天下雨了]\n是啊，一整天。');
ok('标准写法照旧', r.length === 1 && r[0].q === '今天下雨了' && r[0].t === '是啊，一整天。', JSON.stringify(r));

// 认领出处：摘录尾巴上带省略号也认得出
const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const src = db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '今天下雨了，一整天都没停', status: 'done', createdAt: Date.now() - 9000 });
  return { char: c.id, chat: chat.id, src: src.id };
});
const rq = await page.evaluate(async ({ chat }) => (await import('/src/system/ai/reply.js')).quoteFields(chat, '「今天下雨了，一整天…」'), ids);
ok('摘录带引号和省略号：照样认领到原话', rq.quoteId === ids.src, JSON.stringify(rq));

// ---- 历史里写成 [引用：…] ----
const hist = await page.evaluate(async ({ chat, char, src }) => {
  const { db } = await import('/src/system/db/index.js');
  const reply = await import('/src/system/ai/reply.js');
  const engine = await import('/src/system/ai/engine.js');
  db.messages.create({ chatId: chat, role: 'char', authorId: char, kind: 'text', content: '是啊', status: 'done',
    ...reply.quoteFields(chat, '今天下雨了'), createdAt: Date.now() - 8000 });
  return engine.buildHistory(db.chats.get(chat), db.characters.get(char), db.messagesOf(chat))
    .filter(m => m.role === 'assistant').map(m => m.content).join('\n');
}, ids);
ok('历史里角色引用过的那条写成 [引用：…] 单独一行', /^\[引用：今天下雨了[^\]]*\]\n是啊/m.test(hist) && !/in reply to/.test(hist), hist);

// ---- 旧消息：修正格式修得回来 ----
const fixed = await page.evaluate(async ({ chat, char, src }) => {
  const { db } = await import('/src/system/db/index.js');
  const repair = await import('/src/system/ai/repair.js');
  const bad = db.messages.create({ chatId: chat, role: 'char', authorId: char, kind: 'text', turnId: 'old1',
    content: '(in reply to 「今天下雨了」) 带伞了吗', status: 'done', createdAt: Date.now() - 5000 });
  const fixes = repair.fixesFor(bad).map(f => f.id);
  repair.applyFix(bad.id, 'rows');
  const now = db.messagesOf(chat).find(m => m.content === '带伞了吗');
  return { fixes, content: now?.content, quoteId: now?.quoteId };
}, ids);
ok('旧消息掉了格式：修正格式里列出「按标记重新整理」', fixed.fixes.includes('rows'), JSON.stringify(fixed));
ok('修完：正文干净，引用认领到原话', fixed.content === '带伞了吗' && fixed.quoteId === ids.src, JSON.stringify(fixed));

// ---- 图标名称颜色 ----
const nameColor = () => page.evaluate(() => getComputedStyle(document.querySelector('.home .app-name')).color);
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); });
await page.waitForTimeout(600);
const before = await nameColor();
await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ iconLabelColor: '#ff0000' }));
await page.waitForTimeout(400);
ok('外观里选了颜色：主屏图标名称换成它', (await nameColor()) === 'rgb(255, 0, 0)', await nameColor());
await page.evaluate(() => { document.documentElement.dataset.wallpaper = 'on'; });
await page.waitForTimeout(100);
ok('有壁纸时同样用选的颜色', (await nameColor()) === 'rgb(255, 0, 0)', await nameColor());
await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ iconLabelColor: '' }));
await page.waitForTimeout(400);
ok('选回「自动」：有壁纸是白色', (await nameColor()) === 'rgb(255, 255, 255)', await nameColor());
await page.evaluate(() => { document.documentElement.dataset.wallpaper = 'off'; });
await page.waitForTimeout(100);
ok('选回「自动」：没壁纸回到原来的颜色', (await nameColor()) === before, `${await nameColor()} / ${before}`);
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.openApp('settings', '/appearance'); });
await page.waitForTimeout(800);
ok('外观页里有「图标名称颜色」', /图标名称颜色/.test(await page.locator('.app-layer').innerText()));
await page.locator('[aria-label="名称颜色 #6B6B6B"]').click();
await page.waitForTimeout(300);
ok('点一个色块就存上', await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.get().iconLabelColor) === '#6B6B6B');

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
