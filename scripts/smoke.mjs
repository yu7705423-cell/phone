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
  chat: ['/', '/moments', '/stickers', '/context', '/time', '/templates', '/caps',
    '/chat/:chat', '/translate/:chat', '/search', '/search/:chat', '/listen/:chat',
     '/profile/:char', '/edit/:char', '/proactive/:char', '/extras/:chat', '/pace/:chat',
     '/bond/:chat'],
  contact: ['/', '/import', '/me', '/me/:persona', '/char/:char',
    '/edit/:char', '/profile/:char', '/net/:char', '/npc/:char'],
  memory: ['/', '/import', '/edit/:mem'],
  lorebook: ['/', '/preview', '/map', '/book/:lore', '/entry/:lore/e1'],
  space: ['/', '/space/:chat', '/days/:chat', '/pacts/:chat', '/mail/:chat',
    '/log/:chat/gift', '/log/:chat/location', '/log/:chat/listen', '/log/:chat/call'],
  daily: ['/', '/gen', '/cell/env/good', '/cell/social/bad', '/cell/luck/plain',
    '/today', '/today/:char', '/food', '/food/', '/food/%E6%88%90%E9%83%BD'],
  theirs: ['/', '/home/:char', '/shelf/:char', '/body/:char', '/day/:char',
    '/notes/:char', '/browser/:char', '/chats/:char', '/album/:char', '/look/:char',
    '/make/:char', '/chat/nope',
    '/real/:char/:chat', '/real/:char/nope', '/real/nope/:chat',
    '/lock/:char', '/lock/nope', '/make/nope',
    '/home/nope', '/shelf/nope', '/body/nope', '/day/nope'],
  music: ['/', '/library', '/list/1'],
  bill: ['/', '/books', '/accounts', '/rules'],
  theater: ['/', '/videos', '/books', '/settings', '/watch/:chat', '/book/:ebook',
    '/read/:ebook', '/together/:chat/:ebook', '/shelf/:char',
    '/reviews/book/:ebook', '/reviews/video/:video', '/para/book/:ebook/0', '/para/video/:video/1'],
  album: ['/', '/album/:alb', '/photo/:pho', '/photo/:card'],
  health: ['/', '/log', '/cycle', '/meds', '/settings', '/char/:char'],
  settings: ['/', '/api', '/voice', '/image', '/embed', '/notify', '/music',
    '/appearance', '/storage', '/storage/files', '/trace', '/vision', '/asr', '/limits', '/search', '/translate', '/memoryapi', '/rerank'],
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
  // charId 是记忆现在的归属字段。scope 是 v3 之前的写法，迁移只跑老库，
  // 新建的行照着写就成了一条谁也挂不上的记忆，记忆那几页等于没测到
  const mem = db.memories.create({ charId: a.id, content: '一条记忆', category: 'fact', rank: 'A', keywords: [], personaId: me.id });
  const lore = db.lorebooks.create({ name: '一本世界书', description: '', global: false, entries: [
    { id: 'e1', comment: '雨城', keys: ['雨城'], secondaryKeys: [], content: '常年下雨的城市。',
      enabled: true, constant: false, priority: 100, order: 0,
      part: 'before', depth: 0, caseSensitive: false, probability: 100 },
    { id: 'e2', comment: '常驻', keys: [], secondaryKeys: [], content: '这一条始终注入。',
      enabled: true, constant: true, priority: 100, order: 1,
      part: 'after', depth: 2, caseSensitive: false, probability: 100 },
  ] });

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

  // 记账。**每一样都要有一份**：账户、共同账户、亲属卡、手记的流水、
  // 会话里的转账与申请。路由打得开不代表画得出来 —— 亲属卡那一段
  // 就是只在「有卡」时才求值，漏 import 的 Switch 靠空账本抓不到。
  const L = await import('/src/system/ledger.js');
  const rq = await import('/src/system/request.js');
  const tr = await import('/src/system/transfer.js');
  const bk = L.create({ name: '我们俩', kind: 'play', chatId: chat.id });
  const mine = L.accountsOf(bk.id)[0];
  const hers = L.addAccount(bk.id, { name: '她的钱包', owner: 'char' });
  L.ensureJoint(bk.id);
  L.addCard(bk.id, { from: 'me', to: 'char', limit: 500 });
  L.add({ bookId: bk.id, accountId: mine.id, amount: 3000, category: 'salary', note: '工资' });
  L.add({ bookId: bk.id, accountId: hers.id, amount: -42, category: 'food', note: '早饭' });
  L.add({ bookId: bk.id, accountId: mine.id, amount: -88, category: 'shopping',
    note: '聊天里说买的', src: 'chat', pending: true });
  L.addRule(bk.id, { accountId: mine.id, day: 1, amount: 8000, category: 'salary', note: '工资' });
  L.addAccount(bk.id, { name: '她的私房钱', owner: 'char', secret: true, pass: '0314', hint: '和某个日期有关' });
  L.update(bk.id, { settle: true });
  L.create({ name: '我的账本', kind: 'real' });
  const paid = tr.send({ chatId: chat.id, role: 'user', authorId: 'me', amount: 100, note: '给你' });
  tr.settle(paid.id, true);
  rq.send({ chatId: chat.id, role: 'char', authorId: a.id, kind: rq.SPEND, amount: 200, note: '买菜' });
  const okd = rq.send({ chatId: chat.id, role: 'char', authorId: a.id, kind: rq.CARD, amount: 300 });
  rq.settle(okd.id, true);

  // 相册：一本相册、一张图、一张卡片，三种都要有
  const alb = await import('/src/system/album.js');
  const book1 = alb.createAlbum('她发的图');
  const blank = await (await fetch('data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==')).blob();
  const imgId = await db.images.put(new File([blank], 'a.gif', { type: 'image/gif' }));
  const pho = alb.saveImage({ imageId: imgId, albumId: book1.id,
    from: { chatId: chat.id, charId: a.id, name: '甲', at: Date.now() } });
  const cardPhoto = await alb.saveCard({
    msgs: alb.freeze([{ id: 'm1', role: 'char', authorId: a.id, kind: 'text',
      content: '这一条存进了相册。', createdAt: Date.now() }], { meName: '我' }),
    css: '.bubble { border-radius: 2px }', title: '甲',
  });

  // 健康。每一页都要有东西，空状态跑不出真问题
  const hl = await import('/src/system/health.js');
  const today = hl.dateKey();
  hl.set(hl.ME, today, { sleepMin: 450, sleepAt: '23:40', steps: 8200,
    weight: 58.2, water: 3, mood: 'flat', energy: 'low', symptoms: ['headache'], note: '下午有点困' });
  hl.set(hl.ME, hl.shiftDate(today, -1), { sleepMin: 400, steps: 6100, weight: 58.5 });
  hl.set(hl.ME, hl.shiftDate(today, -2), { sleepMin: 500, steps: 9300, weight: 58.0 });
  hl.startCycle(hl.shiftDate(today, -60));
  hl.endCycle(hl.listCycles()[0].id, hl.shiftDate(today, -55));
  hl.startCycle(hl.shiftDate(today, -32));
  hl.endCycle(hl.listCycles()[0].id, hl.shiftDate(today, -27));
  hl.addMed({ name: '维生素 D', dose: '一粒', times: ['08:00'] });
  hl.setCharOn(a.id, true);
  hl.set(a.id, today, { energy: 'low', mood: 'flat', symptoms: ['throat'], note: '嗓子有点哑' });

  // 一本书与一部片子，一起看那个 app 的几条路由要用
  const bookMod = await import('/src/system/book.js');
  const ebk = await bookMod.add({
    title: '雨城旧事', author: '某人', kind: 'txt',
    text: '第一章 到站\n天还没亮，车就停了。\n\n第二章 旅馆\n老板娘说只剩一间。',
    chapters: [{ title: '第一章 到站', start: 0, end: 20 },
      { title: '第二章 旅馆', start: 20, end: 44 }],
  });
  bookMod.setAt(ebk.id, 10);
  const shelfMod = await import('/src/system/shelf.js');
  shelfMod.add(a.id, { title: '雨城旧事', author: '某人' });
  shelfMod.add(a.id, { title: '还没导入的那本', author: '别人' });
  const videoMod = await import('/src/system/video.js');
  const vid = videoMod.addVideo({ title: '一部片子', url: 'https://example.com/a.mp4',
    subtitle: '1\n00:00:01,000 --> 00:00:04,000\n第一句\n' });
  const paraMod = await import('/src/system/paracomment.js');
  const bookSubj = paraMod.subjectOf(paraMod.BOOK, ebk.id);
  paraMod.add({ subject: bookSubj, at: 0, text: '开头这一句写得很静。',
    kind: paraMod.CHAR, authorId: a.id, authorName: '甲' });
  paraMod.add({ subject: bookSubj, at: 0, text: '我也在下雨天读的。',
    kind: paraMod.READER, authorName: '路过的读者' });
  paraMod.setCrew(bookSubj, [a.id]);
  db.reviews.create({ kind: 'book', subjectId: ebk.id, charId: a.id, title: '雨城旧事',
    text: '看完之后想起一件事。\n第二段。', at: 10, createdAt: Date.now() });

  return { char: a.id, chat: chat.id, mem: mem.id, persona: me.id, book: bk.id, ebook: ebk.id, video: vid.id, lore: lore.id,
    alb: book1.id, pho: pho.id, card: cardPhoto.id };
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
