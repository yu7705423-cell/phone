// 回复途中连接断开：说清楚是什么、为什么、有没有扣费（system/ai/engine.js 的 explainDrop，ARCHITECTURE 4.244）
//
// 用户报：「有的时候回复无法调用 api，会显示断开了连接」。从前气泡上只有浏览器那句笼统的原话。
//   一、连接直接断开（还没收到字）：写明连接在回复完成前断开、常见原因、可能已计费，原话留在括号里
//   二、生成期间切到后台之后断开：写明是切后台导致的，生成完之前保持在前台
//   三、断在回复中途（已经收到一部分字）：写明收到了多少字、这一次已经计费
//   四、接口自己回了错误码（比如 401）：照原样，不当成断线
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
let mode = 'drop';
await ctx.route('**/relay.example.com/**', async r => {
  if (mode === 'drop') return r.abort('connectionreset');
  if (mode === 'slowdrop') { await new Promise(x => setTimeout(x, 1500)); return r.abort('connectionreset'); }
  if (mode === '401') return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"invalid key"}}' });
  return r.abort('connectionreset');
});
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);
const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  db.settings.set({ retryMax: 0, chatFallback: false });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
});

// ---- 一：界面上发一条，连接直接断开 ----
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', '/'); n.push(`/chat/${id}`); }, ids.chat);
await page.waitForSelector('.composer-input');
await page.locator('.composer-input').fill('在吗');
await page.locator('.send-btn').click();
await page.waitForTimeout(500);
// 默认「按按钮才回」：点让对方回复
await page.locator('[aria-label="让对方回复"]').click();
await page.waitForTimeout(2500);
const shown = await page.evaluate(() => [...document.querySelectorAll('.fail-text')].map(x => x.textContent).join(' | '));
ok('断开：气泡上写明连接在回复完成前断开、常见原因、可能已计费', /连接在回复完成之前断开/.test(shown) && /常见原因/.test(shown) && /可能已经计费/.test(shown), shown);
ok('断开：浏览器的原话留在括号里', /原始错误/.test(shown), shown);

// ---- 二：生成期间切到后台 ----
mode = 'slowdrop';
const away = await page.evaluate(async o => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  setTimeout(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, 300);
  try { await engine.streamReply({ chat: db.chats.get(o.chat), char: db.characters.get(o.char) }); return ''; }
  catch (e) { return String(e.message); }
  finally {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }
}, ids);
ok('生成期间切到后台之后断开：写明是切后台导致、保持在前台', /切到了后台或锁屏/.test(away) && /保持应用在前台/.test(away), away);

// ---- 三：断在回复中途 ----
const mid = await page.evaluate(async () => {
  const { explainDrop } = await import('/src/system/ai/engine.js');
  return explainDrop(new TypeError('Load failed'), { got: 37 }).message;
});
ok('断在回复中途：写明收到多少字、这一次已经计费', /收到 37 字/.test(mid) && /已经计费/.test(mid) && /Load failed/.test(mid), mid);

// ---- 四：接口回了错误码 ----
mode = '401';
const e401 = await page.evaluate(async o => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  try { await engine.streamReply({ chat: db.chats.get(o.chat), char: db.characters.get(o.char) }); return ''; }
  catch (e) { return String(e.message); }
}, ids);
ok('接口回了错误码：照原样，不当成断线', /401/.test(e401) && !/断开/.test(e401), e401);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
