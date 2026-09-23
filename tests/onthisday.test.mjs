// 那年今天：往年同一天（双方都开过口的）逐年列出、闰日、每天提醒一次、菜单里按有无出现、翻日期、跳回聊天
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = (await import('/src/system/db/index.js'));
  const acc = (await import('/src/system/accounts.js'));
  const me = acc.current();
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
  const ch = db.characters.create({ name: '小林', persona: 'x' });
  const chat = db.chats.create({ characterIds: [ch.id], personaId: me.id, title: '' });
  const other = db.characters.create({ name: '阿树', persona: 'x' });
  const plain = db.chats.create({ characterIds: [other.id], personaId: me.id, title: '' });
  const say = (chatId, who, at, content) => db.messages.create({ chatId, role: who === 'me' ? 'user' : 'char',
    authorId: who === 'me' ? 'me' : who, kind: 'text', content, status: 'done', createdAt: at });
  // 一年前的今天：互发两句
  say(chat.id, 'me', new Date(y - 1, mo, d, 10).getTime(), '一年前说的');
  say(chat.id, ch.id, new Date(y - 1, mo, d, 10, 5).getTime(), '一年前回的');
  // 两年前的今天：只有你说了，不算
  say(chat.id, 'me', new Date(y - 2, mo, d, 9).getTime(), '两年前自言自语');
  // 三年前的今天：互发 8 句，默认只露 6 句
  const first3 = say(chat.id, 'me', new Date(y - 3, mo, d, 8).getTime(), '三年前第一句');
  for (let i = 1; i < 8; i++) say(chat.id, i % 2 ? ch.id : 'me', new Date(y - 3, mo, d, 8, i).getTime(), `三年前第 ${i + 1} 句`);
  // 一年前的昨天
  say(chat.id, 'me', new Date(y - 1, mo, d - 1, 20).getTime(), '一年前的昨天');
  say(chat.id, ch.id, new Date(y - 1, mo, d - 1, 20, 1).getTime(), '嗯');
  // 今年今天：不算往年
  say(chat.id, 'me', Date.now(), '今天说的');
  say(chat.id, ch.id, Date.now(), '今天回的');
  // 闰日：2024-02-29 互发；2027-02-28 互发，站在 2028-02-29 看
  say(chat.id, 'me', new Date(2024, 1, 29, 12).getTime(), '闰日那天');
  say(chat.id, ch.id, new Date(2024, 1, 29, 12, 1).getTime(), '闰日回');
  say(chat.id, 'me', new Date(2027, 1, 28, 12).getTime(), '二月底');
  say(chat.id, ch.id, new Date(2027, 1, 28, 12, 1).getTime(), '二月底回');
  // 另一段对话：往年今天也有
  say(plain.id, 'me', new Date(y - 1, mo, d, 11).getTime(), '在吗');
  say(plain.id, other.id, new Date(y - 1, mo, d, 11, 1).getTime(), '在');
  return { chat: chat.id, plain: plain.id, first3: first3.id, y };
});

const core = await page.evaluate(async (o) => {
  const t = (await import('/src/system/onthisday.js'));
  const ys = t.ofChat(o.chat);
  const leap = t.ofChat(o.chat, new Date(2028, 1, 29, 12).getTime());
  return {
    years: ys.map(x => [x.ago, x.msgs.length]),
    order: ys[1]?.msgs.map(m => m.content)[0],
    leap: leap.map(x => x.year),
  };
}, ids);
ok('一年前、三年前各一段；两年前只有一方开口，不算；今年不算', JSON.stringify(core.years) === '[[1,2],[3,8]]', JSON.stringify(core.years));
ok('按时间排好', core.order === '三年前第一句', core.order);
ok('闰日只对上闰年那一天，不把二月底算进来', JSON.stringify(core.leap) === '[2024]', JSON.stringify(core.leap));

// ---- 提醒 ----
const rem = await page.evaluate(async (o) => {
  const t = (await import('/src/system/onthisday.js'));
  const n = (await import('/src/system/notify.js'));
  const db = (await import('/src/system/db/index.js'));
  db.chats.update(o.plain, { onThisDay: false });
  const count = () => n.notifications.get().items.length;
  const base = count();
  const d = new Date(); d.setHours(7, 0, 0, 0);
  t.tick(d.getTime());
  const early = count() - base;
  d.setHours(10);
  t.tick(d.getTime());
  const got = n.notifications.get().items.slice(0, count() - base).map(x => ({ body: x.body, route: x.payload?.route }));
  t.tick(d.getTime() + 60000);
  return { early, got, again: count() - base - got.length };
}, ids);
ok('9 点之前不提醒', rem.early === 0, rem.early);
ok('9 点之后提醒一次，指向那年今天页；关了提醒的那段不提醒', rem.got.length === 1 && /1 年前的今天，与小林的对话共 2 条/.test(rem.got[0].body)
  && rem.got[0].route === `/onthisday/${ids.chat}`, JSON.stringify(rem.got));
ok('同一天不再提醒', rem.again === 0, rem.again);

// ---- 会话菜单：有往年记录才出现 ----
const open = async route => {
  await page.evaluate(async r => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', r); }, route);
  await page.waitForTimeout(800);
};
// 右上角菜单。点最上面那一页的按钮；通知横幅可能正好压在顶栏上，所以不走坐标点击
const menuOpen = async () => {
  await page.evaluate(() => [...document.querySelectorAll('.navbar [aria-label="更多"]')].pop().click());
  await page.waitForTimeout(500);
};
await open(`/chat/${ids.chat}`);
await menuOpen();
const menu = await page.locator('.fullsheet').innerText();
ok('菜单里有「那年今天」', /那年今天/.test(menu) && /1 年前的今天，共 2 条/.test(menu), menu.slice(0, 400));

await page.evaluate(async (o) => { (await import('/src/system/db/index.js')).messages.removeWhere(m => m.chatId === o.plain && m.createdAt < Date.now() - 86400000); }, ids);
await open(`/chat/${ids.plain}`);
await menuOpen();
ok('往年今天没有记录的会话，菜单里没有这一行', !/那年今天/.test(await page.locator('.fullsheet').innerText()));

// ---- 页面 ----
await open(`/onthisday/${ids.chat}`);
let pg = await page.locator('.page').last().innerText();
await page.screenshot({ path: `${OUT}/onthisday.png` });
ok('逐年列出：1 年前、3 年前', /1 年前 · \d+ 年 · 共 2 条/.test(pg) && /3 年前 · \d+ 年 · 共 8 条/.test(pg), pg.slice(0, 400));
ok('三年前那段默认露 6 句，有展开', /三年前第 6 句/.test(pg) && !/三年前第 7 句/.test(pg) && /展开全部 8 条/.test(pg));
await page.locator('.list-item', { hasText: '展开全部 8 条' }).click();
await page.waitForTimeout(300);
pg = await page.locator('.page').last().innerText();
ok('展开之后 8 句都在', /三年前第 8 句/.test(pg) && /收起/.test(pg));

await page.locator('.nav-text', { hasText: '前一天' }).click();
await page.waitForTimeout(300);
pg = await page.locator('.page').last().innerText();
ok('前一天：一年前的昨天', /一年前的昨天/.test(pg) && /回到今天/.test(pg) && !/三年前第一句/.test(pg), pg.slice(0, 300));
await page.locator('.nav-text', { hasText: '回到今天' }).click();
await page.waitForTimeout(300);
ok('回到今天', /三年前第一句/.test(await page.locator('.page').last().innerText()));

// 提醒开关在这一页
await page.locator('.list-item', { hasText: '每天提醒' }).locator('.switch').click();
await page.waitForTimeout(200);
ok('关掉每天提醒，记在这段会话上', await page.evaluate(async (o) =>
  (await import('/src/system/db/index.js')).chats.get(o.chat).onThisDay === false, ids));

// 在聊天中查看：跳到那一天的第一条
await page.locator('.list-item', { hasText: '在聊天中查看' }).last().click();
await page.waitForTimeout(1200);
const route = await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  const s = n.nav.get();
  const st = s.stacks?.[s.app] || s.stack || [];
  return (Array.isArray(st) ? st.at(-1)?.route || st.at(-1) : '') || JSON.stringify(s).slice(0, 200);
});
ok('跳回聊天，定位到三年前那天的第一条', String(route).includes(`/chat/${ids.chat}@${ids.first3}`)
  || await page.locator(`#msg-${ids.first3}`).count() > 0, String(route));

// 标识页里也有入口
await open(`/badges/${ids.chat}`);
ok('互动标识页的「回顾」里有那年今天', /那年今天/.test(await page.locator('.page').last().innerText()));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
