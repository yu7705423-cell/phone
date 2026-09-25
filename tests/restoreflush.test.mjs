// 恢复完紧跟着刷新，数据不能丢（backup.restore 结尾 flushWrites，ARCHITECTURE 4.220）。
//
// collection 的行攒到下一拍才写进 IndexedDB。从前 restore 一返回就算完，搬家那边紧接着刷新页面，
// 最后那一批就被刷新吞掉：图片在（图片是等着写完的），角色和聊天记录没了。
// 这里恢复一份只有 JSON 的备份，一返回就直接读 IndexedDB。
// 说明：旧代码在这里多半也能过（每恢复一个域都要等一次事务，前一批顺带就写下去了），
// 丢数据只在机器很忙时出现；这一条是守着「恢复返回时已落盘」这件事，不是复现
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// 造一份备份，清空，恢复；恢复一返回就直接去 IndexedDB 里读（不经过内存镜像），看落盘了没有
const got = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const { idb } = await import('/src/system/db/idb.js');
  const b = await import('/src/system/backup.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id] });
  for (let i = 0; i < 200; i++) db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: `第 ${i} 条`, status: 'done' });
  await new Promise(r => setTimeout(r, 500));
  const blob = await b.build({ media: false });
  await b.wipeAll();
  await new Promise(r => setTimeout(r, 500));
  await b.restore(blob);
  const chars = await idb.all('characters');
  const msgs = await idb.all('messages');
  return { chars: chars.map(x => x.name), msgs: msgs.length };
});
ok('恢复一返回，角色和聊天记录已经落盘（紧跟着刷新也不会丢）', got.chars.includes('阿岚') && got.msgs === 200, JSON.stringify(got));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
