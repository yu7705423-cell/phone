// 一条消息只扣一次：走真实的发消息流程（输入框、发送、按「发完就回」立刻生成），
// 逐条数每条消息实际打出去几次模型请求。
//
// 当日日程与身体状态每天自动生成那两项，一天各多一次，而且只在当天第一条；
// **失败了也只试一次** —— 从前日程排失败后，之后每发一条都再排一次，一条消息两次请求。
// 这里把那种情况、重新打开页面、全局定时器反复跑、聊天接口本身报错都走一遍。
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// 模型请求按用途分开数
const hits = [];
let fail = { day: false, health: false, chat: 0 };
await ctx.route('**/relay.example.com/**', route => {
  const body = JSON.parse(route.request().postData() || '{}');
  const all = (body.messages || []).map(m => (typeof m.content === 'string' ? m.content : '')).join('\n') + (body.system || '');
  const kind = /body is like/.test(all) ? 'health' : /## Time slots/.test(all) ? 'day' : 'chat';
  hits.push(kind);
  const boom = () => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' });
  if (kind === 'day' && fail.day) return boom();
  if (kind === 'health' && fail.health) return boom();
  if (kind === 'chat' && fail.chat > 0) { fail.chat -= 1; return boom(); }
  if (kind === 'chat') {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: '收到' } }] })}\n\ndata: [DONE]\n\n` });
  }
  const content = kind === 'health'
    ? '{"energy":"low","mood":"calm","symptoms":[],"sleepMin":420,"poops":[],"note":""}'
    : '{"items":[{"slot":"morning","text":"去图书馆","cost":0}]}';
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});
// 和风天气：数它被查了几次
const qw = [];
await ctx.route('**/qw.example.com/**', route => {
  const u = new URL(route.request().url());
  qw.push(u.pathname);
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/geo/v2/city/lookup') return J({ code: '200', location: [{ id: '101270101', name: '成都', adm1: '四川省' }] });
  return J({ code: '200', daily: [{ fxDate: '2000-01-01', textDay: '小雨', textNight: '阴', tempMin: '18', tempMax: '24' }] });
});

const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

// 两个角色：一个一切正常，一个日程与身体状态都会失败。三样都开着
const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  svc.setQweather({ host: 'qw.example.com', key: 'good' });
  const mk = name => {
    const c = db.characters.create({ name, persona: 'x', dayOn: true, healthAuto: true, region: '成都' });
    const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id, paceMode: 'now' });
    return { char: c.id, chat: chat.id };
  };
  return { good: mk('林晚'), bad: mk('阿岚') };
});

const openChat = async chatId => {
  await page.evaluate(async id => {
    const n = await import('/src/system/nav.js');
    n.unlock(); n.goHome(); n.openApp('chat', `/chat/${id}`);
    for (let i = 0; i < 6 && n.currentRoute() !== `/chat/${id}`; i++) n.pop();
  }, chatId);
  await page.waitForTimeout(800);
};
// 发一条，等这一轮回复落下（或者报错落下）
const send = async (chatId, text) => {
  const before = await page.evaluate(async id => (await import('/src/system/db/index.js')).messagesOf(id).length, chatId);
  await page.locator('.composer-input').fill(text);
  await page.locator('.send-btn[aria-label="发送"]').tap();
  await page.waitForFunction(async ([id, n]) => {
    const list = (await import('/src/system/db/index.js')).messagesOf(id);
    return list.length >= n + 2 && !document.querySelector('.conv-typing');
  }, [chatId, before], { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
};
const count = () => ({ chat: hits.filter(x => x === 'chat').length, day: hits.filter(x => x === 'day').length,
  health: hits.filter(x => x === 'health').length });
const diff = (a, b) => ({ chat: b.chat - a.chat, day: b.day - a.day, health: b.health - a.health });
const same = (d, want) => d.chat === want.chat && d.day === want.day && d.health === want.health;

// ---- 一、一切正常的角色 ----
await openChat(ids.good.chat);
let c0 = count();
await send(ids.good.chat, '早');
let d = diff(c0, count());
ok('当天第一条：回复 1 次 + 日程 1 次 + 身体状态 1 次', same(d, { chat: 1, day: 1, health: 1 }), JSON.stringify(d));
ok('天气当天查一次（城市一次、预报一次），不调模型', qw.length === 2, JSON.stringify(qw));
for (const t of ['在干嘛', '吃了吗', '晚安']) {
  c0 = count();
  await send(ids.good.chat, t);
  d = diff(c0, count());
  ok(`之后每一条只调 1 次（「${t}」）`, same(d, { chat: 1, day: 0, health: 0 }), JSON.stringify(d));
}
ok('之后不再查天气', qw.length === 2, JSON.stringify(qw));

// ---- 二、日程与身体状态都失败的角色 ----
fail = { day: true, health: true, chat: 0 };
await openChat(ids.bad.chat);
c0 = count();
await send(ids.bad.chat, '早');
d = diff(c0, count());
ok('失败的那一天，第一条：回复 1 + 日程 1 + 身体状态 1，回复照常落下', same(d, { chat: 1, day: 1, health: 1 }), JSON.stringify(d));
const got = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.chat).slice(-1)[0]?.content, ids.bad);
ok('日程与身体状态失败不拦着回复', got === '收到', got);
for (const t of ['在吗', '怎么不说话']) {
  c0 = count();
  await send(ids.bad.chat, t);
  d = diff(c0, count());
  ok(`失败之后，每一条仍只调 1 次，不重试（「${t}」）`, same(d, { chat: 1, day: 0, health: 0 }), JSON.stringify(d));
}

// ---- 三、重新打开页面：内存里的记号没了，存在库里的那两个记号还在 ----
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await openChat(ids.bad.chat);
c0 = count();
await send(ids.bad.chat, '刷新之后');
d = diff(c0, count());
ok('重新打开之后：仍只调 1 次，不补试失败的日程与身体状态', same(d, { chat: 1, day: 0, health: 0 }), JSON.stringify(d));

// ---- 四、全局定时器反复跑 ----
c0 = count();
await page.evaluate(async () => {
  const p = await import('/src/system/ai/proactive.js');
  for (let i = 0; i < 5; i++) { await p.tick(); await new Promise(r => setTimeout(r, 100)); }
});
await page.waitForTimeout(800);
d = diff(c0, count());
ok('全局定时器跑 5 遍：一次模型请求都没有多', same(d, { chat: 0, day: 0, health: 0 }), JSON.stringify(d));

// ---- 五、聊天接口本身报错：默认不自动重试，也不换一套 ----
fail = { day: false, health: false, chat: 1 };
c0 = count();
await send(ids.good.chat, '这一条会失败');
d = diff(c0, count());
ok('回复失败：只打出去 1 次（自动重试、换一套默认都关着）', same(d, { chat: 1, day: 0, health: 0 }), JSON.stringify(d));

// ---- 六、失败那一天的原因写在界面上，手动可以重试 ----
const why = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const day = await import('/src/system/day.js');
  return { health: db.characters.get(o.char).healthAutoError, day: day.today(o.char)?.planFailed };
}, ids.bad);
ok('失败原因记下了，供界面写明', /boom|500/.test(why.health || '') && /boom|500/.test(why.day || ''), JSON.stringify(why));

console.log(`\n  模型请求合计：${JSON.stringify(count())}，和风天气 ${qw.length} 次`);
ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
