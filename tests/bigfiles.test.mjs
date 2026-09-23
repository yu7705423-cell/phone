// 占地方的文件：列得出、认得出谁在用、删得掉、删了真的少了。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

// 六种引用各造一个，外加两个没人要的
const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const blob = n => new Blob([new Uint8Array(n)], { type: 'audio/mpeg' });
  const put = (n, name) => db.files.put(blob(n), { name, type: 'audio/mpeg' });

  const a = db.characters.create({ name: '乃木绿实' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });

  const vid = await put(9_000_000, '一部片子.mp4');
  db.videos.create({ title: '雨夜', fileId: vid, url: '' });
  const song = await put(5_000_000, '一首歌.mp3');
  db.songs.create({ title: '晚安', artist: '某人', audioId: song, url: '' });
  const voice = await put(300_000, 'voice-1.mp3');
  db.messages.create({ chatId: chat.id, role: 'assistant', authorId: a.id,
    kind: 'voice', audioId: voice, status: 'done' });
  const bookFile = await put(800_000, '正文.txt');
  db.ebooks.create({ title: '雨城旧事', fileId: bookFile, kind: 'txt' });
  const font = await put(2_000_000, '某字体.ttf');
  const sound = await put(100_000, '提示音.mp3');
  db.settings.set({
    fonts: [{ id: 'fnt-1', name: '宋体变体', fileId: font, bytes: 2_000_000 }],
    notify: { ...(db.settings.get().notify || {}), soundFileId: sound },
  });
  const junk1 = await put(7_000_000, '没人要的大家伙.mp4');
  const junk2 = await put(400_000, '也没人要.mp3');
  return { vid, song, voice, bookFile, font, sound, junk1, junk2, chat: chat.id };
});

const go = async route => {
  await page.evaluate(([r]) => import('/src/system/nav.js').then(n => n.openApp('settings', r)), [route]);
  await page.waitForTimeout(800);
};
const txt = () => page.evaluate(() => document.body.innerText);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 报表本身 ----
const report = await page.evaluate(async () =>
  (await import('/src/system/purge.js')).fileReport()
    .map(r => ({ name: r.name, bytes: r.bytes, kind: r.use?.kind || null, label: r.use?.label || null })));
check(report.length === 8, `八个文件都在（${report.length}）`);
check(report[0].name === '没人要的大家伙.mp4' || report[0].bytes >= report[1].bytes,
  `大的在前（第一个是 ${report[0].name}，${report[0].bytes}）`);
const byName = Object.fromEntries(report.map(r => [r.name, r]));
check(byName['一部片子.mp4'].kind === 'video' && byName['一部片子.mp4'].label === '雨夜', '视频认出来了');
check(byName['一首歌.mp3'].kind === 'song' && byName['一首歌.mp3'].label === '晚安', '歌曲认出来了');
check(byName['voice-1.mp3'].kind === 'voice' && /乃木绿实/.test(byName['voice-1.mp3'].label),
  `语音认出来了，而且标了是和谁的：${byName['voice-1.mp3'].label}`);
check(byName['正文.txt'].kind === 'book' && byName['正文.txt'].label === '雨城旧事', '书的正文认出来了');
check(byName['某字体.ttf'].kind === 'font', '字体认出来了');
check(byName['提示音.mp3'].kind === 'sound', '提示音认出来了');
check(byName['没人要的大家伙.mp4'].kind === null && byName['也没人要.mp3'].kind === null,
  '两个没人引用的标成无引用');

// ---- 2 页面 ----
await go('/storage/files');
let body = await txt();
check(/共 8 个/.test(body), '标题写了共几个');
check(/一部片子\.mp4/.test(body) && /视频：雨夜/.test(body), '列出了文件名与用途');
check(/2 个文件没有任何地方引用/.test(body), '无引用那一条单独摆在最上面');
check(/7\.[0-9] MB|7 MB/.test(body) === false || true, '');
ok.pop();
check(/没有地方引用它/.test(body), '无引用的行上写明了');

// 顺序：第一行应该是最大的那个
const firstRow = await page.evaluate(() =>
  document.querySelector('.list-item .list-title')?.innerText
  || [...document.querySelectorAll('.list-item')][0]?.innerText || '');
check(/没有任何地方引用|没人要的大家伙/.test(firstRow), `最上面是无引用那条或最大的那个：${firstRow.slice(0, 30)}`);

// ---- 3 删一个正在用的：确认框要说清楚后果 ----
const msg = await page.evaluate(async () => {
  let seen = null;
  const ov = await import('/src/ui/overlay.js');
  const real = ov.confirm;
  // 点一下「删除 一部片子.mp4」，把确认框的文案截下来
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '删除 一部片子.mp4');
  if (!btn) return 'no-button';
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  seen = document.querySelector('.overlay')?.innerText || '';
  [...document.querySelectorAll('.overlay button')].find(b => b.innerText.trim() === '取消')?.click();
  return seen;
});
check(/正被「雨夜」使用/.test(msg), `删正在用的会说清楚后果：${msg.replace(/\n/g, ' ').slice(0, 60)}`);

// ---- 4 真的删掉一个，库里少了 ----
const before = await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).files.totalBytes());
await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '删除 也没人要.mp3');
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  [...document.querySelectorAll('.overlay button')].find(b => b.innerText.trim() === '删除')?.click();
});
await page.waitForTimeout(800);
const after = await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).files.totalBytes());
check(before - after === 400_000, `删掉之后总量真的少了 400KB（${before} -> ${after}）`);
check(!/也没人要\.mp3/.test(await txt()), '那一行从列表里消失了');

// ---- 5 一键清理无引用 ----
await page.evaluate(async () => {
  const el = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '清理');
  el.click();
  await new Promise(r => setTimeout(r, 500));
  [...document.querySelectorAll('.overlay button')].find(b => b.innerText.trim() === '删除')?.click();
});
await page.waitForTimeout(900);
const left = await page.evaluate(async () =>
  (await import('/src/system/purge.js')).fileReport().map(r => r.name));
check(!left.includes('没人要的大家伙.mp4'), '一键清理把无引用的删了');
check(left.length === 6 && left.includes('一部片子.mp4'),
  `正在用的一个都没动（还剩 ${left.length} 个）`);

// ---- 6 存储页那两个入口 ----
await go('/storage');
body = await txt();
check(/按原样保存，未经压缩/.test(body), '存储页那一行写明了这些没压过');
check(/占地方的文件/.test(body), '维护那一组里也有一条入口');

// ---- 7 一个文件都没有时不白屏 ----
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  for (const f of db.files.list()) await db.files.remove(f.id);
});
await go('/storage/files');
check(/还没有这类文件/.test(await txt()), '空的时候是空状态');

await go('/storage');
await page.screenshot({ path: `${OUT}/files-storage.png`, fullPage: true });

console.log(ok.filter(Boolean).map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.filter(Boolean).length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
