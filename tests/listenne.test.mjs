// 一起听接网易云；主屏未读角标不被裁。
//
//   曲库空、登录了网易云：角色写 [一起听] 起得来（拿刚听过的一首），同一轮的 [点歌] 接着换
//   曲库空、没登录：[一起听] + [点歌] 拿点的那一首起播
//   一起听页：搜网易云、点一首就一起听；自己的网易云歌单点开就一起听；给角色的歌单加歌可以搜
//   主屏：图标格子不裁，未读角标完整
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
let reply = '好。';
const song = (id, name, ar) => ({ id, name, ar: [{ name: ar }], al: { name: 'x', picUrl: '' }, dt: 200000 });
await ctx.route('**/ne.example.com/**', async route => {
  const u = new URL(route.request().url());
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  const p = u.pathname;
  if (p === '/cloudsearch') {
    const kw = u.searchParams.get('keywords') || '';
    if (/晴天/.test(kw)) return J({ code: 200, result: { songs: [song(901, '晴天', '周杰伦')] } });
    if (/稻香/.test(kw)) return J({ code: 200, result: { songs: [song(902, '稻香', '周杰伦')] } });
    return J({ code: 200, result: { songs: [] } });
  }
  if (p === '/user/account') return J({ code: 200, profile: { userId: 42, nickname: '我' } });
  if (p === '/record/recent/song') return J({ code: 200, data: { list: [{ playTime: Date.now(), data: song(801, '刚听过的歌', '某人') }] } });
  if (p === '/user/playlist') return J({ code: 200, playlist: [{ id: 7, name: '夜里听', trackCount: 2, userId: 42 }] });
  if (p === '/playlist/track/all') return J({ code: 200, songs: [song(701, '晚风', '林晚'), song(702, '海边', '林晚')] });
  if (p.startsWith('/song/url')) return J({ code: 200, data: [{ url: '' }] });
  if (p === '/lyric') return J({ code: 200, nolyric: true });
  return J({ code: 200 });
});
await ctx.route('**/relay.example.com/**', async route => route.fulfill({ status: 200, contentType: 'text/event-stream',
  body: [...reply].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' }));
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  svc.setNetease({ baseUrl: 'https://ne.example.com', cookie: 'MUSIC_U=x', uid: '42' });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
});
const turn = (text, turnId) => ev(async ({ chat, char, text, turnId }) => {
  const { db } = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw: text, turnId, instant: true });
  await new Promise(res => setTimeout(res, 1500));
  const l = await import('/src/system/listen.js');
  const cur = l.current();
  const s = l.listen.get();
  const out = { active: s.active, song: cur?.title || '', lib: (await import('/src/system/music.js')).allSongs().map(x => x.title) };
  l.stop();
  return out;
}, { ...ids, text, turnId });

// ---- 角色：曲库空着 ----
const a = await turn('一起听吧。\n[一起听]', 't1');
ok('曲库空、登录了网易云：角色写 [一起听] 起得来，放的是刚听过的那首', a.active && a.song === '刚听过的歌', JSON.stringify(a));
const b = await turn('换一首。\n[一起听]\n[点歌：晴天]', 't2');
ok('同一轮 [一起听] 再 [点歌]：起来之后换成点的那首', b.active && b.song === '晴天', JSON.stringify(b));
await ev(async () => {
  const svc = await import('/src/system/ai/services.js');
  const m = await import('/src/system/music.js');
  const { db } = await import('/src/system/db/index.js');
  svc.setNetease({ cookie: '', uid: '' });
  m.allSongs().forEach(x => m.removeSong(x.id));
  db.playlists.all().forEach(p => db.playlists.remove(p.id));
});
const c = await turn('听这首。\n[一起听]\n[点歌：稻香]', 't3');
ok('曲库空、没登录：拿点的那首起播', c.active && c.song === '稻香', JSON.stringify(c));
await ev(async () => (await import('/src/system/ai/services.js')).setNetease({ cookie: 'MUSIC_U=x', uid: '42' }));

// ---- 一起听页 ----
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/listen/${o.chat}`); }, ids);
await page.waitForTimeout(1200);
const pg = await ev(() => document.body.textContent);
ok('一起听页有「搜索网易云」与「我的网易云歌单」', /搜索网易云/.test(pg) && /我的网易云歌单/.test(pg) && /夜里听/.test(pg), pg.slice(0, 300));
const box = page.locator('input[placeholder*="搜索网易云"]').first();
await box.fill('晴天');
await box.press('Enter');
await page.waitForTimeout(800);
await page.locator('.list-item, [class*="list-item"]', { hasText: '周杰伦' }).first().click();
await page.waitForTimeout(800);
const played = await ev(async () => { const l = await import('/src/system/listen.js'); const r = { active: l.listen.get().active, song: l.current()?.title }; l.stop(); return r; });
ok('搜到点一首：就和角色一起听这一首', played.active && played.song === '晴天', JSON.stringify(played));

await ev(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/listen/${o.chat}`); }, ids);
await page.waitForTimeout(1200);
await page.locator('.list-item, [class*="list-item"]', { hasText: '夜里听' }).first().click();
await page.waitForTimeout(1200);
const nl = await ev(async () => {
  const l = await import('/src/system/listen.js');
  const m = await import('/src/system/music.js');
  const s = l.listen.get();
  const list = m.allLists('me').find(p => p.name === '夜里听');
  const r = { active: s.active, song: l.current()?.title, tracks: list ? m.tracksOf(list.id).map(x => x.title) : null, listId: s.listId === list?.id };
  l.stop();
  return r;
});
ok('点自己的网易云歌单：收进本机同名歌单，从第一首一起听', nl.active && nl.song === '晚风' && JSON.stringify(nl.tracks) === '["晚风","海边"]' && nl.listId, JSON.stringify(nl));

// 给角色的歌单加歌：搜网易云
await ev(async o => {
  const m = await import('/src/system/music.js');
  m.listNamed(o.char, '阿岚的歌单');
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/listen/${o.chat}`);
}, ids);
await page.waitForTimeout(1200);
await page.locator('.list-item, [class*="list-item"]', { hasText: '阿岚的歌单' }).locator('button', { hasText: '加歌' }).click();
await page.waitForTimeout(500);
const box2 = page.locator('.sheet input[placeholder*="搜索网易云"]').first();
await box2.fill('稻香');
await box2.press('Enter');
await page.waitForTimeout(800);
await page.locator('.sheet .list-item, .sheet [class*="list-item"]', { hasText: '周杰伦' }).first().click();
await page.waitForTimeout(400);
const hers = await ev(async o => {
  const m = await import('/src/system/music.js');
  const p = m.allLists(o.char).find(x => x.name === '阿岚的歌单');
  return m.tracksOf(p.id).map(x => x.title);
}, ids);
ok('给角色的歌单加歌：可以直接搜网易云', JSON.stringify(hers) === '["稻香"]', JSON.stringify(hers));

// ---- 主屏角标 ----
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  for (let i = 0; i < 3; i++) db.messages.create({ chatId: o.chat, role: 'char', authorId: o.char, kind: 'text', content: '在吗', status: 'done', unread: true });
  db.chats.update(o.chat, { unread: 3 });
  const n = await import('/src/system/nav.js'); n.goHome();
}, ids);
await page.waitForTimeout(800);
const badge = await ev(() => {
  // 网格里任一图标格子：不许裁（角标挂在图标外面 4px）
  const cells = [...document.querySelectorAll('.home-grid .cell-app')];
  // 有角标的那一格（可能在 Dock 里），从角标往上每一层都不许把它裁掉
  const b = document.querySelector('.tile-badge');
  const clipped = [];
  for (let el = b?.parentElement; el && !el.classList.contains('home-layer'); el = el.parentElement) {
    const o = getComputedStyle(el).overflow;
    if (o !== 'visible' && el.getBoundingClientRect().top > b.getBoundingClientRect().top - 1) clipped.push(el.className);
  }
  return { cells: cells.length, hidden: cells.filter(c => getComputedStyle(c).overflow !== 'visible').length, badge: !!b, clipped };
});
ok('主屏图标格子不裁：角标挂在图标外面也完整显示', badge.cells > 0 && badge.hidden === 0 && badge.badge && !badge.clipped.length, JSON.stringify(badge));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
