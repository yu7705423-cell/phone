// 音乐「正在播放」：点底部那条进来；封面与歌词两面点一下切换；正唱的那句高亮；
// 点一句从那句放；网易云歌词带译文、可关；纯音乐、自己传的歌没有歌词时各说各的话
import { BASE, OUT, EXE, chromium } from './_env.mjs';

// 现造一段 8 秒的静音 wav（8kHz、8 位、单声道），够歌词走好几句
const wav = (() => {
  const n = 8000 * 8;
  const b = Buffer.alloc(44 + n, 0x80);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40);
  return `data:audio/wav;base64,${b.toString('base64')}`;
})();

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route('**/ne.example.com/**', async route => {
  const u = new URL(route.request().url());
  const id = u.searchParams.get('id');
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/lyric') {
    if (id === '101') return J({ code: 200, lrc: { lyric: '[00:00.00]Hello\n[00:02.00]World\n[00:04.00]Again' },
      tlyric: { lyric: '[00:00.00]你好\n[00:02.00]世界\n[00:04.00]再一次' } });
    if (id === '102') return J({ code: 200, pureMusic: true, lrc: { lyric: '[00:00.00]纯音乐，请欣赏' } });
    return J({ code: 200, nolyric: true });
  }
  if (u.pathname.startsWith('/song/url')) return J({ code: 200, data: [{ id, url: wav }] });
  return J({ code: 200 });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

await page.evaluate(async () => {
  (await import('/src/system/ai/services.js')).setNetease({ baseUrl: 'https://ne.example.com' });
});

// ---- 一、歌词怎么取 ----
const lx = await page.evaluate(async () => {
  const p = await import('/src/system/player.js');
  const a = await p.lyricOf({ id: '101', title: 'Hello' });
  const pure = await p.lyricOf({ id: '102', title: '雨' });
  const none = await p.lyricOf({ id: '103', title: '无' });
  const local = await p.lyricOf({ id: 'x1', title: '自己的', source: 'local' });
  const own = await p.lyricOf({ id: 'x2', title: '粘过的', source: 'local', lyric: '[00:01.00]一\n[00:02.00]二' });
  return { a: a.lines, pure: pure.pure, none: none.none, local: local.local, own: own.lines.map(l => l.text) };
});
ok('网易云歌词：译文按时间挂到同一句下面', lx.a.length === 3 && lx.a[1].text === 'World' && lx.a[1].trans === '世界', JSON.stringify(lx.a));
ok('纯音乐、未收录、自己传的没歌词：各自标出来', lx.pure && lx.none && lx.local, JSON.stringify(lx));
ok('自己在曲库里粘过歌词的用那一份', JSON.stringify(lx.own) === '["一","二"]', JSON.stringify(lx.own));

// ---- 二、从底部那条进「正在播放」 ----
await page.evaluate(async () => {
  const p = await import('/src/system/player.js');
  p.play([{ id: '101', title: 'Hello', artist: '某乐队', cover: '', seconds: 8 },
    { id: '103', title: '无', artist: '某人', seconds: 8 }], 0);
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('music', '/');
});
await page.waitForTimeout(1200);
// 底部那条上的播放键不跳页
await page.locator('.mu-bar [aria-label="暂停"], .mu-bar [aria-label="播放"]').first().click();
await page.waitForTimeout(300);
ok('点底部那条上的播放键：只是暂停，不跳页', !(await page.locator('.mu-now').count()));
await page.locator('.mu-bar [aria-label="播放"]').first().click();
await page.waitForTimeout(200);
await page.locator('.mu-bar-body').click();
await page.waitForTimeout(700);
let txt = await page.locator('.page').last().innerText();
ok('点底部那条：进「正在播放」，有歌名、歌手、大封面', await page.locator('.mu-now').count() === 1
  && /Hello/.test(txt) && /某乐队/.test(txt) && await page.locator('.mu-now-face .mu-cover').count() === 1, txt.slice(0, 200));
await page.screenshot({ path: `${OUT}/nowplaying-cover.png` });

// ---- 三、歌词那一面 ----
await page.locator('.mu-now-face').click();
await page.waitForTimeout(2600);
const ly = await page.evaluate(async () => ({
  lines: [...document.querySelectorAll('.mu-ly')].map(e => e.innerText.replace(/\n/g, '/')),
  on: document.querySelector('.mu-ly.is-on')?.innerText.split('\n')[0] || '',
  pos: (await import('/src/system/player.js')).position(),
}));
// 按此刻真正放到哪儿算该亮哪一句（0、2、4 秒各一句）
const want = ly.pos >= 3.8 ? 'Again' : ly.pos >= 1.8 ? 'World' : 'Hello';
await page.screenshot({ path: `${OUT}/nowplaying-lyric.png` });
ok('点封面：换成歌词，每句下面是译文', ly.lines.length === 3 && ly.lines[0] === 'Hello/你好', JSON.stringify(ly.lines));
ok('唱到哪句哪句亮', ly.pos > 0.5 && ly.on === want, JSON.stringify({ ...ly, want }));
await page.locator('.mu-ly', { hasText: 'Again' }).click();
await page.waitForTimeout(600);
const after = await page.evaluate(async () => ({
  at: (await import('/src/system/player.js')).position(),
  on: document.querySelector('.mu-ly.is-on')?.innerText.split('\n')[0] || '',
}));
ok('点一句：从那一句开始放', after.at >= 4 && after.on === 'Again', JSON.stringify(after));
await page.locator('.mu-trans-btn').click();
await page.waitForTimeout(200);
ok('右上角关掉译文', !(await page.locator('.mu-ly-t').count()));
await page.locator('.mu-lyrics').click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(300);
ok('点歌词以外的空白：回到封面', await page.locator('.mu-now-face').count() === 1);

// ---- 四、下一首没有歌词：写明暂无 ----
await page.locator('.mu-now-btn[aria-label="下一首"]').click();
await page.waitForTimeout(900);
await page.locator('.mu-now-face').click();
await page.waitForTimeout(400);
txt = await page.locator('.mu-lyrics').innerText();
ok('下一首没收录歌词：写「暂无歌词」', /暂无歌词/.test(txt) && /无/.test(await page.locator('.page').last().innerText()), txt);

// ---- 五、会话里的「一起听」：点顶上那一条，进同一个「正在播放」 ----
await page.evaluate(async () => (await import('/src/system/player.js')).stop());
const lid = await page.evaluate(async w => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const music = await import('/src/system/music.js');
  const listen = await import('/src/system/listen.js');
  const c = db.characters.create({ name: '林晚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id });
  const song = music.addSong({ title: '晚风', artist: '林晚', url: w, seconds: 8,
    lyric: '[00:00.00]第一句\n[00:02.00]第二句\n[00:04.00]第三句' });
  listen.start({ chatId: chat.id, songId: song.id });
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${chat.id}`);
  return { chat: chat.id };
}, wav);
await page.waitForTimeout(1200);
await page.locator('.listen-main').tap();
await page.waitForTimeout(900);
txt = await page.locator('.page').last().innerText();
ok('一起听：点会话顶上那一条，进「正在播放」，是同一个大封面', await page.locator('.mu-now').count() === 1
  && /晚风/.test(txt) && await page.locator('.mu-now-face .mu-cover').count() === 1, txt.slice(0, 200));
await page.locator('.mu-now-face').tap();
await page.waitForTimeout(400);
ok('一起听：歌词是曲库里那一份', (await page.locator('.mu-ly').allInnerTexts()).join('/') === '第一句/第二句/第三句');
await page.locator('.mu-ly', { hasText: '第三句' }).tap();
await page.waitForTimeout(500);
const lpos = await page.evaluate(async () => (await import('/src/system/listen.js')).position());
ok('一起听：点一句从那一句放', lpos >= 4, lpos);
await page.locator('[aria-label="一起听的歌单"]').tap();
await page.waitForTimeout(800);
const where = await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute());
ok('一起听：右上角回到一起听的歌单页', where === `/listen/${lid.chat}`, where);
await page.evaluate(async () => (await import('/src/system/listen.js')).stop());

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await page.evaluate(async () => (await import('/src/system/player.js')).stop());
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
