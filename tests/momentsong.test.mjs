// 朋友圈分享音乐：自己发动态时挑一首（曲库筛选、网易云搜索），卡片在动态里点开就放；
// 角色发动态时可以带一首（能用音乐时才告诉它怎么写），找不到就摘掉；评论的角色看得到那首歌
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
let reply = '{}';
const asked = [];
// 本站先当作没提供音乐服务（真实的 site.js 可能已填了 Worker），网易云由下面各步自己配
await ctx.route('**/src/site.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript',
  body: `export const SITE = { neteaseApi: '', neteaseRealIP: '', neteaseWorker: '' };` }));
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  asked.push((body.messages || []).map(m => typeof m.content === 'string' ? m.content : '').join('\n'));
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
});
await ctx.route('**/ne.example.com/**', async route => {
  const u = new URL(route.request().url());
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/cloudsearch') {
    const kw = u.searchParams.get('keywords') || '';
    if (/稻香/.test(kw)) return J({ code: 200, result: { songs: [
      { id: 777, name: '稻香', ar: [{ name: '周杰伦' }], al: { name: '魔杰座', picUrl: '' }, dt: 223000 }] } });
    return J({ code: 200, result: { songs: [] } });
  }
  if (u.pathname === '/lyric') return J({ code: 200, nolyric: true });
  return J({ code: 200 });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const music = await import('/src/system/music.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const c = db.characters.create({ name: '林晚', persona: 'x' });
  const song = music.addSong({ title: '晚风', artist: '林晚', url: 'data:audio/wav;base64,', seconds: 8 });
  music.addSong({ title: '海边', artist: '某人', url: 'data:audio/wav;base64,', seconds: 8 });
  return { char: c.id, song: song.id };
});

// ---- 一、自己发：挑一首曲库里的歌 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', '/moments'); });
await page.waitForTimeout(900);
await page.locator('[aria-label="发布"]').tap();
await page.waitForTimeout(400);
await page.locator('.sheet button', { hasText: '分享音乐' }).tap();
await page.waitForTimeout(400);
let sheet = await page.locator('.sheet').last().innerText();
ok('点「分享音乐」：列出曲库', /晚风/.test(sheet) && /海边/.test(sheet) && !/搜索网易云/.test(sheet), sheet.slice(0, 200));
await page.locator('.sheet').last().locator('input').fill('晚');
await page.waitForTimeout(200);
sheet = await page.locator('.sheet').last().innerText();
ok('输入框按歌名筛曲库', /晚风/.test(sheet) && !/海边/.test(sheet), sheet.slice(0, 200));
await page.locator('.sheet').last().locator('.list-item', { hasText: '晚风' }).tap();
await page.waitForTimeout(400);
ok('选中后发布表里是那首歌的卡片', /晚风/.test(await page.locator('.mo-song-pick').innerText()));
await page.screenshot({ path: `${OUT}/momentsong-compose.png` });
await page.locator('.sheet button', { hasText: /^发布$/ }).tap();
await page.waitForTimeout(500);
const mine = await page.evaluate(async () => (await import('/src/system/db/index.js')).moments.all().find(m => m.authorId === 'me'));
ok('只带一首歌、不写字也能发，存上 songId', mine && mine.songId === ids.song && !mine.text, JSON.stringify(mine));
ok('朋友圈里是那张歌曲卡片', /晚风/.test(await page.locator('.mo-card .mo-song').first().innerText()));
await page.screenshot({ path: `${OUT}/momentsong-feed.png` });
await page.locator('.mo-card .mo-song').first().tap();
await page.waitForTimeout(900);
let route = await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute());
ok('点卡片：放这首，进「正在播放」', /^\/now/.test(route) && /晚风/.test(await page.locator('.page').last().innerText()), route);
await page.evaluate(async () => (await import('/src/system/player.js')).stop());

// ---- 二、配了网易云：搜一首收进曲库 ----
await page.evaluate(async () => {
  (await import('/src/system/ai/services.js')).setNetease({ baseUrl: 'https://ne.example.com' });
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', '/moments');
});
await page.waitForTimeout(900);
await page.locator('[aria-label="发布"]').tap();
await page.waitForTimeout(300);
await page.locator('.sheet button', { hasText: '分享音乐' }).tap();
await page.waitForTimeout(300);
await page.locator('.sheet').last().locator('input').fill('稻香');
await page.locator('.sheet').last().locator('button', { hasText: '搜索网易云' }).tap();
await page.waitForTimeout(800);
await page.locator('.sheet').last().locator('.list-item', { hasText: '稻香' }).first().tap();
await page.waitForTimeout(300);
await page.locator('.sheet').first().locator('textarea').fill('今天的歌');
await page.locator('.sheet button', { hasText: /^发布$/ }).tap();
await page.waitForTimeout(400);
const ne = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const mo = db.moments.all().find(m => m.text === '今天的歌');
  const s = mo?.songId ? db.songs.get(mo.songId) : null;
  return s && { title: s.title, source: s.source, id: s.neteaseId };
});
ok('网易云搜到的那首收进曲库并挂到动态上', ne?.title === '稻香' && ne.source === 'netease' && ne.id === '777', JSON.stringify(ne));

// ---- 三、角色发动态带一首 ----
const gen = async (json, patch = {}) => {
  reply = JSON.stringify(json);
  asked.length = 0;
  return page.evaluate(async ([o, p]) => {
    const db = await import('/src/system/db/index.js');
    if (Object.keys(p).length) db.characters.update(o.char, p);
    const t = await import('/src/system/ai/tasks/moments.js');
    const mo = await t.createMoment(o.char);
    await new Promise(r => setTimeout(r, 800));
    const now = db.moments.get(mo.id);
    return { songId: now.songId || null, state: now.songState || '', query: now.songQuery || '' };
  }, [ids, patch]);
};
let got = await gen({ text: '循环了一下午', mood: '平静', imagePrompt: null, song: '晚风 - 林晚' });
ok('角色发动态：提示词里写明怎么带歌', /"song"/.test(asked[0] || ''), (asked[0] || '').slice(-300));
ok('带的那首在曲库里：挂上', got.songId === ids.song && got.state === 'done', JSON.stringify(got));
got = await gen({ text: '没找到的', song: '一首谁都没听过的歌' });
ok('两处都找不到：摘掉，不挂一张放不出来的卡片', !got.songId && !got.query, JSON.stringify(got));
got = await gen({ text: '关掉了', song: '晚风 - 林晚' }, { canListen: false });
ok('角色关了一起听：提示词里不提带歌，写了也不挂', !/"song"/.test(asked[0] || '') && !got.songId, JSON.stringify(got));
await page.evaluate(async o => (await import('/src/system/db/index.js')).characters.update(o.char, { canListen: true }), ids);

// ---- 四、评论的角色看得到那首歌 ----
reply = JSON.stringify({ text: '好听' });
asked.length = 0;
await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/ai/tasks/moments.js');
  const mo = db.moments.all().find(m => m.authorId === 'me' && m.songId === o.song);
  await t.commentMoment(mo.id, o.char);
}, ids);
ok('评论时动态正文后面附着那首歌', /\[分享歌曲：晚风 - 林晚\]/.test(asked[0] || ''), (asked[0] || '').slice(0, 300));

// ---- 五、角色包带上动态里的歌 ----
const pack = await page.evaluate(async o => {
  const cp = await import('/src/system/charpack.js');
  return (cp.collect(o.char).songs || []).map(s => s.title);
}, ids);
ok('角色包带上它动态里挂的歌', pack.includes('晚风'), JSON.stringify(pack));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
