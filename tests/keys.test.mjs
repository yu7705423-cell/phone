// 打字的时候不许碰系统闹钟：每按一个键就排一次，几路异步撞在同一个编号上。
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
const txt = () => page.evaluate(() => (document.querySelector('.app-layer') || document.body).innerText);

// 装一座假桥，数一数外壳被调了几次
await page.evaluate(() => {
  window.__calls = [];
  window.phoneAlarm = true;
  window.webkit = { messageHandlers: { alarm: { postMessage: async d => {
    window.__calls.push(d.action);
    if (d.action === 'schedule') return { alarmId: 'A-' + d.at };
    if (d.action === 'list') return { ids: ['A-' + (window.__last || 0)] };
    return { ok: true };
  } } } };
});

const id = await page.evaluate(async () => {
  const t = await import('/src/system/todo.js');
  const nav = await import('/src/system/nav.js');
  const row = t.addMine('去取快递');
  nav.goHome(); nav.openApp('todo', '/');
  return row.id;
});
await page.waitForTimeout(700);
await page.getByText('去取快递', { exact: true }).first().click();
await page.waitForTimeout(600);

// 一个字一个字地敲「明天七点半」
const box = page.locator('input[placeholder="明天七点"]');
await box.click();
for (const ch of '明天七点半') { await box.press(ch.length === 1 ? ch : 'a').catch(() => {}); }
await box.fill('明');
for (const s of ['明天', '明天七', '明天七点', '明天七点半']) {
  await box.fill(s); await page.waitForTimeout(120);
}
await page.waitForTimeout(600);

const after = await page.evaluate(async ([tid]) => {
  const db = await import('/src/system/db/index.js');
  const r = db.todos.get(tid);
  return { calls: window.__calls.slice(), remindAt: r.remindAt, alarmId: r.alarmId || '', whenText: r.whenText };
}, [id]);
check(after.calls.length === 0, `打字期间一次都没碰系统闹钟（调了 ${after.calls.length} 次：${after.calls.join(',')}）`);
check(after.remindAt > Date.now(), '时刻照样存下来了');
check(after.whenText === '明天七点半', `存的是原话（${after.whenText}）`);
check(!after.alarmId, '没有偷偷排进系统');

let body = await txt();
check(/尚未排入系统闹钟/.test(body), '写明了还没排进去');

// 点一下才排，而且只排一次
await page.getByText('排入', { exact: true }).first().click();
await page.waitForTimeout(700);
const put = await page.evaluate(async ([tid]) => {
  const db = await import('/src/system/db/index.js');
  const r = db.todos.get(tid);
  return { calls: window.__calls.slice(), alarmId: r.alarmId || '', alarmAt: r.alarmAt || 0, remindAt: r.remindAt };
}, [id]);
check(put.calls.filter(c => c === 'schedule').length === 1,
  `按一下只发一次（${JSON.stringify(put.calls)}）`);
check(!!put.alarmId && put.alarmAt === put.remindAt, '记下了排出去的是哪个时刻');

// 改了时刻要提示重排，而不是装作还好着
await box.fill('明天八点');
await page.waitForTimeout(500);
body = await txt();
check(/时刻已改，尚未重新排入/.test(body), `改了时刻会说（${(body.match(/[^\n]*已改[^\n]*/) || [])[0]}）`);
const st = await page.evaluate(async ([tid]) => {
  const db = await import('/src/system/db/index.js');
  const a = await import('/src/system/alarm.js');
  return a.stale(db.todos.get(tid));
}, [id]);
check(st === true, 'stale 判得出来');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
