// 存钱的入口、支出构成、跨消息认时间。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);
const txt = () => page.evaluate(() => document.body.innerText);

// ---- 1 跨消息认时间 ----
const cross = await page.evaluate(async () => {
  const t = await import('/src/system/todo.js');
  const db = await import('/src/system/db/index.js');
  const out = {};
  // 甲：时刻在前一句
  const a = t.propose({ text: '我要叫我起来跑步', chatId: 'A', near: ['在吗', '明天七点'] });
  out.before = a?.remindAt > Date.now();
  // 乙：时刻在后一句 —— 先落一条没时刻的，再补
  const b = t.propose({ text: '我要买牛奶', chatId: 'B' });
  out.noneYet = b?.remindAt === 0;
  const fixed = t.attachTime('B', '明天八点');
  out.after = fixed?.remindAt > Date.now();
  // 丙：隔太多句不算
  const c = t.propose({ text: '我要去理发', chatId: 'C',
    near: ['明天七点', '一', '二', '三', '四', '五'] });
  out.tooFar = c?.remindAt === 0;
  // 丁：这一句自己带线索词时，不去动别人的
  t.propose({ text: '我要交房租', chatId: 'D' });
  const stolen = t.attachTime('D', '我想明天九点去健身');
  out.notStolen = stolen === null;
  // 戊：只有时刻但没有等着确认的，什么也不做
  out.nothing = t.attachTime('E', '明天十点') === null;
  return out;
});
check(cross.before, '时刻在前一句，认得出来');
check(cross.noneYet && cross.after, '时刻在后一句，回头补上');
check(cross.tooFar, '隔太多句就不算了');
check(cross.notStolen, '自己带线索词的那句不去动别人的');
check(cross.nothing, '没有等着确认的就什么都不做');

// ---- 2 存钱 ----
const acc = await page.evaluate(async () => {
  const L = await import('/src/system/ledger.js');
  const b = L.ensure();
  const a = L.accountsOf(b.id)[0] || L.addAccount(b.id, { name: '钱包', owner: 'me' });
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('bill', '/accounts');
  return { book: b.id, acc: a.id, before: L.balanceOf(b.id, a.id) };
});
await page.waitForTimeout(800);
let body = await txt();
check(/存入/.test(body) && /取出/.test(body), '账户旁边就有存入与取出');

await page.evaluate(() => {
  [...document.querySelectorAll('.chip')].find(c => c.innerText.trim() === '存入')?.click();
});
await page.waitForTimeout(600);
body = await txt();
check(/存入/.test(body) && /金额/.test(body), '点开就是存入那一张，账户已经选好');
await page.evaluate(() => {
  const el = document.querySelector('.sheet input[type="number"]')
    || document.querySelectorAll('input[type="number"]')[0];
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, '500');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '记下')?.click();
});
await page.waitForTimeout(800);
const bal = await page.evaluate(async ([book, a]) => {
  const L = await import('/src/system/ledger.js');
  return L.balanceOf(book, a);
}, [acc.book, acc.acc]);
check(bal === acc.before + 500, `存进去了（${acc.before} 到 ${bal}）`);

// ---- 3 支出构成 ----
const sp = await page.evaluate(async ([book, a]) => {
  const L = await import('/src/system/ledger.js');
  const now = Date.now();
  L.add({ bookId: book, accountId: a, amount: -60, category: 'food', note: '午饭', at: now });
  L.add({ bookId: book, accountId: a, amount: -40, category: 'food', note: '晚饭', at: now });
  L.add({ bookId: book, accountId: a, amount: -100, category: 'transit', note: '打车', at: now });
  const s = L.spending(book);
  return { rows: s.rows.map(r => [r.label, r.amount, r.count, Math.round(r.share * 100)]),
    total: s.total, months: L.months(book).length };
}, [acc.book, acc.acc]);
check(sp.total === 200, `总数对（${sp.total}）`);
check(JSON.stringify(sp.rows[0]) === JSON.stringify(['餐饮', 100, 2, 50]),
  `按金额排，带笔数与占比（${JSON.stringify(sp.rows)}）`);
check(sp.months >= 1, '月份列得出来');

await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('bill', '/spend');
});
await page.waitForTimeout(800);
body = await txt();
check(/餐饮/.test(body) && /50%/.test(body) && /2 笔/.test(body),
  '支出页上分类、占比、笔数都在');
const bars = await page.locator('.sp-bar').count();
check(bars === 2, `每一类画一道占比（${bars} 道）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
