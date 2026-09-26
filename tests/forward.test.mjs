// 多选转发聊天记录（ARCHITECTURE 4.260）
//
//   一、会话里长按 - 多选，选两条（一条文字、一条图片），点「转发」，选另一段会话
//   二、对方会话里多出一条记录：冻起来的副本（谁说的、说了什么、图的 id），正文是给模型看的几行
//   三、气泡：标题、预览行；点开看全部，图能显示
//   四、图片只记 id：算作有引用；删掉原会话之后图还在；进对方的历史
import { BASE, EXE, PNG_B64, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async b64 => {
  const { db, images } = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '阿园' });
  const a = db.characters.create({ name: '阿岚' });
  const bch = db.characters.create({ name: '沈砚' });
  const ca = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  const cb = db.chats.create({ characterIds: [bch.id], personaId: me.id, lastMessageAt: Date.now() - 1000 });
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const img = await images.put(new File([blob], 'p.png', { type: 'image/png' }));
  const m1 = db.messages.create({ chatId: ca.id, role: 'char', authorId: a.id, kind: 'text', content: '明天下雨，记得带伞', status: 'done' });
  const m2 = db.messages.create({ chatId: ca.id, role: 'user', authorId: 'me', kind: 'image', imageId: img, content: '[图片]', status: 'done' });
  db.messages.create({ chatId: ca.id, role: 'user', authorId: 'me', kind: 'text', content: '好', status: 'done' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${ca.id}`);
  return { a: a.id, b: bch.id, ca: ca.id, cb: cb.id, img, m1: m1.id, m2: m2.id, meName: me.name };
}, PNG_B64);
await page.waitForTimeout(1200);

// 一
const first = page.locator('.msg').filter({ hasText: '明天下雨' }).first();
await first.dispatchEvent('contextmenu');
await page.waitForTimeout(400);
await page.locator('.sheet .list-item', { hasText: '多选' }).click();
await page.waitForTimeout(400);
ok('一、进入多选', /已选 1 条/.test(await page.locator('.navbar').innerText()));
await page.locator('.msg').nth(1).click();
await page.waitForTimeout(200);
ok('一、再选一条（图片）', /已选 2 条/.test(await page.locator('.navbar').innerText()));
await page.locator('.select-bar button', { hasText: '转发' }).click();
await page.waitForTimeout(400);
const sheetText = await page.locator('.sheet').last().innerText();
ok('一、弹出选会话：列出沈砚，不列自己这一段', /转发 2 条消息给/.test(sheetText) && /沈砚/.test(sheetText) && !/阿岚/.test(sheetText), sheetText.slice(0, 120));
await page.locator('.sheet .list-item', { hasText: '沈砚' }).click();
await page.waitForTimeout(600);
ok('一、转发后退出多选', !(await page.locator('.select-bar').count()));

// 二
const fw = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  return db.messagesOf(o.cb).find(m => m.kind === 'forward');
}, ids);
ok('二、对方会话里多出一条转发记录', !!fw && fw.role === 'user' && fw.forward?.count === 2, JSON.stringify(fw?.forward));
ok('二、副本：谁说的、说了什么、图的 id', fw?.forward?.items?.[0]?.who === '阿岚' && /带伞/.test(fw?.forward?.items?.[0]?.text) && fw?.forward?.items?.[1]?.imageId === ids.img, JSON.stringify(fw?.forward?.items));
const want = `[转发的聊天记录：阿岚的聊天记录，共 2 条]\n阿岚：明天下雨，记得带伞\n${ids.meName}：[图片]`;
ok('二、给模型看的正文：抬头加每行一句', fw?.content === want, JSON.stringify({ got: fw?.content, want }));

// 三
await ev(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${id}`); }, ids.cb);
await page.waitForTimeout(1200);
const bubble = page.locator('.bubble-forward');
ok('三、气泡：标题与预览行', (await bubble.count()) === 1 && /阿岚的聊天记录/.test(await bubble.innerText()) && /带伞/.test(await bubble.innerText()) && /2 条/.test(await bubble.innerText()), await bubble.innerText().catch(() => ''));
await bubble.click();
await page.waitForTimeout(500);
const items = await page.locator('.fw-item').count();
const imgShown = await page.locator('.fw-item img.fw-img').count();
ok('三、点开看全部：两条，图能显示', items === 2 && imgShown === 1, `${items} ${imgShown}`);

// 四
const keep = await ev(async o => {
  const { images } = await import('/src/system/db/index.js');
  const purge = await import('/src/system/purge.js');
  const engine = await import('/src/system/ai/engine.js');
  const { db } = await import('/src/system/db/index.js');
  const used = purge.usedImageIds().has(o.img);
  const hist = engine.buildHistory(db.chats.get(o.cb), db.characters.get(o.b), db.messagesOf(o.cb));
  purge.dropChat(o.ca);
  await new Promise(r => setTimeout(r, 300));
  return { used, still: images.ids().includes(o.img), hist: JSON.stringify(hist) };
}, ids);
ok('四、图算作有引用，删掉原会话之后图还在', keep.used && keep.still, JSON.stringify({ used: keep.used, still: keep.still }));
ok('四、进对方的历史', /转发的聊天记录/.test(keep.hist) && /带伞/.test(keep.hist), keep.hist.slice(0, 200));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
