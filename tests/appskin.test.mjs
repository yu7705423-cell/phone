// 应用美化：消息列表、联系人、朋友圈、主页的契约钩子全都挂着；
// 美化 app 里单独那一页能新建、能写样式并实时生效、能一键恢复默认（见 ARCHITECTURE 4.229）
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

// 造齐每个钩子要的条件：置顶、未读、免打扰、群聊、星标、NPC、签名、
// 带图带评论的动态、我自己的动态、撤回的动态、精选、换过的头像
const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const png = await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==').then(r => r.blob());
  const img = async () => db.images.put(new File([png], 'a.png', { type: 'image/png' }));
  const [i1, i2, i3, i4, i5] = [await img(), await img(), await img(), await img(), await img()];
  const a = db.characters.create({ name: '阿岚', signature: '今天也在', star: true, pinned: true,
    avatar: i1, avatarBase: i2, highlights: [{ id: 'hl1', imageId: i3, title: '旅行' }] });
  const b = db.characters.create({ name: '小北', isNpc: true });
  const now = Date.now();
  const one = db.chats.create({ characterIds: [a.id], pinned: true, unread: 3, lastMessageAt: now });
  const grp = db.chats.create({ characterIds: [a.id, b.id], group: true, muted: true, lastMessageAt: now - 1000 });
  db.messages.create({ chatId: one.id, role: 'char', authorId: a.id, kind: 'text', content: '在吗', status: 'done' });
  db.messages.create({ chatId: grp.id, role: 'char', authorId: b.id, kind: 'text', content: '大家好', status: 'done' });
  const mo = db.moments.create({ authorId: a.id, text: '海边', images: [i4, i5], likes: ['me'],
    comments: [{ id: 'c1', authorId: 'me', text: '好看' }] });
  db.moments.create({ authorId: 'me', text: '我的一条', images: [i4], likes: [], comments: [] });
  const gone = db.moments.create({ authorId: a.id, text: '撤回的', images: [], likes: [], comments: [], recalled: true });
  const me = db.persona.get();
  db.personas.update(me.id, { highlights: [{ id: 'hl2', imageId: i3, title: '日常' }] });
  return { a: a.id, mo: mo.id, gone: gone.id };
});

const go = (app, route) => page.evaluate(async ([ap, r]) => {
  const n = await import('/src/system/nav.js');
  n.unlock(); n.openApp(ap, '/'); n.popToRoot(); if (r !== '/') n.push(r);
}, [app, route]);
const seen = new Set();
const collect = async () => {
  const got = await page.evaluate(() => [...document.querySelectorAll('[class*="ph-"]')]
    .flatMap(el => [...el.classList]).filter(c => c.startsWith('ph-')).map(c => c.slice(3)));
  got.forEach(c => seen.add(c));
  return new Set(got);
};
const tab = async i => { await page.locator('.ph-tab').nth(i).click(); await page.waitForTimeout(700); };

// ---- 一、四个分区与两个子页，钩子全都挂着 ----
await go('chat', '/');
await page.waitForSelector('.ph-chat-row');
await tab(0);
const onChats = await collect();
ok('消息列表：置顶、未读、免打扰、群聊各自带着钩子',
  ['chat-row-pinned', 'chat-row-unread', 'chat-row-muted', 'chat-row-group', 'group-face', 'chat-row-star']
    .every(h => onChats.has(h)), [...onChats].filter(h => h.startsWith('chat')).join(' '));

await tab(1);
const onContacts = await collect();
ok('联系人：置顶与 NPC 各自带着钩子',
  onContacts.has('contact-row-pinned') && onContacts.has('contact-row-npc'), [...onContacts].join(' '));

await tab(2);
await page.locator('.ph-moment-recalled-line').first().click();
await page.waitForTimeout(400);
const onMoments = await collect();
ok('朋友圈：我的那一条另带 ph-moment-mine', onMoments.has('moment-mine'), [...onMoments].join(' '));

await tab(3);
await page.locator('.ph-profile-tab').nth(1).click();
await page.waitForTimeout(500);
await collect();
await page.locator('.ph-profile-tab').nth(0).click();
await page.waitForTimeout(500);
const onMe = await collect();
ok('我的主页带 ph-profile-me', onMe.has('profile-me'), [...onMe].join(' '));

await go('chat', `/profile/${ids.a}`);
await page.waitForTimeout(900);
const onHer = await collect();
ok('角色主页不带 ph-profile-me', onHer.has('profile') && !onHer.has('profile-me'), [...onHer].join(' '));

await go('chat', `/moment/${ids.mo}`);
await page.waitForTimeout(900);
await collect();
await go('chat', `/moment/${ids.gone}`);
await page.waitForTimeout(900);
await collect();

const miss = await page.evaluate(async list => {
  const skin = await import('/src/system/skin.js');
  // 这两个要另造一首歌、一段满三天的对话，由别的测试管
  const skip = ['moment-song', 'level-ring'];
  return skin.HOOKS.filter(h => ['chats', 'contacts', 'moments', 'profile'].includes(h.group))
    .map(h => h.hook).filter(h => !skip.includes(h) && !list.includes(h));
}, [...seen]);
ok('消息列表、联系人、朋友圈、主页登记的钩子全都挂着', miss.length === 0, miss.join('、'));

// 挂了钩子的图不再写内联 background-image（美化盖不住内联样式）
const inline = await page.evaluate(() => [...document.querySelectorAll('[class*="ph-"]')]
  .filter(el => /background-image/.test(el.getAttribute('style') || '')).map(el => el.className));
ok('钩子上没有内联 background-image', inline.length === 0, inline.join(' | '));
const slideBg = await page.evaluate(() => {
  const el = document.querySelector('.ph-moment-detail-slide') || document.querySelector('.ph-profile-cell');
  return el ? getComputedStyle(el).backgroundImage : 'none';
});
await go('chat', `/moment/${ids.mo}`);
await page.waitForTimeout(900);
const bigBg = await page.evaluate(() => getComputedStyle(document.querySelector('.ph-moment-detail-slide')).backgroundImage);
ok('图片改走变量之后照样画得出来', /url\(/.test(bigBg), `${bigBg} ${slideBg}`);

// ---- 二、应用美化那一页 ----
await go('skin', '/');
await page.waitForTimeout(700);
await page.locator('.list-item', { hasText: '应用美化' }).first().click();
await page.waitForTimeout(700);
ok('美化库里有「应用美化」的入口，点进去是那一页',
  await page.locator('.ph-nav-title', { hasText: '应用美化' }).count() > 0);
await page.locator('button', { hasText: '新建应用美化' }).click();
await page.waitForTimeout(700);
const made = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const skin = await import('/src/system/skin.js');
  const row = skin.get(db.settings.get().globalSkinId || '');
  return row ? { id: row.id, scope: skin.scopeOf(row), name: row.name } : null;
});
ok('新建之后立即成为全局那一份，范围是整个应用',
  made && JSON.stringify(made.scope) === '["shell"]', JSON.stringify(made));

await page.locator('textarea').first().fill('.ph-chat-row { opacity: 0.5 }');
await page.waitForTimeout(700);
ok('写下的样式立即挂上', await page.evaluate(() =>
  (document.getElementById('skin-global')?.textContent || '').includes('ph-chat-row')));

// 类名清单分组，点一下复制
await page.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
await page.locator('.chip', { hasText: '朋友圈' }).click();
await page.waitForTimeout(300);
await page.getByText('.ph-moment-photo', { exact: true }).click();
ok('类名按组列出，点一下复制', await page.evaluate(() => window.__copied) === '.ph-moment-photo',
  await page.evaluate(() => window.__copied));

await go('chat', '/');
await tab(0);
const dim = await page.evaluate(() => getComputedStyle(document.querySelector('.ph-chat-row')).opacity);
ok('消息列表上真的生效', dim === '0.5', dim);

await go('skin', '/app');
await page.waitForTimeout(700);
await page.locator('button', { hasText: '恢复默认样式' }).click();
await page.locator('.modal button', { hasText: '恢复默认' }).click();
await page.waitForTimeout(700);
const after = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const skin = await import('/src/system/skin.js');
  return { global: db.settings.get().globalSkinId, kept: !!skin.get(id), node: !!document.getElementById('skin-global') };
}, made?.id);
ok('一键恢复默认：全局取消、样式节点摘掉', !after.global && !after.node, JSON.stringify(after));
ok('一键恢复默认不删那一份', after.kept, JSON.stringify(after));

await page.locator('.list-item', { hasText: '应用美化' }).locator('button', { hasText: '启用' }).click();
await page.waitForTimeout(700);
const back = await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().globalSkinId);
ok('在「可启用的美化」里点一下就回来', back === made?.id, back);

await go('chat', '/');
await tab(0);
const dim2 = await page.evaluate(() => getComputedStyle(document.querySelector('.ph-chat-row')).opacity);
ok('重新启用后样式照旧', dim2 === '0.5', dim2);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
