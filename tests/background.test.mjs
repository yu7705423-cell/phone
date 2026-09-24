// 后台任务总览：定时执行的逐个列出、每条消息顺带的调用、实际调用次数（按小时记账、保留 30 天）
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
let calls = 0;
await ctx.route('**/relay.example.com/**', async route => {
  calls++;
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: '嗯' } }] }) });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
// 账本里先放两格旧的：三天前 5 次聊天回复，四十天前 9 次（超过保存期，应当被清掉）
await page.addInitScript(() => {
  const H = 3600000;
  const hour = t => Math.floor(t / H) * H;
  if (localStorage.getItem('phone.usage.seeded')) return;
  localStorage.setItem('phone.usage.seeded', '1');
  localStorage.setItem('phone.usage', JSON.stringify({
    [hour(Date.now() - 3 * 24 * H)]: { 'chat.reply': 5 },
    [hour(Date.now() - 40 * 24 * H)]: { 'chat.reply': 9 },
  }));
});
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = (await import('/src/system/db/index.js'));
  const svc = (await import('/src/system/ai/services.js'));
  const acc = (await import('/src/system/accounts.js'));
  const g = (await import('/src/system/group.js'));
  const space = (await import('/src/system/space.js'));
  const gh = (await import('/src/system/ghbackup.js'));
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const me = acc.current();
  const a = db.characters.create({ name: '小林', persona: 'x', proactive: true, proactiveMinutes: 90, emo: true, snap: true, dayOn: true });
  const b = db.characters.create({ name: '阿树', persona: 'x' });
  const quiet = db.characters.create({ name: '安静', persona: 'x' });
  const pair = db.chats.create({ characterIds: [a.id], personaId: me.id, title: '' });
  const grp = g.create({ ids: [a.id, b.id], title: '花店' });
  g.setProactive(grp.id, { on: true, minutes: 30 });
  db.chats.update(pair.id, { pacePending: { dueAt: Date.now() + 10 * 60000, text: '在吗' } });
  space.saveDraft({ chatId: pair.id, title: '给你', body: '一封信', sendAt: Date.now() + 2 * 86400000 });
  gh.setConfig({ autoDays: 3 });
  db.settings.set({ bondAuto: true });
  return { a: a.id, b: b.id, quiet: quiet.id, pair: pair.id, grp: grp.id };
});

// ---- 一、记账：每次真正发出去的请求记一笔 ----
const acc = await page.evaluate(async () => {
  const e = (await import('/src/system/ai/engine.js'));
  const u = (await import('/src/system/ai/usage.js'));
  await e.runTextTask('chat.proactive', { system: 'x', user: 'y' });
  await e.runTextTask('chat.proactive', { system: 'x', user: 'y' });
  await e.runTextTask('memory.extract', { system: 'x', user: 'y' });
  const day = u.since(24 * 3600000);
  const week = u.since(7 * 24 * 3600000);
  const month = u.since(30 * 24 * 3600000);
  await new Promise(r => setTimeout(r, 2300));
  const saved = JSON.parse(localStorage.getItem('phone.usage') || '{}');
  return { day, week, month, keys: Object.keys(saved).length,
    savedHas: Object.values(saved).some(r => r['chat.proactive'] === 2) };
});
const f = (rows, label) => rows.find(r => r.label === label)?.n || 0;
ok('三次请求真的发出去了', calls === 3, calls);
ok('24 小时：主动发消息 2 次、总结记忆 1 次，都算后台', f(acc.day, '角色主动发消息') === 2 && f(acc.day, '总结记忆') === 1
  && acc.day.every(r => r.auto), JSON.stringify(acc.day));
ok('24 小时不含三天前那 5 次', f(acc.day, '聊天回复') === 0, JSON.stringify(acc.day));
ok('7 天含三天前那 5 次', f(acc.week, '聊天回复') === 5, JSON.stringify(acc.week));
ok('四十天前那 9 次超过保存期，30 天里也没有', f(acc.month, '聊天回复') === 5, JSON.stringify(acc.month));
ok('两秒后写进本机，旧格子已清掉', acc.savedHas && acc.keys === 2, JSON.stringify(acc));

// ---- 二、界面 ----
await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings', '/');
});
await page.waitForTimeout(700);
const root = await page.locator('.page').last().innerText();
ok('设置的「后台」一组里有「后台任务」', /后台任务/.test(root));
await page.locator('.list-item', { hasText: '后台任务' }).first().click();
await page.waitForTimeout(700);
const bg = await page.locator('.page').last().innerText();
await page.screenshot({ path: `${OUT}/background.png`, fullPage: true });
ok('逐个角色列出：主动发起对话，平均间隔与下一次', /小林 · 主动发起对话/.test(bg) && /平均每 1\.5 小时一次/.test(bg) && /下一次/.test(bg), bg.slice(0, 600));
ok('深夜消息、自己存照片（生图未配置，写明不会执行）、当日日程', /小林 · 深夜消息/.test(bg) && /小林 · 自己存照片/.test(bg)
  && /生图接口尚未配置，不会执行/.test(bg) && /小林 · 当日日程/.test(bg));
ok('群里主动开口', /花店 · 群里主动开口/.test(bg) && /平均每 30 分钟一次/.test(bg));
ok('延迟回复', /小林 · 延迟回复/.test(bg));
ok('没开任何项的角色不出现', !/安静/.test(bg) && !/阿树 ·/.test(bg));
ok('不产生模型费用的一组：信、GitHub、备份提醒', /不产生模型费用/.test(bg) && /定时寄出的信/.test(bg)
  && /自动备份到 GitHub/.test(bg) && /备份提醒/.test(bg));
ok('每条消息顺带的调用：开着的那一项', /每条消息顺带的调用/.test(bg) && /自动重压关系底色/.test(bg));
ok('实际调用：24 小时共 3 次，其中 3 次在后台', /共 3 次/.test(bg) && /其中 3 次在后台/.test(bg), bg.slice(-500));

await page.locator('.seg-item', { hasText: '7 天' }).click();
await page.waitForTimeout(300);
const wk = await page.locator('.page').last().innerText();
ok('切到 7 天：共 8 次，聊天回复 5 次', /共 8 次/.test(wk) && /聊天回复\s*5 次/.test(wk), wk.slice(-500));

// 点一行，去的是那一项自己的开关页；退回来还在这里
await page.locator('.list-item', { hasText: '小林 · 主动发起对话' }).click();
await page.waitForTimeout(700);
const where = await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  const s = n.nav.get();
  return { app: s.app || s.current || '', text: [...document.querySelectorAll('.page')].pop()?.innerText.slice(0, 80) };
});
ok('点主动发起对话，去该角色的主动消息页', /主动/.test(where.text), JSON.stringify(where));
await page.locator('.navback').click();
await page.waitForTimeout(700);
ok('返回落回后台任务', /后台任务/.test(await page.locator('.nav-title').last().innerText()));

// 清空记录
await page.locator('.list-item', { hasText: '清空调用记录' }).click();
await page.waitForTimeout(300);
await page.locator('.modal button', { hasText: '清空' }).click();
await page.waitForTimeout(500);
const after = await page.locator('.page').last().innerText();
ok('清空之后：共 0 次', /共 0 次/.test(after) && /这段时间内没有调用接口/.test(after), after.slice(-400));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
