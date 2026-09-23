// 音乐的几处补齐：会话列表里歌曲消息的预览；分享的歌附上歌词给角色（可关、可改行数，
// 只附用户那一侧）；歌曲消息的长按菜单（一起听、加入我的歌单、复制歌名）；
// 本机歌单详情页（查看曲目、移除一首、一起听、删除），角色的歌单从一起听页与提示行进去
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const LRC = Array.from({ length: 30 }, (_, i) => `[00:${String(i * 2).padStart(2, '0')}.00]第${i + 1}句`).join('\n');
const ids = await page.evaluate(async lrc => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const music = await import('/src/system/music.js');
  const c = db.characters.create({ name: '林晚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id });
  const s = music.addSong({ title: '晚风', artist: '林晚', url: 'data:audio/wav;base64,', seconds: 8, lyric: lrc });
  const s2 = music.addSong({ title: '海边', artist: '某人', url: 'data:audio/wav;base64,', seconds: 8 });
  const mine = music.createList({ name: '通勤' });
  const hers = music.createList({ name: '夜里听', owner: c.id });
  music.addTrack(hers.id, s.id); music.addTrack(hers.id, s2.id);
  music.share({ chatId: chat.id, song: s });
  await new Promise(r => setTimeout(r, 300));
  return { char: c.id, chat: chat.id, song: s.id, song2: s2.id, mine: mine.id, hers: hers.id };
}, LRC);

// ---- 一、会话列表里的预览 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', '/'); });
await page.waitForTimeout(800);
const row = await page.locator('.msg-row', { hasText: '林晚' }).first().innerText();
ok('会话列表：歌曲消息预览写成「[歌曲] 歌名」，不露标记', /\[歌曲\] 晚风/.test(row) && !/分享歌曲：/.test(row), row);

// ---- 二、歌词附给角色 ----
const hist = () => page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.buildHistory(db.chats.get(o.chat), db.characters.get(o.char), db.messagesOf(o.chat), {})
    .map(m => m.content).join('\n');
}, ids);
const setS = patch => page.evaluate(async p => (await import('/src/system/db/index.js')).settings.set(p), patch);
const stored = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.chat).find(m => m.kind === 'song'), ids);
ok('分享时把歌词取回来存在消息上', (stored.songLyric || '').split('\n').length === 30, JSON.stringify(stored).slice(0, 200));
let h = await hist();
ok('默认：角色读到的那条后面附着前 20 行歌词', /\[分享歌曲：晚风 - 林晚\]\n\[歌词\]\n第1句/.test(h) && /第20句/.test(h) && !/第21句/.test(h), h.slice(0, 300));
await setS({ songLyricLines: 3 });
h = await hist();
ok('行数改成 3：只附 3 行', /第3句/.test(h) && !/第4句/.test(h), h.slice(0, 200));
await setS({ songLyricLines: 0 });
h = await hist();
ok('填 0：整首', /第30句/.test(h));
await setS({ songLyric: false });
h = await hist();
ok('关掉：只有歌名', /\[分享歌曲：晚风 - 林晚\]/.test(h) && !/\[歌词\]/.test(h), h.slice(0, 200));
await setS({ songLyric: true, songLyricLines: 20 });
h = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  db.messages.create({ chatId: o.chat, role: 'char', authorId: o.char, kind: 'song', status: 'done',
    songId: o.song, songQuery: '晚风 - 林晚', content: '[分享歌曲：晚风 - 林晚]', songLyric: '角色那一侧的歌词' });
  return engine.buildHistory(db.chats.get(o.chat), db.characters.get(o.char), db.messagesOf(o.chat), {}).map(m => m.content).join('\n');
}, ids);
ok('角色自己分享的那条不附歌词（免得示范它接着贴歌词）', !/角色那一侧的歌词/.test(h), h.slice(-200));

// 朋友圈：评论带歌的动态时同样附上
const asked = [];
await page.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  asked.push((body.messages || []).map(m => typeof m.content === 'string' ? m.content : '').join('\n'));
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"text":"好听"}' } }] }) });
});
await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const mo = db.moments.create({ authorId: 'me', text: '', images: [], likes: [], comments: [], songId: o.song });
  await (await import('/src/system/ai/tasks/moments.js')).commentMoment(mo.id, o.char);
}, ids);
ok('评论带歌的动态：同样附上歌词', /\[分享歌曲：晚风 - 林晚\]\n\[歌词\]\n第1句/.test(asked[0] || ''), (asked[0] || '').slice(0, 300));

// ---- 三、长按菜单 ----
await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  db.messagesOf(o.chat).filter(m => m.role === 'char' && m.kind === 'song').forEach(m => db.messages.remove(m.id));
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${o.chat}`);
}, ids);
await page.waitForTimeout(1000);
const hold = async () => {
  await page.locator('.msg', { has: page.locator('.bubble-song') }).first().dispatchEvent('contextmenu');
  await page.waitForTimeout(400);
};
await hold();
let sheet = await page.locator('.sheet').last().innerText();
ok('长按歌曲：有一起听、加入我的歌单、复制歌名；没有编辑', /从这首开始一起听/.test(sheet) && /加入我的歌单/.test(sheet)
  && /复制歌名/.test(sheet) && !/\n编辑\n/.test(`\n${sheet}\n`), sheet.slice(0, 400));
ok('菜单顶上那一行写的是歌，不是方括号标记', /分享歌曲：晚风 - 林晚/.test(sheet) && !/\[分享歌曲/.test(sheet));
await page.screenshot({ path: `${OUT}/musicmore-menu.png` });
await page.locator('.sheet .list-item', { hasText: '复制歌名' }).tap();
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
ok('复制歌名：复制的是「歌名 - 歌手」', clip === '晚风 - 林晚', clip);

await hold();
await page.locator('.sheet .list-item', { hasText: '加入我的歌单' }).tap();
await page.waitForTimeout(400);
sheet = await page.locator('.sheet').last().innerText();
ok('加入我的歌单：列出我的歌单，不列角色的', /通勤/.test(sheet) && !/夜里听/.test(sheet) && /新建歌单/.test(sheet), sheet);
await page.locator('.sheet .list-item', { hasText: '通勤' }).tap();
await page.waitForTimeout(300);
let t = await page.evaluate(async o => (await import('/src/system/db/index.js')).playlists.get(o.mine).trackIds, ids);
ok('选中后放进去了', JSON.stringify(t) === JSON.stringify([ids.song]), JSON.stringify(t));

await hold();
await page.locator('.sheet .list-item', { hasText: '从这首开始一起听' }).tap();
await page.waitForTimeout(500);
const ls = await page.evaluate(async () => {
  const l = await import('/src/system/listen.js');
  return { active: l.listen.get().active, cur: l.current()?.title };
});
ok('从这首开始一起听：一起听开了，放的是这首', ls.active && ls.cur === '晚风', JSON.stringify(ls));
await page.evaluate(async () => (await import('/src/system/listen.js')).stop());

// ---- 四、歌单详情 ----
await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.push(`/listen/${o.chat}`); }, ids);
await page.waitForTimeout(700);
await page.locator('.list-item', { hasText: '夜里听' }).tap();
await page.waitForTimeout(800);
let route = await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute());
let txt = await page.locator('.page').last().innerText();
ok('一起听页点角色的歌单：打开详情，列出曲目与是谁的歌单', route === `/local/${ids.hers}/${ids.chat}`
  && /林晚的歌单 · 共 2 首/.test(txt) && /晚风/.test(txt) && /海边/.test(txt), `${route} ${txt.slice(0, 200)}`);
await page.screenshot({ path: `${OUT}/musicmore-list.png` });
await page.locator('.mu-row', { hasText: '海边' }).locator('button', { hasText: '移除' }).tap();
await page.waitForTimeout(300);
t = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  return { tracks: db.playlists.get(o.hers).trackIds, inLib: !!db.songs.get(o.song2) };
}, ids);
ok('移除一首：从歌单拿掉，曲库里还在', JSON.stringify(t.tracks) === JSON.stringify([ids.song]) && t.inLib, JSON.stringify(t));
await page.locator('.btn', { hasText: '一起听' }).tap();
await page.waitForTimeout(500);
const ls2 = await page.evaluate(async () => {
  const l = await import('/src/system/listen.js');
  return { active: l.listen.get().active, list: l.listen.get().listId };
});
ok('详情页「一起听」：用这个歌单开始一起听', ls2.active && ls2.list === ids.hers, JSON.stringify(ls2));
await page.evaluate(async () => (await import('/src/system/listen.js')).stop());

// 曲库页也列着本机歌单
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('music', '/library'); });
await page.waitForTimeout(800);
txt = await page.locator('.page').last().innerText();
ok('曲库页列出本机歌单：我的在前，角色的写明是谁的', /通勤\n我的歌单 · 1 首/.test(txt) && /夜里听\n林晚的歌单 · 1 首/.test(txt)
  && txt.indexOf('通勤') < txt.indexOf('夜里听'), txt.slice(0, 400));
await page.locator('.mu-row', { hasText: '夜里听' }).tap();
await page.waitForTimeout(600);
txt = await page.locator('.page').last().innerText();
ok('从曲库进来没有会话，不显示「一起听」', !/一起听/.test(txt) && /晚风/.test(txt), txt.slice(0, 200));
await page.locator('.nav-text', { hasText: '删除' }).tap();
await page.waitForTimeout(300);
await page.locator('.modal-btn-primary', { hasText: '删除' }).tap();
await page.waitForTimeout(500);
t = await page.evaluate(async o => ({ gone: !(await import('/src/system/db/index.js')).playlists.get(o.hers),
  route: (await import('/src/system/nav.js')).currentRoute() }), ids);
ok('删除歌单：删掉并回到曲库', t.gone && t.route === '/library', JSON.stringify(t));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
