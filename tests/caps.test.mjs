import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

const r = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const caps = await import('/src/system/ai/capabilities.js');
  const out = {};
  const a = db.characters.create({ name: '甲', persona: '人设' });
  const chat = db.chats.create({ characterIds: [a.id] });
  const msgs = [db.messages.create({ chatId: chat.id, role: 'user', kind: 'text',
    content: '嗨', status: 'done' })];
  const ctx = () => ({ char: db.characters.get(a.id), chat: db.chats.get(chat.id),
    messages: msgs, settings: db.settings.get() });

  db.settings.set({ capsOff: [] });
  const all = caps.capabilityBlock(ctx());
  out.hasPat = /拍一拍/.test(all);
  out.hasDice = /骰子|dice/i.test(all);
  out.lenAll = all.length;

  // 关掉拍一拍和骰子
  db.settings.set({ capsOff: ['pat', 'dice'] });
  const some = caps.capabilityBlock(ctx());
  out.patGone = !/拍一拍/.test(some);
  out.diceGone = !/\[骰子/.test(some);
  out.shorter = some.length < all.length;

  // 全部关掉之后，协议那两样仍在
  db.settings.set({ capsOff: caps.switchable().map(c => c.id) });
  const none = caps.capabilityBlock(ctx());
  out.lenNone = none.length;
  out.muchShorter = none.length < all.length / 2;
  out.protocolKept = caps.PROTOCOL.size === 2;
  // 时间戳那一段属于协议，关不掉 —— 它的 on() 满足时应当还在
  const timeCap = caps.CAPS.find(c => c.id === 'time');
  out.timeStillOn = timeCap.on(ctx());

  db.settings.set({ capsOff: [] });
  out.labelled = caps.CAPS.every(c => !!c.label);
  out.switchableCount = caps.switchable().length;
  out.totalCount = caps.CAPS.length;
  return out;
});

ck('默认全开时拍一拍在 prompt 里', r.hasPat);
ck('关掉之后拍一拍一个字都没有', r.patGone);
ck('关掉之后骰子标记也没有', r.diceGone);
ck('prompt 确实变短了', r.shorter);
ck('全关之后短得多 (' + r.lenAll + ' -> ' + r.lenNone + ')', r.muchShorter);
ck('协议那两样不在开关表里', r.switchableCount === r.totalCount - 2);
ck('时间戳全关之后仍然生效', r.timeStillOn);
ck('每个能力都有名字', r.labelled);

// 界面
await page.evaluate(async () => (await import('/src/system/nav.js')).openApp('chat', '/caps'));
await page.waitForTimeout(700);
ck('开关页打得开', await page.getByText('能力开关').count() > 0);
// 可关的项数会随新功能增长，写死一个数只会每加一样就挂一次 ——
// 拿 switchable() 现算，查的是「页面上一项不少」
const want = await page.evaluate(async () =>
  (await import('/src/system/ai/capabilities.js')).switchable().length);
ck(`列出了全部 ${want} 项可关的`, await page.locator('.switch').count() === want);
ck('始终开启那一组也列了', await page.getByText('时间戳', { exact: true }).count() > 0);
await page.locator('.switch').first().click(); await page.waitForTimeout(400);
ck('点一下真的写进设置', await page.evaluate(async () =>
  ((await import('/src/system/db/index.js')).settings.get().capsOff || []).length === 1));
await page.screenshot({ path: `${OUT}/caps.png` });

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '能力开关全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
