// 和风天气：配 API Host 与 KEY，按角色卡上的「所在地区」查当天预报，写进日程请求与聊天上下文，
// 城市编号查一次就记住，「日常 - 今天」上显示并可刷新；
// 健康：每天自动生成，默认关，开了每天一次，已有内容不碰，失败也不反复重试
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const qw = { lookup: 0, daily: 0, keys: [] };
let rain = '小雨';
let charDate = '';
await ctx.route('**/qw.example.com/**', route => {
  const u = new URL(route.request().url());
  const key = route.request().headers()['x-qw-api-key'];
  qw.keys.push(key);
  const J = (o, status = 200) => route.fulfill({ status, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
  if (key !== 'good') return J({ error: { status: 401, type: 'x', title: 'Unauthorized', detail: 'Invalid API key' } }, 401);
  if (u.pathname === '/geo/v2/city/lookup') {
    qw.lookup += 1;
    const loc = u.searchParams.get('location');
    if (loc === '不存在的地方') return J({ code: '404' });
    return J({ code: '200', location: [{ id: loc === '北京' ? '101010100' : '101270101', name: loc, adm1: '四川省', country: '中国', tz: 'Asia/Shanghai' }] });
  }
  if (u.pathname === '/v7/weather/3d') {
    qw.daily += 1;
    // 角色那边的「今天」（按应用里的时钟与时区算），由页面告诉我们
    const d0 = charDate;
    return J({ code: '200', daily: [
      // 和风的三天预报第一天就是今天（设置页的测试查询不带日期，取的就是第一天）
      { fxDate: d0, textDay: rain, textNight: '阴', tempMin: '18', tempMax: '24', humidity: '80', precip: '3.2', windDirDay: '东北风', windScaleDay: '1-3', uvIndex: '2' },
      { fxDate: '2000-01-01', textDay: '晴', textNight: '晴', tempMin: '1', tempMax: '2' },
    ] });
  }
  return J({ code: '404' });
});
const asked = [];
let failHealth = false;
await ctx.route('**/relay.example.com/**', route => {
  const body = JSON.parse(route.request().postData() || '{}');
  const all = (body.messages || []).map(m => (typeof m.content === 'string' ? m.content : '')).join('\n') + (body.system || '');
  const isHealth = /body is like/.test(all);
  asked.push({ kind: isHealth ? 'health' : /Time slots/.test(all) ? 'day' : 'other', text: all });
  if (isHealth && failHealth) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' });
  const content = isHealth
    ? '{"energy":"low","mood":"calm","symptoms":[],"sleepMin":420,"poops":[],"note":"有点困"}'
    : '{"items":[{"slot":"morning","text":"去图书馆","cost":0}]}';
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const c = db.characters.create({ name: '林晚', persona: 'x', dayOn: true, region: '成都' });
  const c2 = db.characters.create({ name: '阿岚', persona: 'y', dayOn: true });
  const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id });
  return { char: c.id, char2: c2.id, chat: chat.id };
});
charDate = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const day = await import('/src/system/day.js');
  return day.dateKey(db.characters.get(o.char));
}, ids);

// ---- 一、设置页 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/'); });
await page.waitForTimeout(700);
await page.locator('.list-item', { hasText: '和风天气' }).tap();
await page.waitForTimeout(500);
const field = label => page.locator('.field', { hasText: label }).locator('input').first();
await field('API Host').fill('https://qw.example.com/');
await field('API KEY').fill('bad');
await field('测试查询').fill('成都');
await page.locator('.btn', { hasText: '查询' }).tap();
await page.waitForTimeout(700);
let txt = await page.locator('.page').last().innerText();
ok('密钥不对：写明和风天气给的原因', /查询失败：Invalid API key/.test(txt), txt.slice(-300));
await field('API KEY').fill('good');
await page.locator('.btn', { hasText: '查询' }).tap();
await page.waitForTimeout(700);
txt = await page.locator('.page').last().innerText();
ok('密钥对了：查到今天的预报，密钥放在 X-QW-Api-Key 头里', /成都 小雨转阴 18~24°C/.test(txt) && qw.keys.includes('good'), txt.slice(-300));
await page.screenshot({ path: `${OUT}/weather-settings.png` });

// ---- 二、排日程时查天气 ----
const before = qw.lookup;
const made = await page.evaluate(async o => {
  const t = await import('/src/system/ai/tasks/day.js');
  const d = await t.makeToday(o.char);
  const d2 = await t.makeToday(o.char2);
  return { w: d.weather, items: d.items.map(x => x.text), w2: d2.weather };
}, ids);
ok('排日程：按「所在地区」查当天预报，存在当天记录上', made.w?.city === '成都' && made.w.tempMax === 24 && made.w.textDay === '小雨'
  && made.items.includes('去图书馆'), JSON.stringify(made));
ok('城市编号查过一次就记住，不再查', qw.lookup === before, `${before} -> ${qw.lookup}`);
ok('没填所在地区的角色：不查天气，日程照排', made.w2 === null, JSON.stringify(made.w2));
const dayAsk = asked.filter(a => a.kind === 'day');
ok('排日程的请求里写着当天天气', /## Weather\nWeather forecast for 成都 today \(\d{4}-\d\d-\d\d\): 小雨 by day, 阴 at night, 18 to 24°C, humidity 80%, precipitation 3\.2 mm, wind 东北风 force 1-3, UV index 2\./.test(dayAsk[0]?.text || ''),
  (dayAsk[0]?.text || '').slice(0, 600));
ok('没有天气的那一份，请求里不出现天气一节', dayAsk[1] && !/## Weather/.test(dayAsk[1].text));

const sys = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  const r = engine.buildChatSystem(db.chats.get(o.chat), db.characters.get(o.char), [], {});
  return `${r.system}\n${r.volatile || ''}`;
}, ids);
ok('聊天时「你今天」那一段里有天气', /\[你今天\][\s\S]*Weather forecast for 成都 today/.test(sys), (sys.match(/\[你今天\][\s\S]{0,300}/) || [''])[0]);

// ---- 三、「日常 - 今天」 ----
await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('daily', `/today/${o.char}`); }, ids);
await page.waitForTimeout(800);
txt = await page.locator('.page').last().innerText();
ok('今天那一页：显示天气与湿度、风', /成都 小雨转阴 18~24°C/.test(txt) && /湿度 80%/.test(txt) && /东北风 1-3 级/.test(txt), txt.slice(0, 400));
await page.screenshot({ path: `${OUT}/weather-today.png` });
rain = '中雨';
await page.locator('.list-item', { hasText: '成都' }).locator('.nav-text', { hasText: '刷新' }).tap();
await page.waitForTimeout(700);
txt = await page.locator('.page').last().innerText();
ok('点刷新：只重查天气，日程不动', /成都 中雨转阴/.test(txt) && /去图书馆/.test(txt), txt.slice(0, 400));

// ---- 四、健康：每天自动生成 ----
const off = await page.evaluate(async o => {
  const t = await import('/src/system/ai/tasks/health.js');
  const cost = await import('/src/system/ai/cost.js');
  const r = await t.ensureToday(o.char);
  return { r, listed: cost.EXTRA_CALLS.some(x => x.id === 'healthAuto'),
    on: cost.EXTRA_CALLS.find(x => x.id === 'healthAuto').on() };
}, ids);
ok('默认关：不生成，登记在用量账里且显示为未开启', off.r === null && off.listed && off.on === false && !asked.some(a => a.kind === 'health'), JSON.stringify(off));

await page.evaluate(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('health', `/char/${o.char}`); }, ids);
await page.waitForTimeout(800);
txt = await page.locator('.page').last().innerText();
ok('健康里那个角色的页面上有「每天自动生成」开关', /每天自动生成/.test(txt) && /已关闭/.test(txt), txt.slice(0, 400));
await page.locator('.list-item', { hasText: '每天自动生成' }).locator('.switch, input[type=checkbox]').first().tap();
await page.waitForTimeout(300);
const on = await page.evaluate(async o => (await import('/src/system/db/index.js')).characters.get(o.char).healthAuto, ids);
ok('打开开关：记在角色上', on === true);

const gen = await page.evaluate(async o => {
  const t = await import('/src/system/ai/tasks/health.js');
  const h = await import('/src/system/health.js');
  await t.ensureToday(o.char);
  await t.ensureToday(o.char);
  return h.dayOf(o.char, h.dateKey());
}, ids);
ok('开了：生成今天的一份，同一天只生成一次', gen.energy === 'low' && gen.sleepMin === 420 && gen.source === 'ai'
  && asked.filter(a => a.kind === 'health').length === 1, JSON.stringify(gen));
await page.waitForTimeout(300);
txt = await page.locator('.page').last().innerText();
ok('页面上看得到生成的那一份', /当前这一份由模型按人设生成/.test(txt));

// 已经手填了的一天不碰
const kept = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const h = await import('/src/system/health.js');
  const t = await import('/src/system/ai/tasks/health.js');
  db.characters.update(o.char2, { healthAuto: true });
  h.set(o.char2, h.dateKey(), { note: '手写的', source: 'manual' });
  await t.ensureToday(o.char2);
  return h.dayOf(o.char2, h.dateKey()).note;
}, ids);
ok('当天已有手填内容：不生成，不覆盖', kept === '手写的' && asked.filter(a => a.kind === 'health').length === 1, kept);

// 失败只试一次，写明原因
failHealth = true;
const failed = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/ai/tasks/health.js');
  const c = db.characters.create({ name: '小周', persona: 'z', healthAuto: true });
  await t.ensureToday(c.id);
  await t.ensureToday(c.id);
  return db.characters.get(c.id);
});
ok('生成失败：当天不反复重试，失败原因记下', asked.filter(a => a.kind === 'health').length === 2 && /boom|500/.test(failed.healthAutoError || ''), JSON.stringify(failed.healthAutoError));
failHealth = false;

// 全局定时器：不聊天也填上
const ticked = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const h = await import('/src/system/health.js');
  const c = db.characters.create({ name: '老陈', persona: 'w', healthAuto: true });
  const p = await import('/src/system/ai/proactive.js');
  await p.tick();
  for (let i = 0; i < 30 && !h.dayOf(c.id, h.dateKey()).energy; i++) await new Promise(r => setTimeout(r, 100));
  return h.dayOf(c.id, h.dateKey()).energy;
});
ok('不聊天：全局定时器每天也会填上', ticked === 'low', ticked);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
