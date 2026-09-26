// 角色每日穿搭与「任务用哪套接口」（ARCHITECTURE 4.237）
//
//   一、主动发消息、总结记忆、每日穿搭各自可以指定一套接口；没指定照默认；指定的那套没填全也照默认
//   二、每日穿搭：开了的角色，每天从自己衣帽间里挑一次，勾成今天穿着、带着；
//       同一天不再调；今天已经穿着东西的不碰；失败记在角色身上；开关在该角色的衣帽间页
//   三、配了和风天气（用户要求「严格结合天气」）：当天预报作为硬性条件进请求；
//       标了季节却不合当天气温的衣物不交给模型，模型选回来也不认
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const hits = [];
const bodies = [];
let reply = '{}';
await ctx.route('**/qw.example.com/**', route => {
  const u = new URL(route.request().url());
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
  if (u.pathname === '/geo/v2/city/lookup') return J({ code: '200', location: [{ id: '101050101', name: '哈尔滨', adm1: '黑龙江省', country: '中国', tz: 'Asia/Shanghai' }] });
  return J({ code: '200', daily: [{ fxDate: '2000-01-01', textDay: '小雪', textNight: '阴', tempMin: '-12', tempMax: '-3', humidity: '70', precip: '1.5', windDirDay: '北风', windScaleDay: '3-4', uvIndex: '1' }] });
});
await ctx.route(/https:\/\/(main|side|third)\.example\.com\//, async route => {
  const host = new URL(route.request().url()).host.split('.')[0];
  hits.push(host);
  const body = JSON.parse(route.request().postData() || '{}');
  bodies.push(JSON.stringify(body));
  if (body.stream) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n` });
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const mk = (name, host, full = true) => {
    const p = svc.newChatPreset({ name });
    svc.updateChatPreset(p.id, { baseUrl: `https://${host}.example.com/v1`, apiKey: full ? 'k' : '', model: 'm', provider: 'openai' });
    return p.id;
  };
  const main = mk('主', 'main'), side = mk('副', 'side'), third = mk('第三', 'third'), half = mk('半填', 'third', false);
  svc.setActiveChat(main); svc.setFallbackChat(side);
  const cl = await import('/src/system/closet.js');
  const c = db.characters.create({ name: '阿岚' });
  const tee = cl.create({ owner: c.id, group: 'top', sub: 'T 恤', name: '白色 T 恤' });
  const umb = cl.create({ owner: c.id, group: 'carry', sub: '伞', name: '折叠伞' });
  const c2 = db.characters.create({ name: '阿澈' });
  const coat = cl.create({ owner: c2.id, group: 'top', sub: 'T 恤', name: '灰色 T 恤' });
  return { main, side, third, half, char: c.id, tee: tee.id, umb: umb.id, char2: c2.id, coat: coat.id };
});

// ---- 一、路由 ----
const host = task => ev(async t => {
  const e = await import('/src/system/ai/engine.js');
  return (e.presetFor(t)?.baseUrl || '').replace(/^https:\/\/|\.example\.com\/v1$/g, '');
}, task);
const route = (g, v) => ev(async ([g, v]) => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ taskRoutes: { ...(db.settings.get().taskRoutes || {}), [g]: v } });
}, [g, v]);
ok('没指定：主动发消息走副用', await host('chat.proactive') === 'side');
ok('没指定：每日穿搭走副用', await host('closet.daily') === 'side');
await route('proactive', ids.third);
ok('主动发消息指定第三套：走第三套', await host('chat.proactive') === 'third');
ok('不影响别的任务：对话回复仍走主用', await host('chat.reply') === 'main');
await route('memory', 'main');
ok('总结记忆指定主用：走主用', await host('memory.extract') === 'main');
await route('proactive', ids.half);
ok('指定的那套没填全：照默认走副用', await host('chat.proactive') === 'side');
await route('proactive', '');
// 4.276：线下与长篇正文、长篇简介大纲走向、心声、填文件、工具箱各自一组
ok('没指定：线下正文走主用', await host('scene.write') === 'main');
ok('没指定：长篇大纲走副用', await host('work.outline') === 'side');
await route('scene', ids.third);
ok('线下正文指定第三套：走第三套', await host('scene.write') === 'third');
ok('不影响长篇大纲', await host('work.outline') === 'side');
await route('novel', 'main'); await route('inner', ids.third); await route('fileFill', ids.third); await route('tools', ids.third);
ok('长篇大纲指定主用', await host('work.outline') === 'main');
ok('长篇走向同组', await host('work.branch') === 'main');
ok('心声指定第三套', await host('inner.voice') === 'third');
ok('填文件指定第三套', await host('file.fill') === 'third');
ok('工具箱指定第三套', await host('tool.world') === 'third');
ok('对话回复仍走主用', await host('chat.reply') === 'main');
await route('scene', ''); await route('novel', ''); await route('inner', ''); await route('fileFill', ''); await route('tools', '');

// 界面：设置 - 接口 - 任务用哪套接口
await ev(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/'); n.push('/api'); });
await page.waitForTimeout(600);
await page.locator('.list-item', { hasText: '任务用哪套接口' }).click();
await page.waitForTimeout(500);
await page.locator('.list-wrap', { hasText: '角色的每日穿搭' }).locator('.list-item', { hasText: '第三' }).click();
await page.waitForTimeout(300);
ok('界面上点选写进设置', await ev(async () => (await import('/src/system/db/index.js')).settings.get().taskRoutes?.closetDaily) === ids.third);
ok('每日穿搭改走第三套', await host('closet.daily') === 'third');

// ---- 二、每日穿搭 ----
const worn = id => ev(async id => (await import('/src/system/closet.js')).wornToday(id).map(r => r.id).sort(), id);
const daily = id => ev(async id => (await import('/src/system/ai/tasks/closet.js')).ensureDaily(id), id);
const setChar = (id, patch) => ev(async ([id, p]) => (await import('/src/system/db/index.js')).characters.update(id, p), [id, patch]);

hits.length = 0;
await daily(ids.char);
ok('没开：不调接口', hits.length === 0, JSON.stringify(hits));
await setChar(ids.char, { closetDaily: true });
reply = JSON.stringify({ wear: [ids.tee, 'no-such-id'], carry: [ids.umb] });
await daily(ids.char);
ok('开了：调一次，走指定的那套', hits.length === 1 && hits[0] === 'third', JSON.stringify(hits));
const w = await worn(ids.char);
ok('挑出来的勾成今天穿着、带着（不认识的 id 丢掉）', JSON.stringify(w) === JSON.stringify([ids.tee, ids.umb].sort()), JSON.stringify(w));
await ev(async id => { const cl = await import('/src/system/closet.js'); cl.wornToday(id).forEach(r => cl.wear(r.id, false)); }, ids.char);
await daily(ids.char);
ok('同一天不再调', hits.length === 1, JSON.stringify(hits));

// 已经穿着东西的不碰
await setChar(ids.char2, { closetDaily: true });
await ev(async id => (await import('/src/system/closet.js')).wear(id, true), ids.coat);
await daily(ids.char2);
ok('今天已经穿着东西：不调', hits.length === 1, JSON.stringify(hits));
// 失败：记在角色身上
await ev(async id => { const cl = await import('/src/system/closet.js'); cl.wear(id, false); }, ids.coat);
reply = JSON.stringify({ wear: [], carry: [] });
await daily(ids.char2);
const err = await ev(async id => (await import('/src/system/db/index.js')).characters.get(id).closetDailyError, ids.char2);
ok('失败：原因记在角色身上', /没有从衣帽间里选出/.test(err || ''), err);

// 登记在「用量与上限」的账上
const listed = await ev(async () => (await import('/src/system/ai/cost.js')).EXTRA_CALLS.some(x => x.id === 'closetDaily' && x.on()));
ok('开着的角色算进额外调用', listed);

// 开关在该角色的衣帽间页
await ev(async id => {
  (await import('/src/system/db/index.js')).settings.set({ closetOwner: id, closetSide: 'wear' });
  const n = await import('/src/system/nav.js'); n.openApp('closet', '/');
}, ids.char2);
await page.waitForTimeout(800);
const txt = await ev(() => document.body.innerText);
ok('角色的衣帽间页：有每日自动穿搭开关', /每日自动穿搭/.test(txt), txt.slice(0, 300));
ok('角色的衣帽间页：写明今天自动生成失败的原因', /没有从衣帽间里选出/.test(txt), txt.slice(0, 300));

// ---- 三、天气 ----
const noWeather = bodies.find(b => /Choose what/.test(b)) || '';
ok('没配和风天气：请求里没有天气那一段', noWeather && !/weather/i.test(noWeather.replace(/Choose what[^]*?\{/, '')), noWeather.slice(0, 200));
const wx = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  svc.setQweather({ host: 'https://qw.example.com', key: 'good' });
  const cl = await import('/src/system/closet.js');
  const c = db.characters.create({ name: '阿雪', region: '哈尔滨', closetDaily: true });
  const tee = cl.create({ owner: c.id, group: 'top', sub: 'T 恤', name: '短袖', seasons: ['summer'] });
  const down = cl.create({ owner: c.id, group: 'top', sub: 'T 恤', name: '长款羽绒服', seasons: ['winter'] });
  const plain = cl.create({ owner: c.id, group: 'top', sub: 'T 恤', name: '没标季节的毛衣' });
  const umb = cl.create({ owner: c.id, group: 'carry', sub: '伞', name: '折叠伞' });
  return { char: c.id, tee: tee.id, down: down.id, plain: plain.id, umb: umb.id };
});
bodies.length = 0;
reply = JSON.stringify({ wear: [wx.tee, wx.down], carry: [wx.umb] });
await daily(wx.char);
const req = bodies.find(b => /Choose what/.test(b)) || '';
ok('配了和风天气：当天预报作为硬性条件进请求', /hard constraint/.test(req) && /小雪/.test(req) && /-12 to -3/.test(req), req.slice(0, 400));
ok('不合当天气温的衣物（夏季短袖）不交给模型', !req.includes('短袖') && req.includes('长款羽绒服') && req.includes('没标季节的毛衣'), req.slice(0, 600));
const ww = await worn(wx.char);
ok('模型选回来的短袖也不认，羽绒服与伞照常勾上', JSON.stringify(ww) === JSON.stringify([wx.down, wx.umb].sort()), JSON.stringify(ww));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
