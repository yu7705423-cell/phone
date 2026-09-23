// 角色自己的音乐：[分享歌曲：…] 落一张歌曲卡片（曲库找不到就去网易云搜），点开放、进「正在播放」；
// [加入歌单：名 | 歌1；歌2] 往角色名下的歌单里放歌，没有就建，落一行能点开的提示；
// 角色包带上它的歌单，删角色时歌单跟着删、歌留在曲库
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const searched = [];
await ctx.route('**/ne.example.com/**', async route => {
  const u = new URL(route.request().url());
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/cloudsearch') {
    const kw = u.searchParams.get('keywords') || '';
    searched.push(kw);
    if (/晴天/.test(kw)) {
      return J({ code: 200, result: { songs: [
        { id: 900, name: '晴天（翻唱）', ar: [{ name: '路人' }], al: { name: 'x', picUrl: '' }, dt: 200000 },
        { id: 901, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美', picUrl: 'https://ne.example.com/c.jpg' }, dt: 269000 },
      ] } });
    }
    return J({ code: 200, result: { songs: [] } });
  }
  if (u.pathname === '/c.jpg') return route.fulfill({ status: 404, body: '' });
  if (u.pathname === '/lyric') return J({ code: 200, nolyric: true });
  return J({ code: 200 });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

// ---- 一、歌名的几种写法 ----
const sq = await page.evaluate(async () => {
  const m = await import('/src/system/music.js');
  return ['晴天 - 周杰伦', '晴天 — 周杰伦', '晴天（周杰伦）', '周杰伦《晴天》', '《晴天》', '晴天']
    .map(q => { const r = m.splitQuery(q); return `${r.title}/${r.artist}`; });
});
ok('歌名与歌手：横线、破折号、括号、书名号都拆得开', JSON.stringify(sq)
  === JSON.stringify(['晴天/周杰伦', '晴天/周杰伦', '晴天/周杰伦', '晴天/周杰伦', '晴天/', '晴天/']), JSON.stringify(sq));

// ---- 二、标记怎么读 ----
const parts = await page.evaluate(async () => {
  const r = await import('/src/system/ai/reply.js');
  return r.splitReply('这首给你\n[分享歌曲：晚风 - 林晚]\n[加入歌单：夜里听 | 晚风 - 林晚；晴天 - 周杰伦；不存在的歌]\n[加入歌单：空的]\n[建歌单：以后再放]')
    .filter(p => p.type !== 'text');
});
ok('分享歌曲读成一张卡片，加入歌单读出名字与几首歌', parts.length === 3
  && parts[0].type === 'song' && parts[0].query === '晚风 - 林晚'
  && parts[1].type === 'newlist' && parts[1].name === '夜里听' && parts[1].songs.length === 3
  && parts[2].type === 'newlist' && parts[2].name === '以后再放' && parts[2].songs.length === 0, JSON.stringify(parts));

// ---- 三、没配网易云：只在曲库里找 ----
const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const music = await import('/src/system/music.js');
  const c = db.characters.create({ name: '林晚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id });
  const song = music.addSong({ title: '晚风', artist: '林晚', url: 'data:audio/wav;base64,', seconds: 8 });
  const none = await music.resolveSong('晴天 - 周杰伦');
  const hit = await music.resolveSong('晚风（林晚）');
  return { char: c.id, chat: chat.id, song: song.id, none, hit: hit?.id };
});
ok('没配网易云：曲库里有的找得到，没有的回空', ids.none === null && ids.hit === ids.song, JSON.stringify(ids));

// ---- 四、配了网易云，一轮回复里分享一首、加歌单 ----
await page.evaluate(async () => (await import('/src/system/ai/services.js')).setNetease({ baseUrl: 'https://ne.example.com' }));
const made = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  const chat = db.chats.get(o.chat); const char = db.characters.get(o.char);
  await r.renderTurn({ chat, char, turnId: 'cm1', instant: true,
    raw: '这首给你\n[分享歌曲：晴天 - 周杰伦]\n[加入歌单：夜里听 | 晚风 - 林晚；晴天 - 周杰伦；根本没有这首]' });
  await new Promise(res => setTimeout(res, 800));
  const msgs = db.messagesOf(o.chat);
  const card = msgs.find(m => m.kind === 'song');
  const notice = msgs.find(m => m.kind === 'notice' && m.playlistId);
  const lists = db.playlists.all().filter(p => p.owner === o.char);
  const tracks = lists[0] ? lists[0].trackIds.map(id => db.songs.get(id)?.title) : [];
  const got = card?.songId ? db.songs.get(card.songId) : null;
  return { card: card && { state: card.songState, content: card.content }, got: got && { title: got.title, artist: got.artist, ne: got.neteaseId, cover: got.cover },
    notice: notice && { text: notice.content, pl: notice.playlistId === lists[0]?.id },
    lists: lists.map(p => p.name), tracks, songs: db.songs.all().length };
}, ids);
ok('分享的歌曲库里没有：去网易云搜，挑歌名正好对上的那首收进曲库', made.card?.state === 'done'
  && made.got?.title === '晴天' && made.got.ne === '901' && /c\.jpg/.test(made.got.cover), JSON.stringify(made));
ok('搜的时候带上歌手', searched.some(k => k === '晴天 周杰伦'), JSON.stringify(searched));
ok('歌单建在角色名下，放进找得到的两首，同一首不重复收', JSON.stringify(made.lists) === '["夜里听"]'
  && JSON.stringify(made.tracks) === '["晚风","晴天"]' && made.songs === 2, JSON.stringify(made));
ok('落一行提示：放了哪几首、哪一首没找到', /林晚把《晚风》《晴天》加入了歌单「夜里听」/.test(made.notice?.text || '')
  && /《根本没有这首》没有找到/.test(made.notice.text) && made.notice.pl, JSON.stringify(made.notice));

const again = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(o.chat), char: db.characters.get(o.char), turnId: 'cm2', instant: true,
    raw: '[加入歌单：夜里听 | 晚风 - 林晚]\n[分享歌曲：一首谁都没听过的歌]' });
  await new Promise(res => setTimeout(res, 800));
  const lists = db.playlists.all().filter(p => p.owner === o.char);
  const card = db.messagesOf(o.chat).filter(m => m.kind === 'song').pop();
  const notice = db.messagesOf(o.chat).filter(m => m.kind === 'notice' && m.playlistId).pop();
  // 这一轮先写的歌单、后写的分享：落下来的顺序也得是这样
  const order = db.messagesOf(o.chat).filter(m => m.turnId === 'cm2').map(m => m.kind);
  return { lists: lists.length, n: lists[0].trackIds.length, state: card.songState, notice: notice.content, order };
}, ids);
ok('再往同名歌单里放：不另建，已有的不重复，提示写明已在歌单中', again.lists === 1 && again.n === 2
  && again.notice === '[《晚风》已在歌单「夜里听」中]', JSON.stringify(again));
ok('歌单提示按角色写的顺序落，不因为找歌慢一拍排到后面', JSON.stringify(again.order) === '["notice","song"]', JSON.stringify(again.order));
ok('两处都找不到的歌：卡片标成没找到', again.state === 'missing', JSON.stringify(again));

// ---- 五、界面：卡片与提示 ----
await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(1200);
const cards = await page.locator('.bubble-song').allInnerTexts();
await page.screenshot({ path: `${OUT}/charmusic-chat.png` });
ok('会话里是歌曲卡片：歌名、歌手；没找到的写明原因', cards.length === 2 && /晴天/.test(cards[0]) && /周杰伦/.test(cards[0])
  && /均未找到/.test(cards[1]), JSON.stringify(cards));
ok('卡片里不露出方括号标记', !/分享歌曲：/.test(await page.locator('.page').last().innerText()));
await page.locator('.bubble-song').first().tap();
await page.waitForTimeout(900);
const now = await page.evaluate(async () => ({ route: (await import('/src/system/nav.js')).currentRoute() }));
const nowTxt = await page.locator('.page').last().innerText();
ok('点卡片：放这首，进「正在播放」', /^\/now/.test(now.route) && /晴天/.test(nowTxt) && await page.locator('.mu-now').count() === 1, `${now.route} ${nowTxt.slice(0, 80)}`);
await page.evaluate(async () => (await import('/src/system/player.js')).stop());
await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(1000);
await page.locator('button.conv-notice', { hasText: '夜里听' }).first().tap();
await page.waitForTimeout(800);
const lroute = await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute());
ok('点歌单那行提示：进一起听那一页，看得到角色的歌单', lroute === `/listen/${ids.chat}`
  && /夜里听/.test(await page.locator('.page').last().innerText()), lroute);

// ---- 六、角色包与删除 ----
const pack = await page.evaluate(async o => {
  const cp = await import('/src/system/charpack.js');
  const c = cp.collect(o.char);
  return { lists: (c.playlists || []).map(p => p.name), songs: (c.songs || []).map(s => s.title).sort() };
}, ids);
ok('角色包带上它的歌单和里面的歌、分享过的歌', JSON.stringify(pack.lists) === '["夜里听"]'
  && JSON.stringify(pack.songs) === '["晚风","晴天"]', JSON.stringify(pack));
const gone = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const purge = await import('/src/system/purge.js');
  purge.dropCharacter(o.char);
  return { lists: db.playlists.all().filter(p => p.owner === o.char).length, songs: db.songs.all().length };
}, ids);
ok('删角色：它的歌单一起删，歌留在曲库', gone.lists === 0 && gone.songs === 2, JSON.stringify(gone));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
