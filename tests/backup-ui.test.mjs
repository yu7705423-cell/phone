// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 走真正的界面：设置 - 存储 -> 导出备份 -> 把下载的文件原样喂回「导入备份」。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// ---- 造数据：二十八个域尽量都沾上，外加真图片 ----
const seeded = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const album = await import('/src/system/album.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设甲' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });

  // 真 PNG 一张
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'); g.fillStyle = '#123456'; g.fillRect(0, 0, 64, 64);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const imgId = await db.images.put(new File([blob], 'a.png', { type: 'image/png' }));

  db.messages.create({ chatId: chat.id, role: 'char', authorId: a.id, kind: 'image',
    imageId: imgId, content: '[图片]', status: 'done' });
  db.memories.create({ charId: a.id, content: '一条记忆', category: 'fact', rank: 'A', keywords: [], personaId: me.id });
  db.lorebooks.create({ name: '世界书', entries: [] });
  db.ebooks.create({ title: '一本书', text: '正文'.repeat(50) });
  db.reviews.create({ subject: `book:x`, charId: a.id, text: '读后感' });
  db.readnotes.create({ chatId: chat.id, at: 0, text: '段评' });
  db.health.create({ who: 'me', date: '2026-09-19', steps: 8000 });
  db.cycles.create({ who: 'me', start: '2026-09-01' });
  db.meds.create({ who: 'me', name: '维生素', times: ['09:00'] });
  const alb = album.createAlbum ? album.createAlbum('相册一') : db.albums.create({ name: '相册一' });
  db.photos.create({ albumId: alb.id || alb, imageId: imgId });
  db.shots.create({ css: '.msg { color: red }' });

  return {
    char: a.id,
    before: Object.fromEntries(['characters','messages','memories','lorebooks','ebooks','reviews',
      'readnotes','health','cycles','meds','albums','photos','shots']
      .map(n => [n, db[n].count()])),
    images: db.images.count(),
  };
});
console.log('造好：', JSON.stringify(seeded.before), 'images', seeded.images);

const go = async (app, route) => {
  await page.evaluate(([app, route]) => import('/src/system/nav.js').then(n => n.openApp(app, route)), [app, route]);
  await page.waitForTimeout(700);
};
const clickRow = async label => page.evaluate(l => {
  const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith(l));
  if (!el) return false; el.click(); return true;
}, label);

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

for (const kind of ['完整备份', '仅数据']) {
  await go('settings', '/storage');
  check(await clickRow('导出备份'), `点开了导出备份（${kind}）`);
  await page.waitForTimeout(400);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    page.evaluate(k => {
      const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith(k));
      el && el.click();
    }, kind),
  ]);
  if (!dl) { fail.push(`${kind}：没有触发下载`); continue; }
  const name = dl.suggestedFilename();
  const path = `${OUT}/${name}`;
  await dl.saveAs(path);
  const { statSync } = await import('node:fs');
  check(true, `${kind} 导出成功：${name}（${statSync(path).size} 字节）`);

  // 清空到底，再导回来
  await page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    for (const n of ['characters','messages','memories','lorebooks','ebooks','reviews',
      'readnotes','health','cycles','meds','albums','photos','shots']) await db[n].clear();
    await Promise.all(db.images.ids().map(id => db.images.remove(id)));
  });
  await page.waitForTimeout(300);

  await go('settings', '/storage');
  await page.setInputFiles('input[type=file][accept*="zip"]', path);
  await page.waitForTimeout(600);
  // 确认框
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.innerText.trim() === '确定')?.click());
  await page.waitForTimeout(3000);
  const toastText = await page.evaluate(() =>
    [...document.querySelectorAll('.toast, .toast-item, [class*=toast]')].map(e => e.innerText).join(' | '));
  const after = await page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    return {
      counts: Object.fromEntries(['characters','messages','memories','lorebooks','ebooks','reviews',
        'readnotes','health','cycles','meds','albums','photos','shots'].map(n => [n, db[n].count()])),
      images: db.images.count(),
    };
  });
  const same = JSON.stringify(after.counts) === JSON.stringify(seeded.before);
  check(same, `${kind} 导回来行数对得上 ${same ? '' : JSON.stringify(after.counts)}`);
  if (name.endsWith('.zip')) check(after.images === seeded.images, `${kind} 图片也回来了（${after.images}）`);
  check(!/失败|不能导入/.test(toastText), `${kind} 没有失败提示：${toastText || '(没抓到 toast)'}`);
}

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 15).join('\n'));
await browser.close();
process.exit(fail.length ? 1 : 0);
