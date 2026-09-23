// 心跳：切后台再回来，算得出「定时器停了多久」，并且据此说人话。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
await page.addInitScript(`
window.phoneKeepAlive = true;
window.__alive = false;
window.webkit = { messageHandlers: { keepalive: { postMessage: async b => {
  if (b.action === 'start') window.__alive = true;
  if (b.action === 'stop') window.__alive = false;
  return { on: window.__alive, playing: window.__alive, category: 'playback', mixing: false };
} } } };`);
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.set({ keepAlive: true }));
await page.waitForTimeout(1000);

// 装一套可以假装「切后台」的钩子：改 visibilityState 并派发事件
const hide = () => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
const show = () => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
const away = () => page.evaluate(async () => {
  const k = await import('/src/system/keepalive.js');
  return { away: k.state.get().away, text: k.awayText() };
});

// ---- 1 定时器一直在跑（浏览器里就是这样）----
await hide();
await page.waitForTimeout(16000);          // 离开 16 秒，心跳照跑
await show();
await page.waitForTimeout(400);
let a = await away();
check(a.away && a.away.away >= 15000, `量到了离开时长（${a.away?.away}ms）`);
check(a.away.frozen < 10000, `定时器没停（frozen=${a.away.frozen}ms）`);
check(/其间定时器一直在跑/.test(a.text), `说的是实话：${a.text}`);
check(/这段时间还短/.test(a.text), '十六秒的样本不把话说满，提醒去试更久的');

// 够久的样本就不再啰嗦
await page.evaluate(async () => {
  const k = await import('/src/system/keepalive.js');
  k.state.set({ away: { away: 200000, frozen: 0 } });
});
const long = await page.evaluate(async () =>
  (await import('/src/system/keepalive.js')).awayText());
check(/其间定时器一直在跑/.test(long) && !/这段时间还短/.test(long),
  `三分钟以上就直说：${long}`);

// ---- 2 定时器被冻住：把心跳掐掉再回来 ----
await hide();
await page.evaluate(() => {
  // 模拟系统把 JS 冻住：把所有 interval 停掉
  window.__frozen = [];
  const realSet = window.setInterval;
  for (let i = 1; i < 9999; i++) window.clearInterval(i);
});
await page.waitForTimeout(16000);
await show();
await page.waitForTimeout(400);
a = await away();
check(a.away.frozen > 10000, `冻住时量得出来（frozen=${a.away.frozen}ms）`);
check(/网页被系统冻住了/.test(a.text) && /保活对主动消息没有作用/.test(a.text),
  `冻住时把结论说出来：${a.text}`);

// ---- 3 离开太短不下结论 ----
await page.evaluate(async () => {
  const k = await import('/src/system/keepalive.js');
  k.state.set({ away: { away: 3000, frozen: 0 } });
});
check(await page.evaluate(async () =>
  (await import('/src/system/keepalive.js')).awayText()) === '',
  '离开太短就不说话，不拿三秒钟下结论');

// ---- 4 设置页上看得见 ----
await page.evaluate(async () => {
  const k = await import('/src/system/keepalive.js');
  k.state.set({ away: { away: 200000, frozen: 190000 } });
});
await page.evaluate(() => import('/src/system/nav.js').then(n => n.openApp('settings', '/')));
await page.waitForTimeout(900);
await page.waitForTimeout(600);
const row = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('保活'));
  return el ? el.innerText.replace(/\n/g, ' ')
    : '(没找到那一行) 页面上是：' + document.body.innerText.slice(0, 120).replace(/\n/g, ' | ');
});
check(/定时器停了 190 秒/.test(row), `设置里显示出来了：${row.slice(-70)}`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
