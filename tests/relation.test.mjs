// 关系入口整合：情侣空间里的「在一起」与纪念日接进互动标识；空间里有标识与年度回顾的入口
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = (await import('/src/system/db/index.js'));
  const acc = (await import('/src/system/accounts.js'));
  const space = (await import('/src/system/space.js'));
  const me = acc.current();
  const y = new Date().getFullYear();
  const ch = db.characters.create({ name: '小林', persona: 'x' });
  const chat = db.chats.create({ characterIds: [ch.id], personaId: me.id, title: '' });
  const other = db.characters.create({ name: '阿树', persona: 'x' });
  const plain = db.chats.create({ characterIds: [other.id], personaId: me.id, title: '' });
  // 两年前的 5 月 20 日在一起；去年 5 月 20 日互发
  space.setStart(chat.id, new Date(y - 2, 4, 20).getTime());
  const day = space.addDay({ chatId: chat.id, title: '第一次见面', date: `${y - 3}-06-01`, yearly: true });
  const say = (role, at) => db.messages.create({ chatId: chat.id, role, authorId: role === 'user' ? 'me' : ch.id,
    kind: 'text', content: '嗯', status: 'done', createdAt: at });
  say('user', new Date(y - 1, 4, 20, 10).getTime()); say('char', new Date(y - 1, 4, 20, 11).getTime());
  say('user', new Date(y - 1, 5, 1, 10).getTime()); say('char', new Date(y - 1, 5, 1, 11).getTime());
  db.messages.create({ chatId: plain.id, role: 'user', authorId: 'me', kind: 'text', content: '在吗', status: 'done' });
  return { chat: chat.id, ch: ch.id, plain: plain.id, day: day.id, y };
});

const r = await page.evaluate(async (o) => {
  const db = (await import('/src/system/db/index.js'));
  const b = (await import('/src/system/badges.js'));
  b.sync(o.chat); b.sync(o.plain);
  const chat = db.chats.get(o.chat);
  return {
    tiers: b.tiersOf(chat).map(t => [t.id, t.value, t.level]),
    plainTiers: b.tiersOf(db.chats.get(o.plain)).map(t => t.id),
    limited: Object.keys(chat.limited || {}),
    unlocked: Object.keys(chat.unlocked || {}),
    name: b.limitedName(`day-${o.day}:${o.y - 1}`),
    label: b.labelOf(`love:${o.y - 1}`),
  };
}, ids);
const tog = r.tiers.find(t => t[0] === 'together');
ok('设了在一起那一天：成长里多一档「在一起」，天数从那天算', tog && tog[1] >= 700 && tog[2] === 2, JSON.stringify(tog));
ok('没设的会话没有这一档', !r.plainTiers.includes('together'), JSON.stringify(r.plainTiers));
ok('在一起满一年的那一档解锁了', r.unlocked.includes('together-365'), JSON.stringify(r.unlocked));
ok('去年 5 月 20 日互发：得一枚在一起纪念日', r.limited.includes(`love:${ids.y - 1}`) && /在一起纪念日/.test(r.label), JSON.stringify(r.limited) + r.label);
ok('情侣空间里每年重复的纪念日：当天互发得一枚，名字取纪念日标题', r.limited.includes(`day-${ids.day}:${ids.y - 1}`) && r.name === '第一次见面', JSON.stringify(r.limited) + r.name);

// 统计已经有了之后再加一个纪念日：从前那几年的这一天回头算上
const late = await page.evaluate(async (o) => {
  const db = (await import('/src/system/db/index.js'));
  const space = (await import('/src/system/space.js'));
  const d = space.addDay({ chatId: o.chat, title: '搬家', date: `${o.y - 5}-05-20`, yearly: true });
  return { id: d.id, has: Object.keys(db.chats.get(o.chat).limited || {}).includes(`day-${d.id}:${o.y - 1}`) };
}, ids);
ok('统计之后才加的纪念日：回头算上去年那一天', late.has, JSON.stringify(late));

// 纪念日改了名，那一枚跟着改
const renamed = await page.evaluate(async (o) => {
  const space = (await import('/src/system/space.js'));
  const b = (await import('/src/system/badges.js'));
  space.updateDay(o.day, { title: '初见' });
  return b.limitedName(`day-${o.day}:${o.y - 1}`);
}, ids);
ok('纪念日改名，那一枚的名字跟着变', renamed === '初见', renamed);

// ---- 界面 ----
await page.evaluate(async (o) => {
  const n = await import('/src/system/nav.js');
  n.unlock(); n.openApp('space', `/space/${o.chat}`);
}, ids);
await page.waitForTimeout(800);
const sp = await page.locator('.page').last().innerText();
ok('情侣空间里有「互动标识」与「年度回顾」', /互动标识/.test(sp) && /年度回顾/.test(sp), sp.slice(0, 300));
await page.screenshot({ path: `${OUT}/relation-space.png` });
await page.locator('.list-item', { hasText: '互动标识' }).first().click();
await page.waitForTimeout(800);
const bp = await page.locator('.page').last().innerText();
ok('点进去是这段对话的标识页，限定里有纪念日那一枚', /隐藏成就/.test(bp) && /初见/.test(bp) && /在一起纪念日/.test(bp), bp.slice(0, 400));

await page.evaluate(async (o) => { (await import('/src/system/nav.js')).openApp('chat', `/badges/${o.plain}`); }, ids);
await page.waitForTimeout(700);
ok('没设在一起的会话：标识页里提示去情侣空间设定', /尚未设定在一起的那一天/.test(await page.locator('.page').last().innerText()));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
