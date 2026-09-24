// 网易云走本站 Cloudflare Worker 的整条路：页面里加密拼装（src/system/ne/） -> Worker（worker/netease.js，
// 在 Node 里真跑） -> 假的网易云。假网易云按已知的 eapi 密钥解开请求，核对网址与参数。
//
// 覆盖：用户什么都不填即可用；游客身份注册一次、之后带着它；每台设备固定一个国内 IP 且重开页面不变；
// 设置页的逐项测试全部通过；扫码登录拿到 cookie、之后的请求带着它；Worker 不通时写明是本站的问题
import { createDecipheriv } from 'node:crypto';
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const WORKER = 'https://ne-worker.example.com';
const worker = (await import('../worker/netease.js')).default;

// eapi 的请求体解开是「/api/...-36cd479b6b5-{json}-36cd479b6b5-md5」
function openEapi(form) {
  const hex = new URLSearchParams(form).get('params');
  const d = createDecipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null);
  const text = Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8');
  const [uri, json] = text.split('-36cd479b6b5-');
  return { uri, data: JSON.parse(json) };
}

// ---- 假网易云 ----
const seen = [];          // 每一个打到网易云的请求
let qrState = 801;
let anonCount = 0;
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  const h = new Headers(init.headers);
  const rec = { host: u.hostname, path: u.pathname, cookie: h.get('cookie') || '', ip: h.get('x-real-ip') || '',
    ua: h.get('user-agent') || '', form: String(init.body || '') };
  if (u.pathname.startsWith('/eapi/')) Object.assign(rec, openEapi(rec.form));
  seen.push(rec);
  const out = new Headers({ 'Content-Type': 'application/json' });
  const J = (o, cookies = []) => {
    cookies.forEach(c => out.append('Set-Cookie', `${c}; Max-Age=100; Domain=.music.163.com; Path=/`));
    return new Response(JSON.stringify(o), { status: 200, headers: out });
  };
  switch (u.pathname) {
    case '/weapi/register/anonimous': anonCount++; return J({ code: 200, userId: 1 }, ['MUSIC_A=anon-token']);
    case '/eapi/login/qrcode/unikey': return J({ code: 200, unikey: 'QRKEY1' });
    case '/eapi/login/qrcode/client/login':
      if (rec.data.key !== 'QRKEY1') return J({ code: 8605, message: '无效的 key' });
      return qrState === 803 ? J({ code: 803, message: '授权登陆成功' }, ['MUSIC_U=user-token', '__csrf=csrf1'])
        : J({ code: qrState, message: '等待扫码' });
    case '/weapi/nuser/account/get':
      return /MUSIC_U=user-token/.test(rec.cookie) ? J({ code: 200, profile: { userId: 9, nickname: '转发测试号' } })
        : J({ code: 301, profile: null });
    case '/eapi/cloudsearch/pc':
      return J({ code: 200, result: { songs: [{ id: 186016, name: `搜到：${rec.data.s}`, ar: [{ name: '周杰伦' }], al: { picUrl: 'http://p1.music.126.net/x.jpg' }, dt: 269000 }] } });
    case '/eapi/song/enhance/player/url/v1':
      return J({ code: 200, data: [{ id: 347230, url: 'https://m7.music.126.net/a.mp3' }] });
    default: return J({ code: 404, msg: `假网易云没有 ${u.pathname}` });
  }
};

let workerDown = false;
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/src/site.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: `export const SITE = ${JSON.stringify({ neteaseApi: '', neteaseRealIP: '', neteaseWorker: WORKER })};` }));
  // 发给 Worker 的请求交给 Node 里真的那份 worker/netease.js
  await ctx.route(`${WORKER}/**`, async route => {
    if (workerDown) return route.abort('connectionrefused');
    const q = route.request();
    const res = await worker.fetch(new Request(q.url(), {
      method: q.method(), headers: q.headers(), body: ['GET', 'OPTIONS'].includes(q.method()) ? undefined : q.postData(),
    }));
    return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
  const page = await ctx.newPage();
  await page.addInitScript(b => { window.BASE = b; }, BASE);
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  return { ctx, page };
};
const settle = async (page, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(200); }
  return false;
};
const deviceOf = page => page.evaluate(async () => (await import('/src/system/ai/services.js')).neteaseConfig().device || null);

// ---- 一、什么都不填：搜歌 ----
const { ctx, page } = await open();
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const res = await page.evaluate(async () => (await import('/src/system/netease.js')).search('晴天', 5));
ok('什么都不填：搜歌经 Worker 直达网易云并拿到结果', res[0]?.title === '搜到：晴天', JSON.stringify(res[0]));
const search = seen.find(s => s.path === '/eapi/cloudsearch/pc');
ok('eapi 解得开，里面的网址与参数和原项目一致', search?.uri === '/api/cloudsearch/pc' && search.data.s === '晴天'
  && search.data.total === true && search.data.e_r === false && search.data.header?.os === 'pc', JSON.stringify(search?.data));
ok('请求发往 interface.music.163.com，UA 是客户端的', search?.host === 'interface.music.163.com' && /NeteaseMusic/.test(search.ua));
ok('先注册了一次游客身份，之后的请求带着它', anonCount === 1 && /MUSIC_A=anon-token/.test(search?.cookie || ''), `${anonCount} ${search?.cookie}`);
ok('封面的 http 换成 https', res[0]?.cover === 'https://p1.music.126.net/x.jpg', res[0]?.cover);
let dev = await deviceOf(page);
ok('设备号、固定的国内 IP、游客身份都记下了', dev?.deviceId?.length === 52 && /^116\.(25|7[6-9]|8\d|9[0-4])\.\d+\.\d+$/.test(dev.ip) && dev.anon === 'anon-token', JSON.stringify(dev));
ok('请求带着这台设备的那个 IP', seen.length > 0 && seen.every(s => s.ip === dev.ip), JSON.stringify(seen.map(s => s.ip)));

// ---- 二、重开页面：还是同一台设备 ----
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const before = seen.length;
await page.evaluate(async () => (await import('/src/system/netease.js')).search('七里香', 5));
const dev2 = await deviceOf(page);
ok('重开后设备号与 IP 不变，不再注册游客身份', dev2?.deviceId === dev.deviceId && dev2.ip === dev.ip && anonCount === 1);
ok('重开后的请求还是那个 IP', seen.slice(before).every(s => s.ip === dev.ip));

// ---- 三、设置页：写明用的是本站的转发服务，逐项测试 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/music'); });
await page.waitForTimeout(800);
let txt = await page.locator('.page').last().innerText();
ok('设置页写明本站已提供音乐转发服务、当前在用', /本站已提供音乐转发服务/.test(txt) && /当前使用本站提供的接口/.test(txt), txt.slice(0, 300));
ok('输入框的灰字不是 Worker 地址', await page.locator('.field', { hasText: '接口地址' }).locator('input').getAttribute('placeholder') !== WORKER);
ok('realIP 的灰字是这台设备的 IP', await page.locator('.field', { hasText: '来源地址' }).locator('input').getAttribute('placeholder') === dev.ip);
await page.locator('.list-item', { hasText: '测试这个地址' }).tap();
await settle(page, async () => /各项均可用|部分项目|用不了|无法访问/.test(await page.locator('.page').last().innerText()), 15000);
txt = await page.locator('.page').last().innerText();
ok('逐项测试：各项均可用', /各项均可用/.test(txt), txt.slice(0, 900));
ok('七项都列出来了', ['连得上', '搜歌', '取登录用的 key', '生成二维码', '轮询扫码状态', '按次传 cookie', '取播放地址'].every(l => txt.includes(l)));
ok('没有「公共实例由他人运行」那句', !/公共实例由他人运行/.test(txt));
await page.screenshot({ path: `${OUT}/neworker-probe.png`, fullPage: true });

// ---- 四、扫码登录 ----
await page.locator('.btn', { hasText: '获取二维码' }).tap();
ok('二维码在本机生成出来了', await settle(page, async () => (await page.locator('.qr-img').count()) === 1));
const src = await page.locator('.qr-img').getAttribute('src');
ok('是一张 data: 图', /^data:image\//.test(src || ''), (src || '').slice(0, 40));
qrState = 803;
const logged = await settle(page, async () => /转发测试号/.test(await page.locator('.page').last().innerText()), 10000);
ok('扫码确认后登录成功，账号名显示出来', logged);
const cfg = await page.evaluate(async () => (await import('/src/system/ai/services.js')).neteaseConfig());
ok('cookie 存下了，含 MUSIC_U 与 __csrf', /MUSIC_U=user-token/.test(cfg.cookie) && /__csrf=csrf1/.test(cfg.cookie), cfg.cookie);
ok('Set-Cookie 里的 Domain 去掉了', !/Domain=/i.test(cfg.cookie), cfg.cookie);
const n0 = seen.length;
await page.evaluate(async () => { const m = await import('/src/system/netease.js'); return m.search('稻香', 3); });
const after = seen.slice(n0).find(s => s.path === '/eapi/cloudsearch/pc');
ok('登录后的请求带着 MUSIC_U，不再带游客身份', /MUSIC_U=user-token/.test(after?.cookie || '') && !/MUSIC_A/.test(after?.cookie || ''), after?.cookie);
await page.screenshot({ path: `${OUT}/neworker-login.png` });

// ---- 五、Worker 不通 ----
workerDown = true;
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.pop(); await new Promise(r => setTimeout(r, 300)); n.push('/music'); });
await page.waitForTimeout(800);
await page.locator('.list-item', { hasText: '测试这个地址' }).tap();
await settle(page, async () => /无法访问|各项均可用/.test(await page.locator('.page').last().innerText()), 10000);
txt = await page.locator('.page').last().innerText();
ok('Worker 不通：写明是本站的服务无法访问、请联系运营方', /本站的音乐转发服务当前无法访问/.test(txt) && /联系本站的运营方/.test(txt), txt.slice(0, 600));
const err = await page.evaluate(async () => {
  try { await (await import('/src/system/netease.js')).search('晴天', 1); return ''; } catch (e) { return e.message; }
});
ok('Worker 不通时搜歌报出可读的原因', /音乐转发服务/.test(err), err);
await ctx.close();

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
