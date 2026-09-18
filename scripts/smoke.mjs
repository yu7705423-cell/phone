// 把每个 app 的每条路由都打开一遍，看有没有页面炸掉。
//
// doctor 的「导入导出」只查模块之间的引用，查不到文件内部引用了一个
// 不存在的函数 —— 那种错要到运行时打开那个页面才炸。这个脚本就是补那一刀。
//
//   python3 -m http.server 8000 &
//   node scripts/smoke.mjs
//
// 需要 playwright。没装就跳过，不拦提交。

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:8000';

// 每条路由都要在「有数据」的前提下打开，空库跑不出真问题
const ROUTES = {
  chat: ['/', '/moments', '/stickers', '/context', '/time', '/templates',
    '/chat/:chat', '/translate/:chat', '/search', '/search/:chat', '/listen/:chat',
     '/profile/:char', '/edit/:char', '/proactive/:char', '/extras/:chat', '/pace/:chat',
     '/bond/:chat'],
  contact: ['/', '/import', '/me', '/me/:persona', '/char/:char',
    '/edit/:char', '/profile/:char', '/net/:char', '/npc/:char'],
  memory: ['/', '/import', '/edit/:mem'],
  lorebook: ['/', '/preview', '/map'],
  space: ['/', '/space/:chat', '/days/:chat', '/pacts/:chat', '/mail/:chat',
    '/log/:chat/gift', '/log/:chat/location', '/log/:chat/listen', '/log/:chat/call'],
  daily: ['/', '/gen', '/cell/env/good', '/cell/social/bad', '/cell/luck/plain',
    '/today', '/today/:char', '/food', '/food/', '/food/%E6%88%90%E9%83%BD'],
  settings: ['/', '/api', '/voice', '/image', '/embed', '/notify', '/music',
    '/appearance', '/storage', '/trace', '/vision', '/asr', '/limits', '/search'],
};

// 本项目不装 npm 依赖（CLAUDE.md 第 9 条），所以 playwright 从别处借：
// SMOKE_PW 指向一个装了 playwright 的目录即可。
let chromium;
const pw = process.env.SMOKE_PW ? `${process.env.SMOKE_PW}/node_modules/playwright/index.mjs` : 'playwright';
try { ({ chromium } = await import(pw)); }
catch { console.log('  跳过：找不到 playwright。装一个，或者用 SMOKE_PW=<某个装了它的目录> 指过去'); process.exit(0); }

const exe = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// 造一点数据，否则大部分页面走的是空状态分支
const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const card = await import('/src/system/ai/tasks/card.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设甲', age: '22', gender: '女' });
  const b = db.characters.create({ name: '乙', persona: '人设乙', isNpc: true });
  card.link(a.id, b.id, '同学', '同学');
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', kind: 'text', content: '嗨', status: 'done' });
  const mem = db.memories.create({ scope: `character:${a.id}`, content: '一条记忆', category: 'fact', rank: 'A', keywords: [], personaId: me.id });
  db.lorebooks.create({ name: '一本世界书', entries: [] });

  // 事件库也要有几条，空库只走空状态
  const events = await import('/src/system/events.js');
  events.add({ domain: 'env', tone: 'good', rarity: 'common', text: '路上一路绿灯' });
  events.add({ domain: 'social', tone: 'bad', rarity: 'common', text: '被临时叫去加班' });
  events.add({ domain: 'luck', tone: 'plain', rarity: 'rare', text: '排队时前面的人让了位' });

  // 角色的一天与食谱库
  const dayStore = await import('/src/system/day.js');
  const food = await import('/src/system/food.js');
  db.characters.update(a.id, { dayOn: true, region: '成都' });
  food.add({ region: '成都', name: '担担面', place: '陈记面馆', meal: 'lunch' });
  food.add({ region: '', name: '煎蛋', meal: 'breakfast' });
  dayStore.save(a.id, {
    date: dayStore.dateKey(db.characters.get(a.id)),
    items: [{ slot: 'morning', text: '去邮局取包裹' }, { slot: 'evening', text: '看完那部片子' }],
    event: { eventId: 'x', text: '路上一路绿灯', tone: 'good', domain: 'env', slot: 'morning' },
    luck: 0.8,
    meals: [{ meal: 'lunch', name: '担担面', place: '陈记面馆', recipeId: 'x' }],
  });
  food.record({ charId: a.id, meal: 'lunch', name: '担担面', place: '陈记面馆' });

  // 情侣空间的几页要有东西才走得到真正的分支，空状态跑不出问题
  const space = await import('/src/system/space.js');
  db.chats.update(chat.id, { loveStartAt: Date.now() - 86400000 * 100, spaceInject: true });
  space.addDay({ chatId: chat.id, title: '认识的日子', date: '2025-03-04', yearly: true });
  space.makePact({ chatId: chat.id, role: 'user', authorId: 'me', title: '一起去看海' });
  const donePact = space.makePact({ chatId: chat.id, role: 'char', authorId: a.id, title: '早点睡' });
  space.completePact(donePact.id);
  space.sendLetter({ chatId: chat.id, role: 'char', authorId: a.id, title: '给你', body: '今天路过那家店' });
  space.saveDraft({ chatId: chat.id, title: '还没寄', body: '想说又没说的话' });
  const gift = await import('/src/system/gift.js');
  gift.send({ chatId: chat.id, role: 'char', authorId: a.id, cover: '一盒糖', inner: '一张纸条' });
  const place = await import('/src/system/place.js');
  place.send({ chatId: chat.id, role: 'user', authorId: 'me', place: '海边', address: '滨海路 1 号' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'listen',
    seconds: 1830, trackIds: [], content: '[一起听了 30 分钟，0 首]', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'call',
    direction: 'out', outcome: 'done', seconds: 95, callKind: 'voice', callLog: [],
    content: '[通话 01:35]', status: 'done' });

  return { char: a.id, chat: chat.id, mem: mem.id, persona: me.id };
});
await page.waitForTimeout(400);

let bad = 0, n = 0;
for (const [appId, routes] of Object.entries(ROUTES)) {
  for (const raw of routes) {
    const route = raw.replace(/:(\w+)/g, (_, k) => ids[k]);
    n++;
    errors.length = 0;
    await page.evaluate(async ([app, r]) => {
      const nav = await import('/src/system/nav.js');
      nav.goHome();
      nav.openApp(app, r);
    }, [appId, route]);
    await page.waitForTimeout(450);
    const crashed = await page.locator('.boundary, .err-box').count().catch(() => 0);
    const text = await page.locator('.app-layer').innerText().catch(() => '');
    const stopped = /已停止/.test(text);
    if (crashed || stopped || errors.length) {
      bad++;
      const why = stopped ? text.split('\n').slice(0, 2).join(' / ') : errors[0] || '崩了';
      console.log(`  FAIL ${appId}${route}  ${why}`);
    }
  }
}

await browser.close();
console.log(bad ? `\n${n} 条路由里 ${bad} 条炸了` : `\n${n} 条路由全部打得开`);
process.exit(bad ? 1 : 0);
