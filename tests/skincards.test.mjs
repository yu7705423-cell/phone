// 各类卡片气泡的美化钩子与生成器旋钮，外加「显示头像」（ARCHITECTURE 4.201）。
//
//   转账、语音、通话、位置、礼物、译文：真会话页上挂着 ph- 钩子，生成器里各有一组旋钮，
//   分组标题下写出类名；时刻那一组多了居中那行时间的样式
//   头像：双方 / 仅角色 / 仅自己 / 都不显示，不显示的那一边连位置一起收掉
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// ---- 生成器写出来的 CSS ----
const css = await page.evaluate(async () => {
  const g = await import('/src/system/skin-gen.js');
  return {
    transfer: g.emit({ transfer: { bg: '#ff0000', fg: '#00ff00', r: 20 } }),
    mineGift: g.emit({ gift: { side: 'mine', bg: '#123456' } }),
    trans: g.emit({ trans: { fg: '#aa0000', fs: 12 } }),
    sep: g.emit({ meta: { sepBg: '#eeeeee', sepR: 8, sepColor: '#333333' } }),
    hideMine: g.emit({ avatar: { show: 'theirs' } }),
    hideAll: g.emit({ avatar: { show: 'none' } }),
    groups: g.GROUPS.map(x => x.id),
  };
});
ok('转账一组：写到 .ph-transfer 上', /\.ph-transfer \{[^}]*background: #ff0000 !important[^}]*color: #00ff00[^}]*border-radius: 20px/s.test(css.transfer), css.transfer);
ok('卡片里的小字、图标一并换颜色', /\.ph-transfer \* \{\s*color: #00ff00 !important/.test(css.transfer));
ok('只改自己那一边：前面挂 .ph-msg-mine', /\.ph-msg-mine \.ph-gift \{/.test(css.mineGift), css.mineGift);
ok('译文一组：字色字号写到 .ph-trans', /\.ph-trans \{[^}]*color: #aa0000[^}]*font-size: 12px/s.test(css.trans), css.trans);
ok('时刻一组：居中那行时间写到 .ph-time-sep', /\.ph-time-sep \{[^}]*background: #eeeeee[^}]*border-radius: 8px/s.test(css.sep), css.sep);
ok('显示头像「仅角色」：收掉自己那一边', /\.ph-msg-mine \.ph-face \{\s*display: none !important/.test(css.hideMine) && !/ph-msg-theirs \.ph-face/.test(css.hideMine), css.hideMine);
ok('显示头像「都不显示」：两边都收', /\.ph-msg-theirs \.ph-face, \.ph-msg-mine \.ph-face \{\s*display: none/.test(css.hideAll), css.hideAll);
ok('生成器里七种各有一组', ['trans', 'quote', 'voice', 'transfer', 'gift', 'location', 'call'].every(id => css.groups.includes(id)), css.groups.join(','));

// ---- 真会话页：每种卡片都挂着钩子，旋钮真的作用上去 ----
const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const skin = await import('/src/system/skin.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now(), translateTo: '英文' });
  db.settings.set({ translateOpen: 'always' });
  const base = { chatId: chat.id, status: 'done' };
  const ch = { ...base, role: 'char', authorId: c.id };
  const me = { ...base, role: 'user', authorId: 'me' };
  db.messages.create({ ...ch, kind: 'text', content: '你好', translation: 'Hello' });
  db.messages.create({ ...ch, kind: 'voice', content: '[语音：在吗]', voiceText: '在吗', media: 'done' });
  db.messages.create({ ...me, kind: 'transfer', amount: 52, note: '奶茶', transfer: 'pending', content: '[转账]' });
  db.messages.create({ ...ch, kind: 'gift', cover: '一个盒子', gift: 'pending', content: '[礼物]' });
  db.messages.create({ ...ch, kind: 'location', place: '海边', address: '滨海路', content: '[位置]' });
  db.messages.create({ ...me, kind: 'call', direction: 'out', outcome: 'done', seconds: 60, callKind: 'voice', callLog: [], content: '[通话]' });
  const s = skin.create({ name: '卡片', gen: { transfer: { bg: '#ff0000' }, avatar: { show: 'none' } } });
  skin.attach(chat.id, s.id);
  return { chat: chat.id, skin: s.id };
});
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${id}`); }, ids.chat);
await page.waitForTimeout(1200);
const real = await page.evaluate(() => {
  const n = s => document.querySelectorAll(s).length;
  return {
    hooks: Object.fromEntries(['trans', 'voice', 'transfer', 'gift', 'location', 'call'].map(h => [h, n(`.ph-${h}`)])),
    trBg: getComputedStyle(document.querySelector('.ph-transfer')).backgroundColor,
    faces: [...document.querySelectorAll('.ph-face')].map(f => getComputedStyle(f).display),
  };
});
ok('真会话页：六种都挂着钩子', Object.values(real.hooks).every(v => v >= 1), JSON.stringify(real.hooks));
ok('生成器的转账底色在真页面上生效', real.trBg === 'rgb(255, 0, 0)', real.trBg);
ok('「都不显示」：真页面上头像全收掉', real.faces.length > 0 && real.faces.every(d => d === 'none'), JSON.stringify(real.faces));

// ---- 生成器里写出类名 ----
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('skin', `/gen/${id}`); }, ids.skin);
await page.waitForTimeout(900);
await page.locator('.gen-rail-btn', { hasText: '转账' }).click();
await page.waitForTimeout(400);
ok('生成器转账一组：标题下写出类名', /\.ph-transfer/.test(await page.locator('.gen-panel-desc').innerText().catch(() => '')));
await page.locator('.gen-rail-btn', { hasText: '时刻' }).click();
await page.waitForTimeout(400);
ok('时刻一组：写出 .ph-time-sep', /\.ph-time-sep/.test(await page.locator('.gen-panel-desc').innerText().catch(() => '')));

// ---- 会话里的美化页：显示头像 ----
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/skin/${id}`); }, ids.chat);
await page.waitForTimeout(900);
await page.locator('.field', { hasText: '显示头像' }).locator('.seg-item', { hasText: '仅角色' }).click();
await page.waitForTimeout(300);
const show = await page.evaluate(async id => (await import('/src/system/skin.js')).get(id).gen.avatar.show, ids.skin);
ok('会话美化页改「显示头像」：写进这一份美化', show === 'theirs', show);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
