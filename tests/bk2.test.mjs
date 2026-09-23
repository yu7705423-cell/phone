import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

const r = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const backup = await import('/src/system/backup.js');
  const out = {};

  // 每个新数据域都种一条
  const a = db.characters.create({ name: '甲', persona: '人设甲' });
  const chat = db.chats.create({ characterIds: [a.id] });
  db.messages.create({ chatId: chat.id, role: 'user', kind: 'text', content: '嗨', status: 'done' });
  const bookMod = await import('/src/system/book.js');
  const ebk = await bookMod.add({ title: '雨城旧事', kind: 'txt', text: '正文内容' });
  db.reviews.create({ kind: 'book', subjectId: ebk.id, charId: a.id, text: '一篇书评' });
  const para = await import('/src/system/paracomment.js');
  para.add({ subject: para.subjectOf(para.BOOK, ebk.id), at: 0, text: '一条段评', authorName: '甲' });
  const hl = await import('/src/system/health.js');
  hl.set(hl.ME, hl.dateKey(), { steps: 8000 });
  hl.startCycle(hl.dateKey());
  hl.addMed({ name: '维生素 D', times: ['08:00'] });
  const alb = await import('/src/system/album.js');
  const book1 = alb.createAlbum('她发的图');
  const png = await new Promise(res => {
    const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8;
    cv.getContext('2d').fillRect(0, 0, 8, 8); cv.toBlob(res, 'image/png');
  });
  const imgId = await db.images.put(new File([png], 'x.png', { type: 'image/png' }));
  alb.saveImage({ imageId: imgId, albumId: book1.id });
  await alb.saveCard({ msgs: alb.freeze([{ id: 'm', role: 'char', authorId: a.id,
    kind: 'text', content: '卡片里这一条', createdAt: 1 }], {}), css: '.bubble{border-radius:2px}' });

  const snap = () => ({
    ebooks: db.ebooks.count(), reviews: db.reviews.count(), readnotes: db.readnotes.count(),
    health: db.health.count(), cycles: db.cycles.count(), meds: db.meds.count(),
    albums: db.albums.count(), photos: db.photos.count(), shots: db.shots.count(),
    chars: db.characters.count(), images: db.images.count(),
  });
  out.before = snap();

  const blob = await backup.build({ media: true });
  const { unzip } = await import('/src/system/zip.js');
  const parsed = JSON.parse(await (await unzip(blob)).get('backup.json').text());
  out.inJson = Object.fromEntries(['ebooks','reviews','readnotes','health','cycles','meds','albums','photos','shots']
    .map(k => [k, (parsed[k] || []).length]));

  // 清空到底，再导回来
  for (const n of ['characters','chats','messages','ebooks','reviews','readnotes',
    'health','cycles','meds','albums','photos','shots']) await db[n].clear();
  for (const id of [...db.images.ids()]) await db.images.remove(id);
  out.wiped = snap();

  await backup.restore(new File([blob], 'b.zip', { type: 'application/zip' }));
  out.after = snap();
  // 卡片上那份美化 CSS 也得回来
  const card = db.photos.all().find(p => p.kind === 'card');
  out.cssBack = card ? alb.shotCss(card.shotId) : '';
  return out;
});

ck('清空确实清干净了', r.wiped.ebooks === 0 && r.wiped.photos === 0 && r.wiped.health === 0);
for (const k of Object.keys(r.inJson)) {
  ck(`${k} 进了备份 (${r.inJson[k]})`, r.inJson[k] > 0);
  ck(`${k} 恢复回来了 (${r.before[k]} -> ${r.after[k]})`, r.after[k] === r.before[k]);
}
ck('图片也回来了', r.after.images === r.before.images);
ck('卡片的美化 CSS 跟着回来了', r.cssBack === '.bubble{border-radius:2px}');

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '备份往返全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
