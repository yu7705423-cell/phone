// 衣帽间（system/closet.js、apps/closet，ARCHITECTURE 4.213）。
//
//   估算：余量按容量、每次用量、每天次数从开封那天扣；保质期三种依据（填的日期 / 开封加 PAO / 购入加未开封）
//   低频提醒：快用完的东西只在第一次递给角色的那一天出现，过了冷却期才再出现（代码管频率，不靠提示词）
//   上下文：今天穿的带来源（谁送的、哪天）；清单只在聊到穿搭、化妆时带
//   界面：手动添加、今天穿的、礼物气泡「收进衣帽间」、识图填空着的几项
//   登记：删角色连它的衣帽间一起删，我这边收着它送的东西不动；角色包带走它的衣帽间
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
let visionReply = '{}';
await page.route('https://vision.example.com/**', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ choices: [{ message: { content: visionReply } }] }) }));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const DAY = 86400000;
const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
});
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- 估算 ----
const calc = await ev(async () => {
  const cl = await import('/src/system/closet.js');
  const pad = n => String(n).padStart(2, '0');
  const key = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const now = Date.now();
  // 30 毫升，每次 2 泵（0.25 毫升一泵），每天 1 次：一天 0.5 毫升，能用 60 天。开封 30 天了
  const f = cl.create({ group: 'base', sub: '粉底', name: '粉底液', capacity: 30, perDay: 1, openedAt: key(now - 30 * 86400000) });
  const r1 = cl.remaining(f, now);
  const e1 = cl.expiry(f, now);
  const set = cl.create({ group: 'lip', sub: '口红', name: '口红', expireAt: key(now + 10 * 86400000), openedAt: key(now) });
  const bought = cl.create({ group: 'skin', sub: '乳霜', name: '面霜', buyAt: key(now) });
  cl.calibrate(f.id, 80);
  const r2 = cl.remaining((await import('/src/system/db/index.js')).db.closet.get(f.id), now);
  return {
    pct: r1.pct, days: r1.daysLeft, dose: f.dose, unit: f.doseUnit, pao: f.pao,
    expBasis: e1.basis, expSet: cl.expiry(set, now).basis, setDays: cl.expiry(set, now).daysLeft,
    boughtBasis: cl.expiry(bought, now).basis, boughtDays: cl.expiry(bought, now).daysLeft,
    wearExp: cl.expiry(cl.create({ group: 'top', name: '衬衫' }), now), cal: r2.pct, fid: f.id,
  };
});
ok('小类的默认用量：粉底 2 泵、开封后 12 个月', calc.dose === 2 && calc.unit === '泵' && calc.pao === 12, JSON.stringify(calc));
// 开封日期按那天零点算，今天已经过去的这几个小时也扣，所以是 49% 到 50%
ok('余量：开封 30 天，按一天半毫升算，剩一半、还能用 30 天', calc.pct >= 49 && calc.pct <= 50 && calc.days >= 29 && calc.days <= 30, JSON.stringify(calc));
ok('保质期：只有开封日期，按开封加 12 个月', calc.expBasis === 'opened', calc.expBasis);
ok('保质期：填了保质日期就按填的', calc.expSet === 'set' && calc.setDays >= 9 && calc.setDays <= 10, JSON.stringify(calc));
ok('保质期：只有购入日期，按未开封 36 个月', calc.boughtBasis === 'bought' && calc.boughtDays > 1000, JSON.stringify(calc));
ok('衣服不算保质期', calc.wearExp === null);
ok('按实际剩余校准：从现在的百分比重新扣', calc.cal === 80, calc.cal);

// ---- 低频提醒 ----
const alerts = await ev(async () => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const pad = n => String(n).padStart(2, '0');
  const key = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  db.closet.all().forEach(r => db.closet.remove(r.id));
  const now = Date.now();
  // 开封 57 天：只剩 5%
  const low = cl.create({ group: 'base', sub: '粉底', name: '快用完的粉底', capacity: 30, perDay: 1, openedAt: key(now - 57 * 86400000) });
  const a = cl.takeAlerts(undefined, now).map(x => x.item.name);
  const b = cl.takeAlerts(undefined, now + 3600000).map(x => x.item.name);        // 同一天再问
  const c = cl.takeAlerts(undefined, now + 86400000 * 1.5).map(x => x.item.name);  // 第二天
  const d = cl.takeAlerts(undefined, now + 86400000 * 31).map(x => x.item.name);   // 冷却期过了
  return { a, b, c, d, low: low.id };
});
ok('快用完：第一次递给角色', alerts.a.includes('快用完的粉底'), JSON.stringify(alerts));
ok('同一天里照样带着', alerts.b.includes('快用完的粉底'), JSON.stringify(alerts));
ok('第二天起不再出现（不会天天说）', !alerts.c.length, JSON.stringify(alerts));
ok('过了 30 天冷却期才再出现一次', alerts.d.includes('快用完的粉底'), JSON.stringify(alerts));

// ---- 上下文 ----
const sysOf = text => ev(async ({ chat, char, text }) => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  if (text) db.messages.create({ chatId: chat, role: 'user', authorId: 'me', kind: 'text', content: text, status: 'done' });
  const r = engine.buildChatSystem(db.chats.get(chat), db.characters.get(char), db.messagesOf(chat));
  return r.system + '\n' + (r.volatile || '');
}, { ...ids, text });
await ev(async ({ char }) => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  db.closet.all().forEach(r => db.closet.remove(r.id));
  const k = cl.create({ group: 'top', sub: '针织 / 毛衣', name: '白色针织衫', colors: ['white'], desc: '软糯的羊毛开衫' });
  const e = cl.create({ group: 'jewelry', sub: '耳饰', name: '珍珠耳环', source: 'gift', giver: char, giftAt: new Date(2026, 7, 29).getTime() });
  cl.create({ group: 'bottom', sub: '牛仔裤', name: '直筒牛仔裤' });
  cl.create({ group: 'lip', sub: '口红', name: '豆沙色口红' });
  cl.wear(k.id, true); cl.wear(e.id, true);
}, ids);
let sys = await sysOf('');
ok('今天穿的：名字、分类、描述都在', /白色针织衫 \(上装 \/ 针织 \/ 毛衣; 白\): 软糯的羊毛开衫/.test(sys), sys.slice(-800));
ok('今天戴着它送的：写明是它送的、哪天', /珍珠耳环[^\n]*a gift from you, 2026-08-29/.test(sys), sys.slice(-800));
ok('没聊到穿搭：不带衣橱清单', !/## [^\n]*wardrobe/.test(sys) && !/直筒牛仔裤/.test(sys));
sys = await sysOf('明天约会穿什么好');
ok('聊到穿搭：按大类带上衣橱清单', /'s wardrobe/.test(sys) && /下装: 直筒牛仔裤/.test(sys), sys.slice(-800));
ok('聊穿搭时不带妆台清单', !/豆沙色口红/.test(sys));
sys = await sysOf('这支口红什么颜色好看');
ok('聊到化妆：带上妆台清单', /dressing table/.test(sys) && /唇妆: 豆沙色口红/.test(sys), sys.slice(-800));
ok('提示里只说事实：不替角色决定提不提', !/mention|bring up|naturally|casually/i.test(sys.split('[衣帽间]')[1] || ''), sys.split('[衣帽间]')[1]);

// ---- 界面：手动添加 ----
await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.closet.all().forEach(r => db.closet.remove(r.id));
  db.settings.set({ closetOwner: 'me', closetSide: 'wear' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('closet', '/');
});
await page.waitForTimeout(800);
ok('首页：大类卡片一屏看全', await page.locator('.cl-group').count() === 10);
await page.locator('[aria-label="添加"]').click();
await page.waitForTimeout(300);
await page.locator('.cl-add-way', { hasText: '手动添加' }).click();
await page.locator('.sheet .chip', { hasText: '外套' }).click();
await page.locator('.sheet .chip', { hasText: '风衣' }).click();
await page.locator('.sheet input').last().fill('卡其风衣');
await page.locator('.sheet button', { hasText: '放进去' }).click();
await page.waitForTimeout(500);
const made = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const n = await import('/src/system/nav.js');
  return { row: db.closet.all().find(r => r.name === '卡其风衣'), route: n.currentRoute() };
});
ok('手动添加：放进外套、风衣，打开单品页', made.row && made.row.group === 'outer' && made.row.sub === '风衣'
  && made.route === `/item/${made.row.id}`, JSON.stringify(made));

// ---- 今天穿的 ----
await page.locator('.cl-acts button', { hasText: '今天穿' }).click();
await page.waitForTimeout(300);
let row = await ev(async id => (await import('/src/system/db/index.js')).db.closet.get(id), made.row.id);
ok('今天穿：记上今天，穿过次数加一', row.wornCount === 1 && !!row.wornOn, JSON.stringify(row));
await page.locator('.cl-acts button', { hasText: '今天穿着' }).click();
await page.waitForTimeout(300);
row = await ev(async id => (await import('/src/system/db/index.js')).db.closet.get(id), made.row.id);
ok('当天取消：次数减回去', row.wornCount === 0 && !row.wornOn, JSON.stringify(row));

// ---- 识图 ----
const vis = await ev(async () => {
  const svc = await import('/src/system/ai/services.js');
  svc.setVision({ mode: 'api', baseUrl: 'https://vision.example.com/v1', apiKey: 'k', model: 'v' });
  const cl = await import('/src/system/closet.js');
  const c = document.createElement('canvas'); c.width = 20; c.height = 20;
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const [row] = await cl.addPhotos([new File([blob], 'a.png', { type: 'image/png' })]);
  return row.id;
});
visionReply = JSON.stringify({ group: 'shoes', sub: '靴子', name: '棕色短靴', colors: ['brown', 'nope'], seasons: ['autumn'],
  occasions: ['daily'], desc: '磨砂皮短靴' });
const rec = await ev(async id => {
  const t = await import('/src/system/ai/tasks/closet.js');
  await t.recognize(id);
  return (await import('/src/system/db/index.js')).db.closet.get(id);
}, vis);
ok('识图：填上分类、名字、颜色、季节、描述；认不出的颜色丢掉', rec.group === 'shoes' && rec.sub === '靴子' && rec.name === '棕色短靴'
  && JSON.stringify(rec.colors) === '["brown"]' && rec.desc === '磨砂皮短靴', JSON.stringify(rec));
visionReply = JSON.stringify({ group: 'bag', name: '别的名字', desc: '别的描述' });
const rec2 = await ev(async id => {
  const t = await import('/src/system/ai/tasks/closet.js');
  await t.recognize(id);
  return (await import('/src/system/db/index.js')).db.closet.get(id);
}, vis);
ok('再识一次：已填的不覆盖', rec2.group === 'shoes' && rec2.name === '棕色短靴' && rec2.desc === '磨砂皮短靴', JSON.stringify(rec2));

// ---- 礼物 ----
const giftId = await ev(async ({ chat, char }) => {
  const gift = await import('/src/system/gift.js');
  const { db } = await import('/src/system/db/index.js');
  gift.send({ chatId: chat, role: 'char', authorId: char, cover: '一个小盒子', inner: '银色手链' });
  const m = db.messagesOf(chat).filter(x => x.kind === 'gift').pop();
  db.messages.update(m.id, { gift: gift.OPENED });
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${chat}`);
  return m.id;
}, ids);
await page.waitForTimeout(900);
await page.locator('.gift-closet').last().click();
await page.waitForTimeout(800);
const g1 = await ev(async id => {
  const { db } = await import('/src/system/db/index.js');
  const n = await import('/src/system/nav.js');
  return { rows: db.closet.all().filter(r => r.giftMsgId === id), app: n.currentApp?.() || '', route: n.currentRoute() };
}, giftId);
ok('拆开的礼物「收进衣帽间」：收进我的，记上谁送的', g1.rows.length === 1 && g1.rows[0].owner === 'me'
  && g1.rows[0].giver === ids.char && g1.rows[0].name === '银色手链' && g1.route === `/item/${g1.rows[0].id}`, JSON.stringify(g1));
ok('单品页写着来历：来源是收到的礼物，谁送的选中阿岚', await page.evaluate(() => {
  const t = document.querySelector('.app-layer').innerText;
  return /收到的礼物/.test(t) && [...document.querySelectorAll('.app-layer .chip.is-active')].some(b => b.textContent.includes('阿岚'));
}));
await ev(async ({ chat }) => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${chat}`); }, ids);
await page.waitForTimeout(800);
await page.locator('.gift-closet').last().click();
await page.waitForTimeout(800);
const g2 = await ev(async id => (await import('/src/system/db/index.js')).db.closet.all().filter(r => r.giftMsgId === id).length, giftId);
ok('再点一次：打开已收的那件，不重复收', g2 === 1, g2);

// ---- 我送的礼物，角色拆开：直接收进它的衣帽间 ----
const auto = await ev(async ({ chat, char }) => {
  const gift = await import('/src/system/gift.js');
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const give = (cover, inner) => {
    gift.send({ chatId: chat, role: 'user', authorId: 'me', cover, inner });
    return db.messagesOf(chat).filter(x => x.kind === 'gift' && x.role === 'user').pop();
  };
  const ring = give('一个小盒子', '情侣戒指');
  const note = gift.settle(ring.id, true);
  const kept = cl.giftItem(ring.id);
  const candy = give('一盒糖', '');
  gift.settle(candy.id, true);
  const pan = give('平底锅', '');
  gift.settle(pan.id, true);
  const guesses = ['珍珠耳环', '白色毛衣', '一双高跟鞋', '木质香水', '平底锅', '茶具套装', '一束花']
    .map(n => [n, cl.guessKind(n)?.group || '']);
  // 整轮重新生成：礼物退回待拆，自动收的那件一并撤掉
  gift.unsettle(note.id);
  return {
    kept: kept && { owner: kept.owner, group: kept.group, sub: kept.sub, name: kept.name, giver: kept.giver, auto: kept.auto },
    candy: !!cl.giftItem(candy.id), pan: !!cl.giftItem(pan.id), guesses,
    afterUndo: !!cl.giftItem(ring.id),
  };
}, ids);
ok('我送的戒指，角色拆开：直接收进它的衣帽间，分好类', auto.kept && auto.kept.owner === ids.char && auto.kept.group === 'jewelry'
  && auto.kept.sub === '戒指' && auto.kept.giver === 'me' && auto.kept.name === '情侣戒指', JSON.stringify(auto));
ok('一盒糖、平底锅认不出是穿戴的东西：不收', !auto.candy && !auto.pan, JSON.stringify(auto));
ok('按名字猜分类：耳环、毛衣、高跟鞋、香水认得出，平底锅、茶具套装、一束花不认',
  JSON.stringify(auto.guesses) === JSON.stringify([['珍珠耳环', 'jewelry'], ['白色毛衣', 'top'], ['一双高跟鞋', 'shoes'],
    ['木质香水', 'scent'], ['平底锅', ''], ['茶具套装', ''], ['一束花', '']]), JSON.stringify(auto.guesses));
ok('重新生成那一轮、礼物退回待拆：自动收的那件撤掉', !auto.afterUndo, JSON.stringify(auto));

// ---- 登记 ----
const reg = await ev(async ({ char }) => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  cl.create({ owner: char, group: 'outer', sub: '大衣', name: '角色的大衣' });
  const pack = (await import('/src/system/charpack.js')).collect(char, { history: false });
  const inPack = (pack.closet || []).map(r => r.name);
  (await import('/src/system/purge.js')).dropCharacter(char);
  return { inPack, left: db.closet.all().map(r => `${r.owner === 'me' ? 'me' : 'char'}:${r.name}`) };
}, ids);
ok('角色包带走角色的衣帽间', reg.inPack.includes('角色的大衣'), JSON.stringify(reg));
ok('删角色：它的衣帽间一起删，我收着的它送的东西不动', !reg.left.some(x => x.startsWith('char:')) && reg.left.includes('me:银色手链'), JSON.stringify(reg));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
