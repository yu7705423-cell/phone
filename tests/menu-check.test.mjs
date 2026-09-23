// 会话右上角菜单最下面那一组「数据」：五项都在、清空真的清了、导入跳得过去。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设甲' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  for (let i = 0; i < 4; i++) {
    db.messages.create({ chatId: chat.id, role: i % 2 ? 'char' : 'user',
      authorId: i % 2 ? a.id : 'me', kind: 'text', content: `第 ${i} 条`, status: 'done' });
  }
  db.memories.create({ charId: a.id, content: '一条记忆', category: 'fact',
    rank: 'A', keywords: [], personaId: me.id });
  db.memories.create({ charId: a.id, content: '又一条', category: 'fact',
    rank: 'B', keywords: [], personaId: me.id });
  return { char: a.id, chat: chat.id };
});

const go = async (app, route) => {
  await page.evaluate(([app, route]) => {
    import('/src/system/nav.js').then(n => n.openApp(app, route));
  }, [app, route]);
  await page.waitForTimeout(700);
};

const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok : fail).push(msg);

// ---- 1. 角色卡里不该再有清除数据 ----
await go('chat', `/edit/${ids.char}`);
let body = await page.evaluate(() => document.body.innerText);
check(!body.includes('清除数据') && !body.includes('清空聊天记录'),
  '角色卡里已经没有「清除数据」');

// ---- 2. 会话菜单里有「数据」一组，五项齐 ----
await go('chat', `/chat/${ids.chat}`);
const openMenu = async () => {
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '更多' || b.title === '更多')?.click());
  await page.waitForTimeout(500);
  return page.evaluate(() => !!document.querySelector('.fullsheet'));
};
check(await openMenu(), '会话右上角菜单打得开');

body = await page.evaluate(() => document.querySelector('.fullsheet')?.innerText || '');
for (const t of ['导出这个角色', '导入角色', '清空聊天记录', '清空记忆', '清空记忆与聊天记录']) {
  check(body.includes(t), `菜单里有「${t}」`);
}
// 「数据」这一组在最下面
const order = await page.evaluate(() => {
  const titles = [...document.querySelectorAll('.fullsheet .list-title')].map(e => e.innerText.trim());
  return titles;
});
check(order[order.length - 1] === '数据', `「数据」是最后一组（实际顺序：${order.join(' / ')}）`);

// 数目写对了
check(body.includes('4 条消息'), `清空聊天记录写了 4 条消息`);
check(body.includes('2 条记忆'), `清空记忆写了 2 条记忆`);

await page.screenshot({ path: `${OUT}/menu-top.png` });
await page.evaluate(() => {
  const el = document.querySelector('.fullsheet .scroll') || document.querySelector('.fullsheet');
  if (el) el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/menu-bottom.png` });

// ---- 3. 清空聊天记录真的清了 ----
await page.evaluate(() => [...document.querySelectorAll('.fullsheet .list-item, .fullsheet .li')]
  .find(e => e.innerText.startsWith('清空聊天记录'))?.click());
await page.waitForTimeout(400);
const dlg = await page.evaluate(() => document.body.innerText.includes('将删除 4 条消息'));
check(dlg, '确认框里写明了 4 条消息');
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.innerText.trim() === '确定')?.click());
await page.waitForTimeout(600);
const left = await page.evaluate(async ([chat]) => {
  const db = await import('/src/system/db/index.js');
  return {
    msgs: db.messages.all().filter(m => m.chatId === chat).length,
    mems: db.memories.all().length,
  };
}, [ids.chat]);
check(left.msgs === 0, `聊天记录清空了（剩 ${left.msgs} 条）`);
check(left.mems === 2, `记忆没被一起删（剩 ${left.mems} 条）`);
const closed = await page.evaluate(() => !document.querySelector('.fullsheet'));
check(closed, '清完之后菜单自己关了');

// ---- 4. 导入角色跳到「联系」的导入页 ----
await go('chat', `/chat/${ids.chat}`);
check(await openMenu(), '菜单再次打得开');
await page.evaluate(() => {
  const el = document.querySelector('.fullsheet .scroll') || document.querySelector('.fullsheet');
  if (el) el.scrollTop = el.scrollHeight;
});
const hit = await page.evaluate(() => {
  const sheet = document.querySelector('.fullsheet');
  if (!sheet) return 'no-sheet';
  const el = [...sheet.querySelectorAll('.list-item, .li')]
    .find(e => e.innerText.startsWith('导入角色'));
  if (!el) return 'no-item:' + sheet.innerText.slice(-200);
  el.click();
  return 'clicked';
});
check(hit === 'clicked', `点到了「导入角色」（${hit}）`);
await page.waitForTimeout(1200);
const where = await page.evaluate(() => document.body.innerText);
check(where.includes('角色包') && where.includes('从资料整理'), '跳到了「联系」的导入角色页');
await page.screenshot({ path: `${OUT}/import.png` });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
