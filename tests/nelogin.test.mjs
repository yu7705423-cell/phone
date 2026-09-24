// 网易云登录不用先找 cookie：接口的出口 IP 被风控时（-462），扫码那几步自动换用游客身份
// （/register/anonimous），从取 key、生成二维码到查扫码状态用同一个身份，扫完 cookie 直接存上。
// 游客身份也过不去时写明该填 realIP。「测试这个地址」的结果和真正登录时一致。
// 短信验证码同样自动换游客身份；不再有密码登录
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const seen = [];
let guestWorks = true;
let checks = 0;
await ctx.route('**/ne.example.com/**', route => {
  const u = new URL(route.request().url());
  const ck = u.searchParams.get('cookie') || '';
  seen.push({ path: u.pathname, ck });
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  const guest = /MUSIC_A=guest/.test(ck);
  if (u.pathname === '/register/anonimous') return J({ code: 200, cookie: 'MUSIC_A=guest1; NMTID=x' });
  if (u.pathname === '/user/account') {
    return J({ code: 200, profile: /MUSIC_U=scanned/.test(ck) ? { userId: 7, nickname: '扫码登的' }
      : /MUSIC_U=sms/.test(ck) ? { userId: 8, nickname: '短信登的' } : null });
  }
  // 下面这几个：不带身份一律被风控拦下；带游客身份放行（除非这一轮连游客也不放）
  if (!guest || !guestWorks) return J({ code: -462, message: '需要行为验证码验证' });
  if (u.pathname === '/login/qr/key') return J({ code: 200, data: { unikey: 'k1' } });
  if (u.pathname === '/login/qr/create') return J({ code: 200, data: { qrimg: 'data:image/png;base64,iVBORw0KGgo=', qrurl: 'x' } });
  if (u.pathname === '/login/qr/check') {
    checks += 1;
    return J(checks < 2 ? { code: 801, message: '等待扫码' } : checks < 3 ? { code: 802 } : { code: 803, cookie: 'MUSIC_U=scanned; __csrf=y' });
  }
  if (u.pathname === '/captcha/sent') return J({ code: 200, data: true });
  if (u.pathname === '/login/cellphone') {
    return u.searchParams.get('captcha') === '1234' ? J({ code: 200, cookie: 'MUSIC_U=sms' }) : J({ code: 503 });
  }
  if (u.pathname === '/search' || u.pathname === '/cloudsearch') return J({ code: 200, result: { songs: [] } });
  return J({ code: 200 });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const charId = await page.evaluate(async () => {
  (await import('/src/system/ai/services.js')).setNetease({ baseUrl: 'https://ne.example.com' });
  const db = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '林晚', persona: 'x' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/music');
  return c.id;
});
await page.waitForTimeout(900);

// ---- 一、没有任何 cookie，直接扫码 ----
let txt = await page.locator('.page').last().innerText();
ok('界面上没有密码登录', !/手机号或邮箱|密码/.test(txt.replace(/密码或/g, '')), txt.slice(0, 500));
await page.locator('.btn', { hasText: '获取二维码' }).tap();
await page.waitForTimeout(800);
ok('不用先粘 cookie：直接出二维码', await page.locator('.qr-img').count() === 1);
const firstKey = seen.findIndex(x => x.path === '/login/qr/key');
ok('先不带身份问一次，被拦下后要了游客身份，再带着它重取', seen[firstKey]?.ck === ''
  && seen.some(x => x.path === '/register/anonimous')
  && seen.some(x => x.path === '/login/qr/key' && /MUSIC_A=guest1/.test(x.ck))
  && seen.some(x => x.path === '/login/qr/create' && /MUSIC_A=guest1/.test(x.ck)), JSON.stringify(seen.slice(0, 5)));
await page.screenshot({ path: `${OUT}/nelogin-qr.png` });
// 每三秒问一次：先 801，再 802，最后 803
// waitForFunction 不能用 async 判断（返回的 Promise 本身就算真），自己轮询
for (let i = 0; i < 30; i++) {
  if (await page.evaluate(async () => !!(await import('/src/system/ai/services.js')).neteaseConfig().cookie)) break;
  await page.waitForTimeout(500);
}
let cfg = await page.evaluate(async () => (await import('/src/system/ai/services.js')).neteaseConfig());
ok('扫完：cookie 自动存上，账号名也取到了', cfg.cookie === 'MUSIC_U=scanned; __csrf=y' && cfg.nickname === '扫码登的', JSON.stringify(cfg));
ok('查扫码状态也一直用同一个游客身份', seen.filter(x => x.path === '/login/qr/check').every(x => /MUSIC_A=guest1/.test(x.ck)), JSON.stringify(seen.filter(x => x.path === '/login/qr/check')));
const stored = await page.evaluate(async () => JSON.stringify((await import('/src/system/db/index.js')).settings.get()));
ok('游客身份不落库（只在内存里）', !/MUSIC_A=guest/.test(stored));

// ---- 二、游客身份也过不去：写明该填 realIP ----
await page.evaluate(async () => (await import('/src/system/netease.js')).logout());
guestWorks = false;
await page.waitForTimeout(400);
await page.locator('.btn', { hasText: '获取二维码' }).tap();
await page.waitForTimeout(800);
txt = await page.locator('.qr-box').innerText();
ok('游客身份也被拦：写明是出口 IP 的问题、该填 realIP', /出口 IP/.test(txt) && /realIP/.test(txt) && /游客身份/.test(txt), txt);

// ---- 三、「测试这个地址」和真正登录时一致 ----
guestWorks = true;
await page.locator('.list-item', { hasText: '测试这个地址' }).tap();
await page.waitForFunction(() => /取播放地址/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(500);
txt = await page.locator('.page').last().innerText();
ok('测试：扫码那两步写明换用游客身份后可用', /换用游客身份后拿得到/.test(txt) && /换用游客身份后拿得到图/.test(txt), txt.slice(txt.indexOf('取登录用的 key'), txt.indexOf('取登录用的 key') + 200));

// ---- 四、短信验证码（角色卡上，登角色自己的号） ----
seen.length = 0;
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/edit/${id}`); }, charId);
await page.waitForTimeout(900);
const box = page.locator('.acct-login').first();
await box.locator('input[placeholder="手机号"]').fill('13800138000');
await box.locator('.btn', { hasText: '发送验证码' }).tap();
await page.waitForTimeout(500);
ok('发验证码：被拦下后自动换游客身份', seen.some(x => x.path === '/captcha/sent' && /MUSIC_A=guest/.test(x.ck)), JSON.stringify(seen));
await box.locator('input[placeholder="验证码"]').fill('1234');
await box.locator('.btn', { hasText: /^登录$/ }).tap();
await page.waitForTimeout(800);
const ch = await page.evaluate(async id => (await import('/src/system/db/index.js')).characters.get(id), charId);
ok('登录也用同一个游客身份，登的是角色自己的号', ch.neteaseCookie === 'MUSIC_U=sms' && ch.neteaseNick === '短信登的'
  && seen.some(x => x.path === '/login/cellphone' && /MUSIC_A=guest/.test(x.ck)), JSON.stringify(ch.neteaseCookie));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
