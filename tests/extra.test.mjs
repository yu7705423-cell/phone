import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const out = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const clock = await import('/src/system/time.js');
  const repair = await import('/src/system/ai/repair.js');
  const R = []; const ok = (n,c,e) => R.push({name:n,pass:!!c,extra:e});

  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const char = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [char.id], personaId: me.id });

  ok('本地 vs 中国·上海 算同一个地方', clock.zoneDiff('Asia/Shanghai', 'local') === 0);

  // 修格式重新分条不丢时间戳
  const m = db.messages.create({ chatId: chat.id, role: 'char', authorId: char.id, kind: 'text',
    content: '你看这个\n（图片:海边）\n好看吧', status: 'done', stamp: '2026-09-17 周三 14:30' });
  repair.applyFix(m.id, 'rows');
  const list = db.messagesOf(chat.id);
  ok('拆完第一条还留着时间戳', list[0].stamp === '2026-09-17 周三 14:30', JSON.stringify(list.map(x=>({k:x.kind,s:x.stamp}))));
  return R;
});
await browser.close();
let bad = 0;
for (const r of out) { if (!r.pass) bad++; console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.name}${r.pass ? '' : '   << ' + (r.extra ?? '')}`); }
if (errs.length) errs.forEach(e => console.log('  ERR ' + e));
console.log(`${out.length - bad}/${out.length} 通过`);
process.exit(bad || errs.length ? 1 : 0);
