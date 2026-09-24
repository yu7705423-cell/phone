import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });

const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

async function boot(page) {
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    const acc = await import('/src/system/accounts.js');
    const videoMod = await import('/src/system/video.js');
    const watch = await import('/src/system/watch.js');
    const me = acc.roots()[0] || acc.createRoot({ name: '我' });
    const a = db.characters.create({ name: '甲' });
    const chat = db.chats.create({ characterIds: [a.id], personaId: me.id });
    const v = videoMod.addVideo({ title: '雨城', url: 'https://example.com/a.mp4',
      subtitle: '1\n00:00:00,000 --> 00:00:30,000\n天还没亮。\n' });
    watch.start({ chatId: chat.id, videoId: v.id });
    const nav = await import('/src/system/nav.js');
    nav.goHome(); nav.openApp('theater', `/watch/${chat.id}`);
    return chat.id;
  });
}
const box = page => page.locator('.wt-rot').evaluate(e => ({
  w: Math.round(e.offsetWidth), h: Math.round(e.offsetHeight),
  rotated: /matrix/.test(getComputedStyle(e).transform) &&
    getComputedStyle(e).transform !== 'none',
}));

// ---- 竖屏的手机 ----
const p1 = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
p1.on('pageerror', e => fail.push('PAGEERROR ' + e.message));
await boot(p1);
const before = await box(p1);
ck('没全屏时不转 ' + JSON.stringify(before), !before.rotated);
await p1.locator('[aria-label="全屏"]').click(); await p1.waitForTimeout(500);
const after = await box(p1);
const stage = await p1.locator('.wt-stage').evaluate(e => ({ w: e.clientWidth, h: e.clientHeight }));
ck('竖屏手机全屏后转过来了 ' + JSON.stringify(after), after.rotated);
ck(`转后宽=舞台高 (${after.w} vs ${stage.h})`, Math.abs(after.w - stage.h) <= 2);
ck(`转后高=舞台宽 (${after.h} vs ${stage.w})`, Math.abs(after.h - stage.w) <= 2);
await p1.screenshot({ path: `${OUT}/land.png` });

// 切回竖屏。横竖不再是一个开关，而是左转 / 右转两个键，
// 已经转到那一边时再点一下就转回竖屏（watchRotate 存的是角度）
await p1.locator('.wt-video').click({ position: { x: 100, y: 200 } }); await p1.waitForTimeout(400);
await p1.locator('[aria-label="转回竖屏"]').click(); await p1.waitForTimeout(500);
const off = await box(p1);
ck('切回竖屏就不转了 ' + JSON.stringify(off), !off.rotated);
ck('这个选择记下来了', await p1.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.get().watchRotate === 0));
await p1.locator('[aria-label="向右转"]').click(); await p1.waitForTimeout(400);
ck('能再转过去', (await box(p1)).rotated);
ck('转的是另一边', await p1.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.get().watchRotate === -90));
// 返回键模式（默认）下，左上角的悬浮返回键就是「退出全屏」：退出全屏，不离开这一页
await p1.locator('.navback').click(); await p1.waitForTimeout(400);
ck('按返回：退出全屏，还在放映页', await p1.locator('.wt-stage').count() === 1);
ck('退出全屏后不转', !(await box(p1)).rotated);
ck('退出后顶栏回来', await p1.locator('.navbar').count() > 0);

// ---- 本来就横着拿的手机：不该再转一次 ----
const p2 = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2 });
p2.on('pageerror', e => fail.push('PAGEERROR ' + e.message));
await boot(p2);
await p2.locator('[aria-label="全屏"]').click(); await p2.waitForTimeout(500);
const land = await box(p2);
ck('手机已横屏时不再转 ' + JSON.stringify(land), !land.rotated);
ck('横屏时画面撑满', land.w > 900);

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '横屏全部通过');
await browser.close();
process.exit(fail.length ? 1 : 0);
