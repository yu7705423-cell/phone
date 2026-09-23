// 自己在会话里分享一首歌：「+」面板里「分享音乐」挑一首，落一张歌曲卡片在自己这一侧；
// 角色读历史时看到的是和它自己分享时同一个标记；群聊里也能用
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const music = await import('/src/system/music.js');
  const c = db.characters.create({ name: '林晚', persona: 'x' });
  const c2 = db.characters.create({ name: '阿岚', persona: 'y' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id });
  const group = db.chats.create({ characterIds: [c.id, c2.id], personaId: acc.current().id, group: true });
  const s = music.addSong({ title: '晚风', artist: '林晚', url: 'data:audio/wav;base64,', seconds: 8 });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
  return { char: c.id, chat: chat.id, group: group.id, song: s.id };
});
await page.waitForTimeout(1000);

const share = async () => {
  await page.locator('.composer-side').first().tap();
  await page.waitForTimeout(400);
  await page.locator('.panel-item', { hasText: '分享音乐' }).tap();
  await page.waitForTimeout(400);
  await page.locator('.sheet').last().locator('.list-item', { hasText: '晚风' }).tap();
  await page.waitForTimeout(500);
};
await share();
const msg = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.chat).find(m => m.kind === 'song'), ids);
ok('「+」面板里点「分享音乐」挑一首：落一条自己发的歌曲消息', msg && msg.role === 'user' && msg.songId === ids.song
  && msg.content === '[分享歌曲：晚风 - 林晚]', JSON.stringify(msg));
ok('卡片在自己这一侧', await page.locator('.msg.is-mine .bubble-song').count() === 1);
await page.screenshot({ path: `${OUT}/sharesong-chat.png` });

const sys = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return JSON.stringify(engine.buildHistory(db.chats.get(o.chat), db.characters.get(o.char), db.messagesOf(o.chat), {}));
}, ids);
ok('角色读历史：看到的是「[分享歌曲：晚风 - 林晚]」', sys.includes('[分享歌曲：晚风 - 林晚]'), sys.slice(-300));

await page.locator('.msg.is-mine .bubble-song').tap();
await page.waitForTimeout(900);
const route = await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute());
ok('点自己分享的卡片：同样放这首、进「正在播放」', /^\/now/.test(route), route);
await page.evaluate(async () => (await import('/src/system/player.js')).stop());

// ---- 卡片的样子：封面主色做底色；播放键就地放、就地停，放着时外面一圈进度 ----
const wav = (() => {
  const n = 8000 * 6;
  const b = Buffer.alloc(44 + n, 0x80);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40);
  return `data:audio/wav;base64,${b.toString('base64')}`;
})();
await page.evaluate(async ([o, w]) => {
  const db = await import('/src/system/db/index.js');
  const music = await import('/src/system/music.js');
  // 一张偏红的封面
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = 'rgb(200 40 60)'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgb(250 250 250)'; g.fillRect(0, 0, 64, 6);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const coverId = await db.images.put(new File([blob], 'c.png', { type: 'image/png' }), 256);
  const s = music.addSong({ title: '红', artist: '某人', url: w, seconds: 6, coverId });
  music.share({ chatId: o.chat, song: s });
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${o.chat}`);
}, [ids, wav]);
await page.waitForTimeout(1500);
const red = page.locator('.song-card', { hasText: '红' });
const look = await red.evaluate(el => ({ tinted: el.classList.contains('is-tinted'), tint: el.style.getPropertyValue('--song-tint'),
  bg: getComputedStyle(el).backgroundColor, img: !!el.querySelector('.song-art img'), w: el.getBoundingClientRect().width }));
ok('封面主色取出来做底色（偏红，白边不算进去）', look.tinted && /rgb\((19\d|20\d) (3\d|4\d) (5\d|6\d)\)/.test(look.tint) && look.img, JSON.stringify(look));
await page.screenshot({ path: `${OUT}/sharesong-card.png` });
await red.locator('.song-key').tap();
await page.waitForTimeout(1200);
let st = await page.evaluate(async () => {
  const p = await import('/src/system/player.js');
  const n = await import('/src/system/nav.js');
  return { playing: p.player.get().playing, title: p.current()?.title, route: n.currentRoute(), pos: p.position() };
});
ok('点播放键：就地放，不跳页', st.playing && st.title === '红' && /^\/chat\//.test(st.route), JSON.stringify(st));
ok('放着时播放键变成暂停，外面有一圈进度', await red.locator('.song-key[aria-label="暂停"] .song-ring').count() === 1);
await page.screenshot({ path: `${OUT}/sharesong-playing.png` });
await red.locator('.song-key').tap();
await page.waitForTimeout(300);
st = await page.evaluate(async () => (await import('/src/system/player.js')).player.get().playing);
ok('再点一下：停下', st === false);
await page.evaluate(async () => (await import('/src/system/player.js')).stop());

await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${o.group}`); }, ids);
await page.waitForTimeout(1000);
await share();
const inGroup = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.group).filter(m => m.kind === 'song').length, ids);
ok('群聊里也能分享', inGroup === 1, inGroup);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
