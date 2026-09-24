// 网易云账号登录（没有手机扫码的人用）：短信验证码、手机号或邮箱加密码。
// 登成了 cookie 直接存上，不经人手；密码只发 MD5、走 POST 表单，不进网址；
// 验证码错、密码登录被要求行为验证（8821）都写明怎么办；角色卡上登的是角色自己的号
import { createHash } from 'node:crypto';
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const seen = [];
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex');
await ctx.route('**/ne.example.com/**', route => {
  const req = route.request();
  const u = new URL(req.url());
  const form = Object.fromEntries(new URLSearchParams(req.postData() || ''));
  seen.push({ m: req.method(), path: u.pathname, url: req.url(), form });
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/captcha/sent') return J({ code: 200, data: true });
  if (u.pathname === '/login/cellphone') {
    if (form.captcha) return form.captcha === '1234'
      ? J({ code: 200, cookie: 'MUSIC_U=sms-cookie; __csrf=x', profile: { nickname: '短信登的' } })
      : J({ code: 503, message: '验证码错误' });
    return J({ code: 8821, message: '需要行为验证码验证' });
  }
  if (u.pathname === '/login') {
    return form.md5_password === md5('我的密码123')
      ? J({ code: 200, cookie: 'MUSIC_U=mail-cookie', profile: { nickname: '邮箱登的' } })
      : J({ code: 502, message: '密码错误' });
  }
  if (u.pathname === '/user/account') {
    const ck = u.searchParams.get('cookie') || '';
    const nick = /sms-cookie/.test(ck) ? '短信登的' : /mail-cookie/.test(ck) ? '邮箱登的' : '';
    return J({ code: 200, profile: nick ? { userId: 1, nickname: nick } : null });
  }
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
const box = page.locator('.acct-login').first();
let txt = await page.locator('.page').last().innerText();
ok('设置里扫码下面多了账号登录，cookie 粘贴放在最后', /没有手机扫码时，用账号登录/.test(txt) && /以上方式都不可用时/.test(txt)
  && txt.indexOf('用账号登录') < txt.indexOf('或者直接填写 cookie'), txt.slice(0, 400));

// ---- 短信验证码 ----
await box.locator('input[placeholder="手机号"]').fill('138 0013 8000');
await box.locator('.btn', { hasText: '发送验证码' }).tap();
await page.waitForTimeout(500);
const sent = seen.find(x => x.path === '/captcha/sent');
ok('发验证码：POST，手机号去掉空格，区号 86', sent?.m === 'POST' && sent.form.phone === '13800138000' && sent.form.ctcode === '86', JSON.stringify(sent));
const again = await box.locator('.btn', { hasText: /秒后重发/ }).first().innerText().catch(() => '');
ok('发完进入倒计时，不能连着再发', /\d+ 秒后重发/.test(again) && await box.locator('.btn', { hasText: /秒后重发/ }).isDisabled(), again);
await page.screenshot({ path: `${OUT}/nelogin-sms.png` });
await box.locator('input[placeholder="验证码"]').fill('9999');
await box.locator('.btn', { hasText: /^登录$/ }).tap();
await page.waitForTimeout(500);
ok('验证码错：写明不对或过期，没有存任何东西', /验证码不对，或者已经过期/.test(await box.innerText())
  && !(await page.evaluate(async () => (await import('/src/system/ai/services.js')).neteaseConfig().cookie)));
await box.locator('input[placeholder="验证码"]').fill('1234');
await box.locator('.btn', { hasText: /^登录$/ }).tap();
await page.waitForTimeout(800);
let cfg = await page.evaluate(async () => (await import('/src/system/ai/services.js')).neteaseConfig());
ok('验证码对：cookie 直接存上，账号名也取到了', cfg.cookie === 'MUSIC_U=sms-cookie; __csrf=x' && cfg.nickname === '短信登的', JSON.stringify(cfg));
txt = await page.locator('.page').last().innerText();
ok('界面换成已登录', /短信登的/.test(txt) && /退出/.test(txt), txt.slice(0, 300));

// ---- 密码（角色卡上，登角色自己的号） ----
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/edit/${id}`); }, charId);
await page.waitForTimeout(900);
const cbox = page.locator('.acct-login').first();
await cbox.locator('.seg-item', { hasText: '密码' }).tap();
await page.waitForTimeout(200);
txt = await cbox.innerText();
ok('密码那一栏写明：经过接口地址、先转 MD5、只在自己部署的接口上用、不保存', /MD5/.test(txt) && /自己部署的接口/.test(txt) && /不保存/.test(txt), txt);
seen.length = 0;
await cbox.locator('input[placeholder="手机号或邮箱"]').fill('13800138000');
await cbox.locator('input[type=password]').fill('我的密码123');
await cbox.locator('.btn', { hasText: /^登录$/ }).tap();
await page.waitForTimeout(600);
ok('手机号密码被要求行为验证（8821）：写明改用短信、扫码或粘贴', /行为验证/.test(await cbox.innerText()) && /短信验证码/.test(await cbox.innerText()));
const p1 = seen.find(x => x.path === '/login/cellphone');
ok('密码只发 MD5，走 POST 表单，网址里没有', p1?.m === 'POST' && p1.form.md5_password === md5('我的密码123')
  && !p1.form.password && !/password|%E6%88%91/.test(p1.url) && !JSON.stringify(p1.form).includes('我的密码'), JSON.stringify(p1));
await cbox.locator('input[placeholder="手机号或邮箱"]').fill('me@163.com');
await cbox.locator('.btn', { hasText: /^登录$/ }).tap();
await page.waitForTimeout(800);
const ch = await page.evaluate(async id => (await import('/src/system/db/index.js')).characters.get(id), charId);
cfg = await page.evaluate(async () => (await import('/src/system/ai/services.js')).neteaseConfig());
ok('邮箱加密码走 /login，登的是角色自己的号，用户自己的号不动', ch.neteaseCookie === 'MUSIC_U=mail-cookie' && ch.neteaseNick === '邮箱登的'
  && cfg.cookie === 'MUSIC_U=sms-cookie; __csrf=x' && seen.some(x => x.path === '/login' && x.form.email === 'me@163.com'), JSON.stringify({ ch: ch.neteaseCookie, me: cfg.cookie }));
// 应用的数据在 IndexedDB 里（设置、角色都在），localStorage 也一并查
const stored = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  return JSON.stringify(localStorage) + JSON.stringify(db.settings.get()) + JSON.stringify(db.characters.all());
});
ok('密码没有存在任何地方', !stored.includes('我的密码') && !stored.includes(md5('我的密码123')));
await page.screenshot({ path: `${OUT}/nelogin-char.png` });

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
