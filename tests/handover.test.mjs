// 后台消息开着时，主动消息由本机与服务器分着发：同一次开口只能扣一次钱（system/bgpush.js，ARCHITECTURE 4.242）
//
//   一、退到后台之后页面还在跑（电脑后台标签页、安卓浏览器）：本机不发，归服务器
//   二、刚回到前台、服务器发过的还没取回来：本机不发；取回之后落点重掷，本机也不立刻再发
//   三、服务器替你发失败了（模型那一次可能已经扣过）：回来之后本机不补发
//   四、服务器连不上：本机一直不发，「设置 - 通知」写明原因
//   五、后台消息关着：本机照常发（没有误伤）
import { BASE, EXE, chromium } from './_env.mjs';

const PUSH = 'https://push.example.com';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/src/site.js*', async r => {
    const res = await r.fetch();
    r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
  });
  const state = { results: [], resultsDelay: 0, resultsStatus: 200, calls: [], model: 0 };
  await ctx.route(`${PUSH}/**`, async r => {
    const u = new URL(r.request().url());
    state.calls.push(u.pathname);
    const reply = (data, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname === '/results') {
      if (state.resultsDelay) await new Promise(x => setTimeout(x, state.resultsDelay));
      if (state.resultsStatus !== 200) return reply({ error: '服务器出错' }, state.resultsStatus);
      const out = state.results; state.results = [];
      return reply({ results: out });
    }
    return reply({ ok: true });
  });
  await ctx.route('**/relay.example.com/**', r => {
    if (/opening this time/.test(r.request().postData() || '')) state.model += 1;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '在吗' } }] }) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/index.html`);
  await page.waitForTimeout(1500);
  const ids = await page.evaluate(async push => {
    const { db } = await import('/src/system/db/index.js');
    const svc = await import('/src/system/ai/services.js');
    const acc = await import('/src/system/accounts.js');
    const p = svc.newChatPreset({ name: '主用' });
    svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
    svc.setActiveChat(p.id);
    const c = db.characters.create({ name: '阿岚', proactive: true, proactiveMinutes: 60, proactiveQuietFrom: 0, proactiveQuietTo: 0 });
    const chat = db.chats.create({ characterIds: [c.id], personaId: acc.currentId(), lastMessageAt: Date.now() });
    db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '晚安', status: 'done' });
    return { char: c.id, chat: chat.id };
  }, PUSH);
  const n = await import('node:process');
  void n;
  return { ctx, page, state, ids };
}
const setBg = (page, on) => page.evaluate(async ([on, push]) => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ bgPush: { ...(db.settings.get().bgPush || {}), on, server: push } });
  if (on) localStorage.setItem('eira-bgpush-device', JSON.stringify({ server: push, id: '11111111-2222-3333-4444-555555555555', token: 'tok' }));
  else localStorage.removeItem('eira-bgpush-device');
}, [on, PUSH]);
const vis = (page, v) => page.evaluate(v => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}, v);
const due = (page, id) => page.evaluate(async id => (await import('/src/system/ai/proactive.js')).scheduleIn(id, 1000), id);
const tick = page => page.evaluate(async () => (await import('/src/system/ai/proactive.js')).tick());

// ---- 一、退到后台 ----
{
  const { ctx, page, state, ids } = await open();
  await setBg(page, true);
  await vis(page, 'hidden');
  await due(page, ids.char);
  await page.waitForTimeout(1300);
  await tick(page);
  await page.waitForTimeout(1500);
  ok('退到后台之后页面还在跑：本机不发主动消息，归服务器', state.model === 0, `本机发了 ${state.model} 次`);

  // ---- 二、回来时服务器发过的还没取回 ----
  state.resultsDelay = 3000;
  state.results = [{ id: 'r1', chatId: ids.chat, charId: ids.char, text: '到家了吗', firedAt: Date.now() - 60000, status: 'done' }];
  await vis(page, 'visible');
  await page.waitForTimeout(300);
  await tick(page);
  await page.waitForTimeout(500);
  ok('刚回到前台、服务器发过的还没取回：本机不发', state.model === 0, `本机发了 ${state.model} 次`);
  await page.waitForTimeout(3500);
  await tick(page);
  await page.waitForTimeout(1000);
  const landed = await page.evaluate(async id => (await import('/src/system/db/index.js')).db.messages.where(m => m.chatId === id && m.content === '到家了吗').length, ids.chat);
  ok('取回之后：服务器那条落进会话，本机也不立刻再发一次', landed === 1 && state.model === 0, `落了 ${landed} 条，本机发了 ${state.model} 次`);
  await ctx.close();
}

// ---- 三、服务器替你发失败了 ----
{
  const { ctx, page, state, ids } = await open();
  await setBg(page, true);
  await vis(page, 'hidden');
  await due(page, ids.char);
  await page.waitForTimeout(1300);
  state.results = [{ id: 'r2', chatId: ids.chat, charId: ids.char, status: 'failed', error: '接口 500: boom', firedAt: Date.now() }];
  await vis(page, 'visible');
  await page.waitForTimeout(1500);
  await tick(page);
  await page.waitForTimeout(1500);
  ok('服务器替你发失败了：回来之后本机不补发（那一次可能已经扣过）', state.model === 0, `本机发了 ${state.model} 次`);
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/notify'); });
  await page.waitForTimeout(700);
  ok('失败写在「设置 - 通知」里', /服务器替角色发送失败/.test(await page.evaluate(() => document.body.innerText)));
  await ctx.close();
}

// ---- 四、服务器连不上 ----
{
  const { ctx, page, state, ids } = await open();
  await setBg(page, true);
  state.resultsStatus = 502;
  await vis(page, 'hidden');
  await vis(page, 'visible');
  await page.waitForTimeout(800);
  await due(page, ids.char);
  await page.waitForTimeout(1300);
  await tick(page);
  await page.waitForTimeout(1500);
  ok('服务器连不上：本机不发（宁可少发，不能同一次扣两次）', state.model === 0, `本机发了 ${state.model} 次`);
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/notify'); });
  await page.waitForTimeout(700);
  ok('原因写在「设置 - 通知」里', /连不上后台消息服务器/.test(await page.evaluate(() => document.body.innerText)));
  await ctx.close();
}

// ---- 五、后台消息关着 ----
{
  const { ctx, page, state, ids } = await open();
  await due(page, ids.char);
  await page.waitForTimeout(1300);
  await tick(page);
  await page.waitForTimeout(2000);
  ok('后台消息关着：本机照常发一次', state.model === 1, `本机发了 ${state.model} 次`);
  await ctx.close();
}

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const fails = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fails}/${R.length} 通过`);
process.exit(fails ? 1 : 0);
