// 会话顶上的一起听播放条（chat/pages/TransferBits.js 的 ListenBar，ARCHITECTURE 4.236）
//
//   一、自动播放被浏览器拦下：那一行写明点此继续；点一下放起来，那一行换成歌词
//       （从前只改了 playing，「被拦下了」一直挂着，歌词轮不到）
//   二、播放条浮在消息列表上：列表伸到它底下，消息从它下面滚过；滚到最顶，第一条不被压住
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
// 浏览器拦自动播放这件事在测试环境里不稳定（无头浏览器常常照放不误），这里模拟：
// 没有点过的时候 play() 被拒，点过一次之后放行 —— 和手机上真实的样子一样
await ctx.addInitScript(() => {
  let gesture = false;
  addEventListener('pointerdown', () => { gesture = true; }, true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    if (!gesture) return Promise.reject(new DOMException('play() failed because the user didn\'t interact', 'NotAllowedError'));
    return play.apply(this, a);
  };
});
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const music = await import('/src/system/music.js');
  // 一段十秒的静音 wav，浏览器放得出来
  const rate = 8000, n = rate * 10;
  const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  const audioId = await db.files.put(new Blob([buf], { type: 'audio/wav' }), { name: 's.wav', type: 'audio/wav' });
  const song = music.addSong({ title: '夜航星', audioId, lyric: '[00:00.00]第一句歌词\n[00:30.00]第二句' });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  for (let i = 0; i < 30; i++) {
    db.messages.create({ chatId: chat.id, role: i % 2 ? 'char' : 'user', kind: 'text',
      content: `第 ${i + 1} 条`, status: 'done', createdAt: Date.now() - (40 - i) * 1000 });
  }
  return { chat: chat.id, song: song.id };
});
await page.evaluate(async id => {
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', '/'); n.push(`/chat/${id}`);
}, ids.chat);
await page.waitForSelector('.conv-body');
await page.waitForTimeout(500);
// 从代码里开一场（没有用户手势），浏览器应当拦下
await page.evaluate(async ([chatId, songId]) => {
  const l = await import('/src/system/listen.js');
  l.start({ chatId, songId });
}, [ids.chat, ids.song]);
await page.waitForTimeout(1200);
const sub = () => page.locator('.listen-sub').innerText();
const blockedText = await sub();
ok('被拦下：那一行写明点此继续', /拦下/.test(blockedText), blockedText);

await page.locator('.listen-main').click();
await page.waitForTimeout(1500);
const after = await page.evaluate(async () => (await import('/src/system/listen.js')).listen.get());
const afterText = await sub();
ok('点一下之后放起来了', after.playing === true && !after.error, JSON.stringify(after));
ok('那一行换成了歌词', afterText.includes('第一句歌词'), afterText);
ok('点那一行是继续播放，没有跳去别的页面', await page.locator('.conv-body').count() === 1);

// ---- 二、浮在列表上 ----
const geo = await page.evaluate(() => {
  const bar = document.querySelector('.listen-bar').getBoundingClientRect();
  const body = document.querySelector('.conv-body');
  const b = body.getBoundingClientRect();
  return { barTop: bar.top, barBottom: bar.bottom, bodyTop: b.top, pad: parseFloat(getComputedStyle(body).paddingTop) };
});
ok('列表伸到播放条底下（不再在它下沿截断）', geo.bodyTop <= geo.barTop, JSON.stringify(geo));
ok('列表顶上留出播放条那么高的一段', geo.pad >= geo.barBottom - geo.bodyTop, JSON.stringify(geo));
await page.evaluate(() => { document.querySelector('.conv-body').scrollTop = 0; });
await page.waitForTimeout(300);
const top = await page.evaluate(() => {
  const bar = document.querySelector('.listen-bar').getBoundingClientRect();
  const first = document.querySelector('.conv-body .msg')?.getBoundingClientRect();
  return { barBottom: bar.bottom, firstTop: first ? first.top : null };
});
ok('滚到最顶：第一条在播放条下面，不被压住', top.firstTop !== null && top.firstTop >= top.barBottom - 1, JSON.stringify(top));
await page.evaluate(() => { const b = document.querySelector('.conv-body'); b.scrollTop = b.scrollHeight; });
await page.waitForTimeout(300);
const under = await page.evaluate(() => {
  const bar = document.querySelector('.listen-bar').getBoundingClientRect();
  return [...document.querySelectorAll('.conv-body .msg')].some(m => {
    const r = m.getBoundingClientRect();
    return r.top < bar.bottom && r.bottom > bar.top;
  });
});
ok('滚动时消息从播放条底下经过', under);

await page.evaluate(async () => (await import('/src/system/listen.js')).stop());
await page.waitForTimeout(400);
const gone = await page.evaluate(() => ({
  bar: document.querySelectorAll('.listen-bar').length,
  pad: parseFloat(getComputedStyle(document.querySelector('.conv-body')).paddingTop),
}));
ok('结束一起听：播放条没了，顶上留白收回去', gone.bar === 0 && gone.pad < 30, JSON.stringify(gone));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
