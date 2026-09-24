import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const fail = [], ok = [];
const check = (c, m) => { (c ? ok : fail).push((c ? '  ok   ' : '  FAIL ') + m);
  console.log((c ? '  ok   ' : '  FAIL ') + m); };

async function boot(native) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  // 外壳是在文档一开始就注入这个标记的，所以用 initScript 模拟
  if (native) await ctx.addInitScript(() => { window.phoneNativeBack = true; });
  const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
  page.on('pageerror', e => fail.push('PAGEERROR ' + e.message));
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const ids = await page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    const acc = await import('/src/system/accounts.js');
    const me = acc.roots()[0] || acc.createRoot({ name: '我' });
    const a = db.characters.create({ name: '甲' });
    const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
    db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '嗨', status: 'done' });
    return { chat: chat.id };
  });
  return { ctx, page, cdp, ids };
}
const state = page => page.evaluate(async () => {
  const { nav } = await import('/src/system/nav.js');
  const s = nav.get();
  return { screen: s.screen, stack: s.appId ? s.stacks[s.appId] : null,
    sheet: !!document.querySelector('.fullsheet'), switcher: s.switcher };
});
async function swipe(cdp, page, x0, y0, x1, y1) {
  const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await t('touchStart', x0, y0);
  for (let i = 1; i <= 12; i++) { await t('touchMove', x0 + (x1 - x0) * i / 12, y0); await page.waitForTimeout(12); }
  await t('touchEnd', x1, y1);
  await page.waitForTimeout(700);
}
const go = (page, r) => page.evaluate(([r]) =>
  import('/src/system/nav.js').then(n => n.openApp('chat', r)), [r]).then(() => page.waitForTimeout(600));

// ---- 没有外壳：网页那套照旧 ----
{
  const { ctx, page, cdp, ids } = await boot(false);
  await go(page, `/chat/${ids.chat}`);
  await swipe(cdp, page, 5, 500, 320, 500);
  const st = await state(page);
  check((st.stack || ['(已退到主屏)']).slice(-1)[0] === '/', `没有外壳时网页那套照旧：${JSON.stringify(st.stack)}`);
  // 起手区放宽到 40 了
  await go(page, `/chat/${ids.chat}`);
  await swipe(cdp, page, 34, 500, 340, 500);
  check((await state(page)).stack.slice(-1)[0] === '/', '起手 34px 也接得住（原来 24px 以外就不接）');
  await ctx.close();
}

// ---- 外壳接管：网页那套让开，改由 window.phoneBack ----
{
  const { ctx, page, cdp, ids } = await boot(true);
  await go(page, `/chat/${ids.chat}`);
  check(await page.evaluate(() => typeof window.phoneBack === 'function'), 'window.phoneBack 挂上去了');
  await swipe(cdp, page, 5, 500, 320, 500);
  let st = await state(page);
  check((st.stack || ['(已退到主屏)']).slice(-1)[0].startsWith('/chat/'), '外壳接管时网页那套不再自己退，让开了');

  // 原生手势识别之后就是调它
  await page.evaluate(() => window.phoneBack());
  await page.waitForTimeout(500);
  st = await state(page);
  check((st.stack || ['(已退到主屏)']).slice(-1)[0] === '/', `phoneBack 退了一级：${JSON.stringify(st.stack)}`);

  // 优先级：浮层开着先关浮层
  await go(page, `/chat/${ids.chat}`);
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '更多')?.click());
  await page.waitForTimeout(400);
  check((await state(page)).sheet, '菜单开着');
  await page.evaluate(() => window.phoneBack());
  await page.waitForTimeout(500);
  st = await state(page);
  check(!st.sheet && (st.stack || ['(已退到主屏)']).slice(-1)[0].startsWith('/chat/'), 'phoneBack 先关浮层，路由不动');

  // 优先级：页内返回（多选）
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '更多')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.fullsheet .list-item')]
    .find(e => e.innerText.startsWith('多选消息'))?.click());
  await page.waitForTimeout(600);
  check(await page.evaluate(() => /已选|全选/.test(document.body.innerText)), '进了多选');
  await page.evaluate(() => window.phoneBack());
  await page.waitForTimeout(500);
  st = await state(page);
  check(!(await page.evaluate(() => /已选|全选/.test(document.body.innerText)))
    && (st.stack || ['(已退到主屏)']).slice(-1)[0].startsWith('/chat/'),
  'phoneBack 走这一页自己的返回：退出多选，不退路由');

  // 优先级：多任务开着先关多任务
  await page.evaluate(() => import('/src/system/nav.js').then(n => n.setSwitcher(true)));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.phoneBack());
  await page.waitForTimeout(400);
  check(!(await state(page)).switcher, 'phoneBack 先关多任务');

  // 给回有没有退（安卓外壳据此决定要不要把应用切到后台）
  const inApp = await page.evaluate(() => window.phoneBack());
  check(inApp === true, `在应用里：退了一级，给回 true（${inApp}）`);
  await page.evaluate(() => import('/src/system/nav.js').then(n => n.goHome()));
  await page.waitForTimeout(400);
  const atHome = await page.evaluate(() => window.phoneBack());
  check(atHome === false, `在桌面：无处可退，给回 false（${atHome}）`);
  await ctx.close();
}

console.log('\n合计 ' + ok.length + ' 过，' + fail.length + ' 挂');
await browser.close();
process.exit(fail.length ? 1 : 0);
