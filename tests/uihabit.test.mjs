// 界面按常见聊天软件的习惯：隔久了才出一行时间、同一人连发收紧、点开面板仍贴着底部、
// 列表状态写在右边、主屏最近会话显示群名且点哪行进哪段、空的 dock 格平时不画
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const g = await import('/src/system/group.js');
  const me = acc.current();
  const a = db.characters.create({ name: '林晚', persona: 'x' });
  const b = db.characters.create({ name: '周屿', persona: 'x' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() - 60000 });
  const grp = g.create({ ids: [a.id, b.id], title: '周末出门' });
  db.chats.update(grp.id, { lastMessageAt: Date.now() });
  const say = (who, text, minAgo) => db.messages.create({ chatId: chat.id, role: who === 'me' ? 'user' : 'char',
    authorId: who === 'me' ? 'me' : a.id, kind: 'text', content: text, status: 'done', createdAt: Date.now() - minAgo * 60000 });
  // 昨天说了三句（林晚连发两句），今天又说了几句
  // 昨天中午，不用「26 小时前」—— 凌晨跑的时候那就成了前天
  const noon = new Date(); noon.setDate(noon.getDate() - 1); noon.setHours(12, 0, 0, 0);
  const yAgo = (Date.now() - noon.getTime()) / 60000;
  say('me', '昨天第一句', yAgo);
  const c1 = say(a.id, '昨天回一', yAgo - 1);
  const c2 = say(a.id, '昨天回二', yAgo - 1);
  say('me', '今天第一句', 30);
  for (let i = 0; i < 14; i++) say(i % 2 ? 'me' : a.id, `今天第 ${i + 2} 句`, 29 - i);
  db.messages.create({ chatId: grp.id, role: 'char', authorId: b.id, kind: 'text', content: '群里的话', status: 'done' });
  return { chat: chat.id, grp: grp.id, c1: c1.id, c2: c2.id, a: a.id };
});
const go = (app, route) => page.evaluate(async ([a, r]) => {
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); if (a) n.openApp(a, r);
}, [app, route]);

// ---- 一、时间分隔 ----
const fmt = await page.evaluate(async () => {
  const r = await import('/src/system/receipt.js');
  const now = new Date(2026, 8, 23, 15, 0).getTime();
  const at = (d, h, m) => new Date(2026, 8, d, h, m).getTime();
  return {
    mode: r.stampMode(),
    today: r.sepOf(at(23, 9, 5), now), yday: r.sepOf(at(22, 21, 30), now),
    week: r.sepOf(at(19, 8, 0), now), year: r.sepOf(at(3, 8, 0), now),
    old: r.sepOf(new Date(2025, 0, 2, 8, 0).getTime(), now),
    gap: r.needSep({ createdAt: 0 + 1 }, { createdAt: 1 + 5 * 60000 }),
    near: r.needSep({ createdAt: 1 }, { createdAt: 1 + 4 * 60000 }),
  };
});
ok('默认按间隔显示', fmt.mode === 'gap', fmt.mode);
ok('今天只写时分、昨天写昨天、一周内写星期、今年写月日、往年带年份',
  fmt.today === '09:05' && fmt.yday === '昨天 21:30' && fmt.week === '周六 08:00'
  && fmt.year === '9月3日 08:00' && fmt.old === '2025年1月2日 08:00', JSON.stringify(fmt));
ok('相隔五分钟才写一行', fmt.gap && !fmt.near);

await go('chat', `/chat/${ids.chat}`);
await page.waitForTimeout(900);
const conv = await page.evaluate(o => ({
  seps: [...document.querySelectorAll('.time-sep')].map(e => e.textContent.trim()),
  hook: document.querySelectorAll('.ph-time-sep').length,
  stamps: document.querySelectorAll('.msg-meta').length,
  cont1: document.getElementById(`msg-${o.c1}`)?.classList.contains('is-cont'),
  cont2: document.getElementById(`msg-${o.c2}`)?.classList.contains('is-cont'),
}), ids);
// 写法由上面那几条单测管；这里只看条数与先后（午夜前后跑时「今天」那一段可能落在昨天）
ok('昨天一行、今天一行，连着说的不重复写', conv.seps.length === 2 && /^昨天 /.test(conv.seps[0])
  && /\d\d:\d\d$/.test(conv.seps[1]) && conv.seps[0] !== conv.seps[1], JSON.stringify(conv.seps));
ok('分隔行挂着契约钩子', conv.hook === 2, conv.hook);
ok('按间隔时气泡上不另写时刻', conv.stamps === 0, conv.stamps);
ok('同一个人接着说的那一条收紧，换人的那条不收', conv.cont2 === true && conv.cont1 === false, JSON.stringify(conv));

// ---- 二、点开加号：最新那条仍然看得见 ----
const lastVisible = () => page.evaluate(() => {
  const body = document.querySelector('.conv-body');
  const msgs = [...body.querySelectorAll('.msg')];
  const last = msgs[msgs.length - 1].getBoundingClientRect();
  const box = body.getBoundingClientRect();
  return last.bottom <= box.bottom + 2 && last.top >= box.top;
});
ok('进会话时停在最底下', await lastVisible());
await page.locator('.ph-plus').first().click();
await page.waitForTimeout(600);
ok('点开加号面板之后，最新那条没有被面板压住', await lastVisible());
await page.screenshot({ path: `${OUT}/uihabit-plus.png` });

// ---- 三、列表：状态写在右边 ----
await page.evaluate(() => [...document.querySelectorAll('.navbar [aria-label="更多"]')].pop().click());
await page.waitForTimeout(500);
const rightOf = title => page.evaluate(t => {
  const row = [...document.querySelectorAll('.fullsheet .list-item')].find(e => e.querySelector('.li-title')?.textContent.trim() === t);
  return row?.querySelector('.li-value')?.textContent.trim() || '';
}, title);
ok('会话菜单：翻译、节奏、美化的状态写在右边', await rightOf('翻译') === '关闭'
  && await rightOf('节奏与自动回复') === '按按钮才回' && await rightOf('美化') === '未设置');
await go('settings', '/');
await page.waitForTimeout(700);
const svcRight = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.querySelector('.li-title')?.textContent.trim() === '接口');
  return { value: row?.querySelector('.li-value')?.textContent.trim(), sub: row?.querySelector('.li-sub')?.textContent || '' };
});
ok('设置首页：没配的接口右边写「未配置」，不再写一段说明', svcRight.value === '未配置' && !svcRight.sub, JSON.stringify(svcRight));

// ---- 四、主屏 ----
await go(null);
await page.waitForTimeout(800);
const home = await page.evaluate(() => {
  const wg = [...document.querySelectorAll('.wg-list')].find(e => /最近会话/.test(e.textContent));
  return {
    rows: wg ? [...wg.querySelectorAll('.wg-row-title')].map(e => e.textContent.trim()) : null,
    emptyShown: [...document.querySelectorAll('.dock-empty')].some(e => getComputedStyle(e).visibility !== 'hidden'),
  };
});
ok('最近会话：群显示群名，两格高只列两段', JSON.stringify(home.rows) === JSON.stringify(['周末出门', '林晚']), JSON.stringify(home.rows));
ok('dock 的空位平时不画', home.emptyShown === false);
await page.locator('.wg-row', { hasText: '林晚' }).click();
await page.waitForTimeout(800);
const at = await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  return document.querySelector('.composer-bar') ? 'conv' : n.nav.get().app;
});
ok('点最近会话里的一行，直接进那段对话', at === 'conv', at);

// ---- 五、群头像是圆角方形的拼图 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.closeApp('chat'); n.goHome(); n.openApp('chat', '/'); });
await page.waitForTimeout(900);
const gf = await page.evaluate(() => {
  const el = document.querySelector('.group-face');
  return el ? getComputedStyle(el).borderTopLeftRadius : '';
});
ok('群头像不是圆的（和单人头像分得开）', gf && gf !== '999px' && parseFloat(gf) < 20, gf);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
