// 数据库连接断了之后，写入不许安静地丢掉（system/db/idb.js，ARCHITECTURE 4.233）
//
// iPhone 的 WebKit 上，应用在后台待一阵回来，网页与数据库之间的连接常常已经断了
// （报错 "Connection to Indexed Database server lost"，或者连接被关掉之后 InvalidStateError）。
// 从前 idb.js 一直拿着那一个连接：之后每一次写入都失败，失败只在控制台记一句，
// 界面照常显示刚聊的内容（那是内存里的），重开之后这段时间的全没了。
//
// 这里把连接关掉来模拟「断了」，再写一条消息、重开，看它在不在；
// 另外看写入真失败时界面上有没有说。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);

const chatId = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', kind: 'text', content: '断开之前', status: 'done' });
  await (await import('/src/system/db/idb.js')).flushWrites();
  return chat.id;
});

// 连接断了（从后台回来）
await page.evaluate(async () => {
  const idb = await import('/src/system/db/idb.js');
  (await idb.open()).close();
});
await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  db.messages.create({ chatId: id, role: 'user', kind: 'text', content: '断开之后写的', status: 'done' });
  db.chats.update(id, { lastMessageAt: Date.now() });
  await (await import('/src/system/db/idb.js')).flushWrites();
}, chatId);
await page.waitForTimeout(500);

await page.reload();
await page.waitForTimeout(2000);
const texts = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  return db.messages.where(m => m.chatId === id).map(m => m.content);
}, chatId);
ok('断开之前写的还在', texts.includes('断开之前'), JSON.stringify(texts));
ok('连接断了之后写的，重开之后也还在', texts.includes('断开之后写的'), JSON.stringify(texts));

// 真写不进去（换一个连接也不行）：界面上要说，不许只记在控制台
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const n = await import('/src/system/nav.js');
  n.unlock(); n.goHome();
  // 模拟存储已满：之后每一个写事务都失败
  const orig = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (store, mode) {
    if (mode === 'readwrite') throw new DOMException('模拟存储已满', 'QuotaExceededError');
    return orig.call(this, store, mode);
  };
  db.characters.create({ name: '写不进去的' });
});
await page.waitForTimeout(1500);
const shown = await page.evaluate(() => document.body.innerText);
ok('写入失败：界面上写明没有保存成功', /未能保存/.test(shown), shown.slice(0, 200));
ok('写入失败：说出原因', /QuotaExceededError|存储空间/.test(shown), shown.slice(0, 200));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
