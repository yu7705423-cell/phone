// 后台消息，应用这一侧（system/bgpush.js，ARCHITECTURE 4.226）。推送服务器用路由顶上，
// 浏览器的推送订阅用一个假的（无头浏览器连不上真的推送服务）。
//
//   site.js 没配推送服务器：「设置 - 通知」里没有这一项；配了才有
//   打开：取公钥、订阅、登记设备，报到（还开着）
//   交上去的任务：开了「主动找你」的角色一条，带着接下来几次的时间与完整请求，
//     请求里「现在几点」「多久没说话」是留给服务器填的记号，密钥就是这套接口的
//   退到后台：再交一次，标明「走了」
//   回来：服务器替你发出去的那几条落进会话，时间是发出去的那一刻，未读加上，确认删掉
//   关掉：服务器上这台设备删掉
import { BASE, EXE, chromium } from './_env.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUSH = 'https://push.example.com';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

async function open({ server = PUSH, noPush = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(['notifications'], { origin: BASE });
  const site = readFileSync(join(ROOT, 'src/site.js'), 'utf8')
    .replace(/accounts:\s*'[^']*'/, "accounts: ''")
    .replace(/pushServer:\s*'[^']*'/, `pushServer: '${server}'`);
  await ctx.route('**/src/site.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: site }));
  // 安装版应用的外壳里没有 Web Push
  if (noPush) await ctx.addInitScript(() => { delete window.PushManager; });
  // 假的推送订阅
  await ctx.addInitScript(() => {
    const fake = { endpoint: 'https://fcm.example.com/send/abc', options: { applicationServerKey: null },
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPUB', auth: 'AUTH' } }; }, unsubscribe: async () => true };
    let have = null;
    if (window.PushManager) {
      PushManager.prototype.subscribe = async function (o) { fake.options.applicationServerKey = o.applicationServerKey; have = fake; return fake; };
      PushManager.prototype.getSubscription = async function () { return have; };
    }
  });
  const calls = [];
  let results = [];
  await ctx.route(`${PUSH}/**`, async r => {
    const u = new URL(r.request().url());
    const body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
    calls.push({ method: r.request().method(), path: u.pathname, body, auth: r.request().headers().authorization || '' });
    const reply = data => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname === '/vapid') return reply({ publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' });
    if (u.pathname === '/device' && r.request().method() === 'POST') return reply({ id: '11111111-2222-3333-4444-555555555555', token: 'tok' });
    if (u.pathname === '/results') return reply({ results });
    return reply({ ok: true });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return { ctx, page, calls, setResults: x => { results = x; } };
}

// ---- 没配服务器：没有这一项 ----
{
  const { ctx, page } = await open({ server: '' });
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/notify'); });
  await page.waitForTimeout(700);
  const txt = await page.evaluate(() => document.body.innerText);
  ok('site.js 没配推送服务器：设置里没有「后台消息」', !/后台消息/.test(txt), '');
  await ctx.close();
}

const { ctx, page, calls, setResults } = await open();
const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const acc = await import('/src/system/accounts.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-test', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '阿岚', proactive: true, proactiveMinutes: 60, proactiveQuietFrom: 0, proactiveQuietTo: 0 });
  const quiet = db.characters.create({ name: '阿树' });           // 没开「主动找你」
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id, lastMessageAt: Date.now() });
  db.chats.create({ characterIds: [quiet.id], personaId: me.id });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '晚安', status: 'done' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/notify');
  return { chat: chat.id, char: c.id };
});
await page.waitForTimeout(700);
ok('配了推送服务器：设置里有「后台消息」，默认关', await page.locator('.list-item', { hasText: '后台消息' }).count() > 0
  && await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.get().bgPush?.on !== true), '');

// ---- 打开 ----
await page.locator('.list-item', { hasText: '后台消息' }).locator('.switch, [role="switch"], input[type="checkbox"]').first().click();
await page.waitForTimeout(1500);
const dev = calls.find(c => c.path === '/device' && c.method === 'POST');
const plan1 = calls.find(c => c.path === '/plan');
ok('打开：取公钥、订阅、登记设备', calls.some(c => c.path === '/vapid') && dev?.body?.subscription?.endpoint === 'https://fcm.example.com/send/abc', JSON.stringify(calls.map(c => c.path)));
ok('登记之后带着口令报到（还开着）', plan1 && plan1.auth === 'Bearer 11111111-2222-3333-4444-555555555555.tok' && plan1.body.away === false, JSON.stringify(plan1));
const job = plan1?.body?.jobs?.[0] || {};
const sys = JSON.stringify(job.request?.body || {});
ok('交上去的任务：只有开了「主动找你」的那个角色，接下来两次的时间', plan1?.body?.jobs?.length === 1 && job.charId === ids.char && job.chatId === ids.chat
  && job.due?.length === 2 && job.due[0] > Date.now() && job.due[1] > job.due[0], JSON.stringify({ n: plan1?.body?.jobs?.length, due: job.due }));
ok('请求是这套接口的：地址、密钥、模型，正文里带着聊天记录', job.request?.url === 'https://relay.example.com/v1/chat/completions'
  && job.request?.headers?.authorization === 'Bearer sk-test' && job.request?.body?.model === 'm' && /晚安/.test(sys), JSON.stringify(job.request).slice(0, 300));
ok('「现在几点」「多久没说话」留成记号，服务器到点填', sys.includes('{{bg_time}}') && sys.includes('{{bg_gap}}') && job.tz && job.lastAt > 0, sys.slice(-400));

// ---- 退到后台 ----
calls.length = 0;
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1000);
const away = calls.find(c => c.path === '/plan');
ok('退到后台：再交一次，标明「走了」', away && away.body.away === true && away.body.jobs.length === 1, JSON.stringify(away?.body?.away));

// ---- 回来 ----
const fired = Date.now() - 2 * 3600000;
setResults([{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'done', firedAt: fired, chatId: ids.chat, charId: ids.char, text: '醒了吗\n今天下雨了' }]);
calls.length = 0;
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1500);
const back = await page.evaluate(async o => {
  const { db } = await import('/src/system/db/index.js');
  const list = db.messages.all().filter(m => m.chatId === o.chat && m.role === 'char').sort((a, b) => a.createdAt - b.createdAt);
  return { texts: list.map(m => m.content), at: list.map(m => m.createdAt), unread: db.chats.get(o.chat).unread || 0 };
}, ids);
ok('回来：服务器替你发出去的落进会话，照平时一样分条', JSON.stringify(back.texts) === '["醒了吗","今天下雨了"]', JSON.stringify(back));
ok('时间是发出去的那一刻，未读加上', back.at[0] >= fired && back.at[0] < fired + 1000 && back.unread === 2, JSON.stringify(back));
ok('取回之后请服务器删掉', calls.some(c => c.path === '/ack' && c.body.ids[0] === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), JSON.stringify(calls.map(c => c.path)));

// ---- 通知通道 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('settings', '/notify'); });
await page.waitForTimeout(600);
await page.locator('.segmented button, [role="tab"], .seg-item', { hasText: 'Bark' }).first().click();
await page.waitForTimeout(300);
const barkFields = await page.evaluate(() => document.body.innerText);
ok('选 Bark：出现推送地址与加密 Key、IV', /Bark 推送地址/.test(barkFields) && /加密 Key/.test(barkFields) && /加密 IV/.test(barkFields), '');
await page.locator('input[placeholder="https://api.day.app/..."]').fill('https://api.day.app/AbCd1234');
await page.waitForTimeout(200);
calls.length = 0;
await page.getByText('测试通知通道', { exact: true }).click();
await page.waitForTimeout(600);
const tc = calls.find(c => c.path === '/test');
ok('测试通知通道：把现在填的 Bark 交给服务器发一条', tc?.body?.channel?.kind === 'bark' && tc.body.channel.url === 'https://api.day.app/AbCd1234'
  && /icon-192\.png$/.test(tc.body.channel.icon || '') && !tc.body.channel.key, JSON.stringify(tc?.body));
const ch = await page.evaluate(async () => {
  const b = await import('/src/system/bgpush.js');
  const good = b.channelOut({ kind: 'bark', url: 'https://api.day.app/K', key: '0123456789abcdef', iv: 'fedcba9876543210' });
  const bad = b.channelOut({ kind: 'bark', url: 'https://api.day.app/K', key: 'short', iv: 'x' });
  const pp = b.channelOut({ kind: 'pushplus', token: ' t1 ', hide: true });
  const none = b.channelOut({ kind: 'pushplus', token: '' });
  return { good, bad, pp, none };
});
ok('加密填对了才带上 Key 与 IV；填错了不退回明文，改成只写「发来一条消息」', ch.good.key === '0123456789abcdef' && ch.good.hide === false
  && !ch.bad.key && ch.bad.hide === true, JSON.stringify(ch));
ok('PushPlus：带 token；没填就不交通道', ch.pp.kind === 'pushplus' && ch.pp.token === 't1' && ch.pp.hide === true && ch.none === null, JSON.stringify(ch));
calls.length = 0;
await page.evaluate(async () => (await import('/src/system/bgpush.js')).plan({ away: true }));
const withCh = calls.find(c => c.path === '/plan');
ok('交任务时通道跟着一起交', withCh?.body?.channel?.kind === 'bark' && withCh.body.channel.url === 'https://api.day.app/AbCd1234', JSON.stringify(withCh?.body?.channel));
const bk = await page.evaluate(async () => {
  const backup = await import('/src/system/backup.js');
  const b = await import('/src/system/bgpush.js');
  b.setChannel({ kind: 'pushplus', token: 'secret-token', key: 'k', iv: 'v' });
  const data = JSON.parse(await (await backup.build({ media: false })).text());
  return data.settings.bgPush.channel;
});
ok('备份里不带通道的地址、密钥与 token', bk.kind === 'pushplus' && !bk.token && !bk.url && !bk.key && !bk.iv, JSON.stringify(bk));

// eira://chat/会话 点开之后外壳喊的那一下：跳进那段会话
await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.goHome(); window.phoneNotifyOpen({ appId: 'chat', route: `/chat/${o.chat}` }); }, ids);
await page.waitForTimeout(800);
const where = await page.evaluate(async () => { const n = await import('/src/system/nav.js'); return JSON.stringify(n.nav.get()); });
ok('外壳交来的「打开这段会话」：跳进去了', where.includes(ids.chat), where.slice(0, 300));

// ---- 关掉 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('settings', '/notify'); });
await page.waitForTimeout(600);
calls.length = 0;
await page.locator('.list-item', { hasText: '后台消息' }).locator('.switch, [role="switch"], input[type="checkbox"]').first().click();
await page.waitForTimeout(800);
const off = await page.evaluate(async () => ({ on: (await import('/src/system/db/index.js')).db.settings.get().bgPush?.on, dev: localStorage.getItem('eira-bgpush-device') }));
ok('关掉：服务器上这台设备删掉，本机登记清掉', calls.some(c => c.path === '/device' && c.method === 'DELETE') && off.on === false && !off.dev, JSON.stringify(off));

// ---- 安装版应用（没有 Web Push）：照样能开，不订阅，消息打开时出现 ----
{
  const app = await open({ noPush: true });
  const got = await app.page.evaluate(async () => {
    const { db } = await import('/src/system/db/index.js');
    const c = db.characters.create({ name: '阿岚', proactive: true });
    db.chats.create({ characterIds: [c.id] });
    const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/notify');
    await new Promise(r => setTimeout(r, 700));
    return { text: document.body.innerText, test: [...document.querySelectorAll('button')].some(b => /测试推送/.test(b.textContent)) };
  });
  ok('安装版应用：「后台消息」照样显示，说明写着不弹通知、打开时出现', /后台消息/.test(got.text) && /不会弹出通知/.test(got.text), got.text.slice(0, 300));
  await app.page.locator('.list-item', { hasText: '后台消息' }).locator('.switch, [role="switch"], input[type="checkbox"]').first().click();
  await app.page.waitForTimeout(1200);
  const reg = app.calls.find(c => c.path === '/device' && c.method === 'POST');
  const st = await app.page.evaluate(async () => ({ on: (await import('/src/system/db/index.js')).db.settings.get().bgPush?.on,
    dev: JSON.parse(localStorage.getItem('eira-bgpush-device') || 'null') }));
  ok('安装版应用：打开时不取公钥、不订阅，只登记设备', reg && !reg.body.subscription && !app.calls.some(c => c.path === '/vapid')
    && st.on === true && st.dev?.id && st.dev.endpoint === '', JSON.stringify({ reg: reg?.body, st }));
  ok('安装版应用：没有「测试推送」按钮', !(await app.page.evaluate(() => [...document.querySelectorAll('button')].some(b => /测试推送/.test(b.textContent)))));
  await app.ctx.close();
}

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
