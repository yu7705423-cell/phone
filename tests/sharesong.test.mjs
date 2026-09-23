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
