// 朋友圈评论表被底部标签栏压住（ARCHITECTURE 4.205）。
//
// iPhone 上可滚动的那一块自成一层，表写在朋友圈页面里面，z-index 再高也盖不过
// 后面的标签栏 —— 图标就画在了输入框上。现在浮层渲染到应用层的最后面（ui/overlay.js 的 Portal），
// 不在任何滚动容器里；输入框也挪到表的最上面，键盘起来只盖得住下半截。
// 电脑上的 Chromium 不会叠错，所以这里查的是浮层挂在哪儿，而不是截图。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ autoFullscreen: false });
  const c = db.characters.create({ name: '阿岚' });
  for (let i = 0; i < 8; i++) {
    db.moments.create({ authorId: c.id, text: `角色的动态 ${i}`, images: [], likes: [],
      comments: i === 6 ? [{ id: 'k1', authorId: c.id, text: '先前的一条评论', createdAt: Date.now() }] : [], createdAt: Date.now() - i * 60000 });
  }
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', '/moments');
});
await page.waitForTimeout(1000);
const card = page.locator('.mo-card', { hasText: '角色的动态 6' });
await card.scrollIntoViewIfNeeded();
await card.locator('.mo-act').nth(1).tap();
await page.waitForTimeout(700);
const g = await page.evaluate(() => {
  const r = s => document.querySelector(s)?.getBoundingClientRect();
  return { input: r('.sheet textarea')?.top, list: r('.sheet .mo-comment-list')?.top, h: innerHeight };
});
const where = await page.evaluate(() => {
  const o = document.querySelector('.overlay');
  const layer = document.querySelector('.app-layer');
  return {
    tabs: !!document.querySelector('.tabbar'),
    inScroll: !!o?.parentElement?.closest('.page-body, .scroll'),
    last: !!layer?.lastElementChild?.classList.contains('sheet-host') && layer.lastElementChild.contains(o),
  };
});
ok('朋友圈这一页有底部标签栏', where.tabs, JSON.stringify(where));
ok('评论表不在滚动容器里面', where.inScroll === false, JSON.stringify(where));
ok('评论表挂在应用层的最后面，叠在标签栏上面', where.last, JSON.stringify(where));
ok('输入框在上半屏，键盘盖不到', g.input < g.h * 0.45, JSON.stringify(g));
ok('已有的评论排在输入框下面', g.list > g.input, JSON.stringify(g));
await page.locator('.sheet textarea').fill('这条写得出来');
await page.locator('.sheet .send-btn').tap();
await page.waitForTimeout(600);
const got = await page.evaluate(async () => (await import('/src/system/db/index.js')).db.moments.all()
  .find(m => m.text === '角色的动态 6').comments.map(c => c.text));
ok('发得出评论', got.includes('这条写得出来'), JSON.stringify(got));

// 关掉之后占位与容器一起收掉
await page.locator('.overlay').click({ position: { x: 215, y: 160 } });
await page.waitForTimeout(400);
ok('关掉之后浮层与容器都不留', await page.evaluate(() => !document.querySelector('.overlay') && !document.querySelector('.sheet-host')));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
