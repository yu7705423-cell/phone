import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const clock = await import('/src/system/time.js');
  const reply = await import('/src/system/ai/reply.js');
  const engine = await import('/src/system/ai/engine.js');
  const basic = await import('/src/system/ai/context/basic.js');
  const R = [];
  const ok = (n, c, e) => R.push({ name: n, pass: !!c, extra: e });

  const me = acc.roots()[0] || acc.createRoot({ name: '小明' });
  const char = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [char.id], personaId: me.id, lastMessageAt: Date.now() });

  // --- 剥时间行 ---
  let p = reply.splitReply('[时间：2026-09-17 周三 14:30]\n在呢');
  ok('时间行被剥掉，不进气泡', p.length === 1 && p[0].text === '在呢', JSON.stringify(p));
  ok('时间记在消息上', p[0].stamp === '2026-09-17 周三 14:30', p[0].stamp);

  p = reply.splitReply('【time: 2026-09-17 15:00】\n[引用：你说什么]\n嗯？');
  ok('时间 + 引用连着两行都剥干净',
    p.length === 1 && p[0].text === '嗯？' && p[0].stamp === '2026-09-17 15:00' && p[0].quote === '你说什么',
    JSON.stringify(p));

  p = reply.splitReply('今天时间：过得真快');
  ok('句中的「时间：」不误伤', p.length === 1 && p[0].text === '今天时间：过得真快' && !p[0].stamp, JSON.stringify(p));

  // --- 时区 ---
  ok('默认跟设备一样', clock.userZone() === 'local');
  ok('角色没设就跟我一样', clock.charZone(char) === 'local');
  db.characters.update(char.id, { timezone: 'Asia/Tokyo' });
  ok('设了就用她自己的', clock.charZone(db.characters.get(char.id)) === 'Asia/Tokyo');

  const n = new Date('2026-09-17T06:00:00Z');   // 上海 14:00 / 东京 15:00
  ok('上海时间对', clock.clockOnly(n, 'Asia/Shanghai') === '14:00', clock.clockOnly(n, 'Asia/Shanghai'));
  ok('东京时间对', clock.clockOnly(n, 'Asia/Tokyo') === '15:00', clock.clockOnly(n, 'Asia/Tokyo'));
  ok('纽约时间对（夏令时 UTC-4）', clock.clockOnly(n, 'America/New_York') === '02:00', clock.clockOnly(n, 'America/New_York'));
  ok('东京比上海快 60 分钟', clock.zoneDiff('Asia/Tokyo', 'Asia/Shanghai', n) === 60, clock.zoneDiff('Asia/Tokyo','Asia/Shanghai',n));
  ok('上海比纽约快 720 分钟', clock.zoneDiff('Asia/Shanghai', 'America/New_York', n) === 720, clock.zoneDiff('Asia/Shanghai','America/New_York',n));
  ok('印度那半小时也对', clock.zoneDiff('Asia/Kolkata', 'Asia/Shanghai', n) === -150, clock.zoneDiff('Asia/Kolkata','Asia/Shanghai',n));
  // 注进 prompt 的句子一律英文（第 14 条），时差文案是其中一句
  ok('时差文案带上半小时', clock.diffText(-150) === '2 hours 30 minutes', clock.diffText(-150));
  ok('格式带周几', /^\d{4}-\d{2}-\d{2} 周[一二三四五六日] \d{2}:\d{2}$/.test(clock.format(n, 'Asia/Shanghai')), clock.format(n, 'Asia/Shanghai'));
  ok('跨零点不会出现 24 点', clock.clockOnly(new Date('2026-09-17T16:00:00Z'), 'Asia/Shanghai') === '00:00',
    clock.clockOnly(new Date('2026-09-17T16:00:00Z'), 'Asia/Shanghai'));

  // --- 时间块 ---
  const freshChar = db.characters.get(char.id);
  let block = basic.time.build({ messages: [], char: freshChar });
  ok('时间块说了双方时差',
    block.includes('The other party is in') && /from your own clock/.test(block),
    JSON.stringify(block));
  db.characters.update(char.id, { timezone: '' });
  block = basic.time.build({ messages: [], char: db.characters.get(char.id) });
  ok('同城就不提时差', !block.includes('The other party is in'), JSON.stringify(block));

  db.settings.set({ injectTime: false });
  ok('关掉就一个字不出', basic.time.build({ messages: [], char }) === '');
  db.settings.set({ injectTime: true });

  // --- 虚拟时间 ---
  const realNow = Date.now();
  const target = new Date('2019-06-01T12:00:00Z').getTime();
  db.settings.set({ timeMode: 'virtual', timeVirtualAt: target, timeSetAt: realNow, timeFrozen: false });
  const vnow = clock.now().getTime();
  ok('虚拟时间落在设定那一刻附近', Math.abs(vnow - target) < 5000, new Date(vnow).toISOString());
  ok('虚拟时间是往下走的（偏移而不是钉死）', clock.offset() !== 0);
  db.settings.set({ timeFrozen: true });
  const f1 = clock.now().getTime();
  await new Promise(r => setTimeout(r, 1100));
  ok('冻住之后不再走', clock.now().getTime() === f1 && f1 === target, `${f1} vs ${target}`);
  db.settings.set({ timeFrozen: false });
  ok('历史时刻也跟着换算', Math.abs(clock.toWorld(realNow).getTime() - target) < 5000);
  db.settings.set({ timeMode: 'real', timeVirtualAt: 0, timeSetAt: 0 });
  ok('切回真实时间偏移归零', clock.offset() === 0 && Math.abs(clock.now() - Date.now()) < 2000);

  // --- 上下文里的时间线 ---
  const t = Date.now();
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '晚安', status: 'done', createdAt: t - 5 * 3600000 });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: char.id, kind: 'text', content: '晚安', status: 'done', createdAt: t - 5 * 3600000 + 1000, stamp: '2026-09-17 周三 23:10' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '早', status: 'done', createdAt: t });
  let hist = engine.buildHistory(db.chats.get(chat.id), db.characters.get(char.id), db.messagesOf(chat.id));
  let joined = hist.map(h => h.content).join(' || ');
  ok('角色那条带上它自己写的时间', joined.includes('[2026-09-17 周三 23:10]'), joined);
  ok('隔了五小时的那条用户消息被补了时间', /\[\d{4}-\d{2}-\d{2} 周./.test(hist[hist.length - 1].content), joined);

  db.settings.set({ injectTime: false });
  hist = engine.buildHistory(db.chats.get(chat.id), db.characters.get(char.id), db.messagesOf(chat.id));
  ok('关掉时间感知历史里也不带', !hist.map(h => h.content).join(' ').includes('[2026-09-17'), JSON.stringify(hist));
  db.settings.set({ injectTime: true });

  // --- 要不要让它写时间 ---
  const sys = () => engine.buildChatSystem(db.chats.get(chat.id), db.characters.get(char.id), db.messagesOf(chat.id)).system;
  ok('默认会要求它先写时间', sys().includes('[时间]'));
  db.settings.set({ timeStamp: false });
  ok('关掉就不要求了', !sys().includes('[时间]'));
  db.settings.set({ timeStamp: true });
  db.settings.set({ injectTime: false });
  ok('时间感知关着时也不要求', !sys().includes('[时间]'));
  db.settings.set({ injectTime: true });

  return R;
});

await browser.close();
let bad = 0;
for (const r of out) { if (!r.pass) bad++; console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.name}${r.pass ? '' : '   << ' + (r.extra ?? '')}`); }
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e => console.log('  ' + e)); }
console.log(`\n${out.length - bad}/${out.length} 通过`);
process.exit(bad || errs.length ? 1 : 0);
