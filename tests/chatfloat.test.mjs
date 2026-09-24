// 聊天背景第二步：栏不是实色时，消息从栏底下滚过去（ARCHITECTURE 4.198）。
//
// 顶栏与输入栏那一组浮在消息列表上，列表上下各留出栏的高度：
//   最新一条贴底时露在输入栏上面；翻到最上面时第一条露在顶栏下面；
//   输入栏那一组变高（展开面板）时，本来贴着底部的跟着贴住。
// 实色照旧排在列表外面。
import { BASE, EXE, OUT, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const chatId = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  for (let i = 1; i <= 40; i++) {
    db.messages.create({ chatId: chat.id, role: i % 2 ? 'user' : 'char', authorId: i % 2 ? 'me' : c.id,
      kind: 'text', content: `第${i}条`, status: 'done' });
  }
  return chat.id;
});
const setLook = look => page.evaluate(async ([id, l]) => (await import('/src/system/db/index.js')).db.chats.update(id, { look: l }), [chatId, look]);
const open = async () => {
  await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', `/chat/${id}`); }, chatId);
  await page.waitForTimeout(900);
};
const geo = () => page.evaluate(() => {
  const r = s => document.querySelector(s)?.getBoundingClientRect();
  const pg = document.querySelector('.app-layer > .page');
  const msgs = [...document.querySelectorAll('.conv-body .msg')];
  const box = el => el.getBoundingClientRect();
  return { cls: pg.className, navB: r('.app-layer > .page > .navbar').bottom, bodyT: r('.conv-body').top, bodyB: r('.conv-body').bottom,
    footT: r('.conv-foot').top, footB: r('.conv-foot').bottom,
    lastB: box(msgs[msgs.length - 1]).bottom, firstT: box(msgs[0]).top };
});

// ---- 实色：照旧 ----
await setLook({ top: { style: 'solid', color: '#1C1C1E', fg: 'light' } });
await open();
let g = await geo();
ok('实色：不浮', !/float-/.test(g.cls), g.cls);
ok('实色：列表从顶栏下面开始、到输入栏上面结束', g.bodyT >= g.navB - 1 && g.bodyB <= g.footT + 1, JSON.stringify(g));

// ---- 毛玻璃：浮 ----
await setLook({ top: { style: 'glass' } });
await open();
g = await geo();
ok('毛玻璃：顶栏与输入栏都浮在列表上', /float-top/.test(g.cls) && /float-bottom/.test(g.cls), g.cls);
ok('列表一直伸到顶栏底下', g.bodyT < g.navB - 10, JSON.stringify(g));
ok('列表一直伸到输入栏底下', g.bodyB > g.footT + 10, JSON.stringify(g));
ok('贴着底部时：最新一条露在输入栏上面', g.lastB <= g.footT + 1, JSON.stringify(g));
await page.screenshot({ path: `${OUT}/chatfloat-bottom.png` });

await page.evaluate(() => { document.querySelector('.conv-body').scrollTop = 0; });
await page.waitForTimeout(300);
g = await geo();
ok('翻到最上面：第一条露在顶栏下面', g.firstT >= g.navB - 1, JSON.stringify(g));

// 展开面板：输入栏那一组变高，贴着底部的跟着贴住
await page.evaluate(() => { const b = document.querySelector('.conv-body'); b.scrollTop = b.scrollHeight; });
await page.waitForTimeout(300);
await page.locator('.composer-bar .composer-side').first().click();
await page.waitForTimeout(600);
g = await geo();
ok('展开面板后：面板在', await page.locator('.composer-panel').count() === 1);
ok('展开面板后：最新一条仍露在输入栏那一组上面', g.lastB <= g.footT + 1, JSON.stringify(g));
await page.screenshot({ path: `${OUT}/chatfloat-panel.png` });

// 只有下面浮：分开设置，上面实色
await page.locator('.composer-bar .composer-side').first().click();
await setLook({ split: true, top: { style: 'solid', color: '#1C1C1E' }, bottom: { style: 'clear', alpha: 40 } });
await page.waitForTimeout(400);
g = await geo();
ok('分开设置：只有输入栏那一组浮', !/float-top/.test(g.cls) && /float-bottom/.test(g.cls) && g.bodyT >= g.navB - 1, g.cls);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
