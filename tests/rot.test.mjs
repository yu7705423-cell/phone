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
// 旋转矩阵：rotate(90) -> matrix(0,1,-1,0,..)；rotate(-90) -> matrix(0,-1,1,0,..)
const spin = page => page.locator('.wt-rot').evaluate(e => {
  const t = getComputedStyle(e).transform;
  if (!t || t === 'none') return 0;
  const [a, b] = t.replace(/matrix\(|\)/g, '').split(',').map(Number);
  return Math.round(Math.atan2(b, a) * 180 / Math.PI);
});

const p = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
p.on('pageerror', e => fail.push('PAGEERROR ' + e.message));
await boot(p);
await p.locator('[aria-label="全屏"]').click(); await p.waitForTimeout(500);
ck('默认向左转 (' + await spin(p) + '°)', await spin(p) === 90);

await p.locator('.wt-video').click({ position: { x: 100, y: 200 } }); await p.waitForTimeout(400);
ck('左键点亮着', await p.locator('[aria-label="转回竖屏"]').count() === 1);
ck('右键在', await p.locator('[aria-label="向右转"]').count() === 1);

await p.locator('[aria-label="向右转"]').click(); await p.waitForTimeout(400);
ck('切到向右转 (' + await spin(p) + '°)', await spin(p) === -90);
ck('设置存下来了', await p.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.get().watchRotate === -90));

await p.locator('[aria-label="转回竖屏"]').click(); await p.waitForTimeout(400);
ck('再点同一个键转回竖屏 (' + await spin(p) + '°)', await spin(p) === 0);
await p.locator('[aria-label="向左转"]').click(); await p.waitForTimeout(400);
ck('再点左键又转回去 (' + await spin(p) + '°)', await spin(p) === 90);
await p.screenshot({ path: `${OUT}/rot.png` });

// 两个方向的盒子都该是对调过的
const b = await p.locator('.wt-rot').evaluate(e => ({ w: e.offsetWidth, h: e.offsetHeight }));
const st = await p.locator('.wt-stage').evaluate(e => ({ w: e.clientWidth, h: e.clientHeight }));
ck('宽高确实对调了', Math.abs(b.w - st.h) <= 2 && Math.abs(b.h - st.w) <= 2);

// 老设置折过来：没有 watchRotate、只有 watchLandscape 时，界面要按老的来
const drop = async v => p.evaluate(async land => {
  const db = await import('/src/system/db/index.js');
  const cur = { ...db.settings.get() };
  delete cur.watchRotate;
  db.settings.replace({ ...cur, watchLandscape: land });
}, v);
await drop(false); await p.waitForTimeout(400);
ck('老设置 false -> 不转 (' + await spin(p) + '°)', await spin(p) === 0);
await drop(true); await p.waitForTimeout(400);
ck('老设置 true -> 向左转 (' + await spin(p) + '°)', await spin(p) === 90);
await p.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.set({ watchRotate: 90 }));

// 横着拿的手机不再转
const p2 = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2 });
p2.on('pageerror', e => fail.push('PAGEERROR ' + e.message));
await boot(p2);
await p2.locator('[aria-label="全屏"]').click(); await p2.waitForTimeout(500);
ck('手机已横屏时两个方向都不转 (' + await spin(p2) + '°)', await spin(p2) === 0);

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '两个方向全部通过');
await browser.close();
process.exit(fail.length ? 1 : 0);
