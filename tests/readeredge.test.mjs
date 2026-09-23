// 阅读器右三分之一是「点一下翻下一页」。右边缘那一划会不会顺带翻页？
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
const cdp = await page.context().newCDPSession(page);
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const bookMod = await import('/src/system/book.js');
  // 得足够长，翻一页才动得起来 —— 短文本翻到头就不动了，那样的检查是空的
  const body = Array.from({ length: 400 }, (_, i) => `这是第 ${i} 句，天还没亮，车就停了，站台上一个人也没有。`).join('');
  const ebk = await bookMod.add({
    title: '雨城旧事', author: '某人', kind: 'txt',
    text: `第一章 到站\n${body}\n\n第二章 旅馆\n${body}`,
    chapters: [{ title: '第一章 到站', start: 0, end: body.length + 6 },
      { title: '第二章 旅馆', start: body.length + 6, end: body.length * 2 + 14 }],
  });
  bookMod.setAt(ebk.id, 10);
  return { ebook: ebk.id };
});

const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function swipe(x0, y0, x1, y1, steps = 12, holdMs = 12) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
    await page.waitForTimeout(holdMs);
  }
  await touch('touchEnd', x1, y1);
  await page.waitForTimeout(600);
}
const go = async (app, route) => {
  await page.evaluate(([app, route]) => import('/src/system/nav.js').then(n => n.openApp(app, route)), [app, route]);
  await page.waitForTimeout(700);
};
const state = () => page.evaluate(async () => {
  const { nav } = await import('/src/system/nav.js');
  const s = nav.get();
  return { stack: s.appId ? s.stacks[s.appId] : null };
});
const at = () => page.evaluate(async ([id]) =>
  (await import('/src/system/book.js')).get(id)?.at ?? -1, [ids.ebook]);

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

const W = 430;
await go('theater', `/read/${ids.ebook}`);
const before = await state();
const posBefore = await at();
check(before.stack.slice(-1)[0].startsWith('/read/'), `在阅读器里（${before.stack.slice(-1)[0]}）`);

// 从右边缘往左划：应该退出阅读器，且不翻页
await swipe(W - 5, 500, 110, 505);
const after = await state();
const posAfter = await at();
check(!after.stack.slice(-1)[0].startsWith('/read/'),
  `右边缘左滑退出了阅读器（${after.stack.slice(-1)[0]}）`);
check(posAfter === posBefore, `没顺带翻页（进度 ${posBefore} -> ${posAfter}）`);

// 点右三分之一仍然翻页，没被这个手势吃掉
await go('theater', `/read/${ids.ebook}`);
const p0 = await at();
await page.touchscreen.tap(350, 500);
await page.waitForTimeout(700);
const p1 = await at();
check(p1 !== p0, `点右三分之一照样翻页（${p0} -> ${p1}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
