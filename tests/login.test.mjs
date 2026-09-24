// 登录：页面 -> 真的 worker/netease.js（在 Node 里跑，KV 换成内存）。
//
//   一、服务端没开账号功能：直接进门
//   二、开了：先到登录页；密码错写明；对了进门；设置里有账号名
//   三、重开：凭证有效，不再要登录
//   四、同一账号又在两台设备登录：本机重开时退出，登录页写明原因
//   五、离线：有凭证照常进；没凭证又不知道服务端开没开，停在登录页并给「重新连接」
//   六、网易云转发带着凭证，没凭证被拒
//   七、管理页：管理员密码进入、手动添加一个、批量添加（一行一个名字）、停用
//   八、设置里自己改密码
//   九、设置里退出登录；用初始密码登录时可以「以后再说」
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const SVC = 'https://acc.example.com';
const worker = (await import('../worker/netease.js')).default;

function fakeKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async put(k, v, o = {}) { m.set(k, { v: String(v), meta: o.metadata || null }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: m.get(name).meta })), list_complete: true };
    },
  };
}
const ADMIN = 'the-admin-password-123';
const ON = { ACCOUNTS: fakeKV(), ADMIN_PASSWORD: ADMIN };
let env = {};                    // 先是没开
let down = false;                // 账号服务连不上
const proxied = [];              // 转发到网易云的请求

// Worker 往网易云发的请求：给一个搜索结果
globalThis.fetch = async url => {
  proxied.push(String(url));
  return new Response(JSON.stringify({ code: 200, result: { songs: [{ id: 1, name: '晴天', ar: [{ name: '周杰伦' }], al: { picUrl: '' }, dt: 1000 }] } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const direct = async (path, body) => {
  const r = await worker.fetch(new Request(`${SVC}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
  return r.json();
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route('**/src/site.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript',
  body: `export const SITE = ${JSON.stringify({ neteaseApi: '', neteaseRealIP: '', neteaseWorker: SVC, accounts: SVC })};` }));
await ctx.route(`${SVC}/**`, async route => {
  if (down) return route.abort('connectionrefused');
  const q = route.request();
  const res = await worker.fetch(new Request(q.url(), {
    method: q.method(), headers: q.headers(), body: ['GET', 'OPTIONS'].includes(q.method()) ? undefined : q.postData(),
  }), env);
  return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
});
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

const open = async () => {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
};
const onLogin = async () => (await page.locator('.login').count()) === 1;
const booted = async () => (await page.locator('.lock, .home, .statusbar, .app-root, .root').count()) > 0 && !(await onLogin());
const doLogin = async (name, pw) => {
  await page.getByPlaceholder('账号').fill(name);
  await page.getByPlaceholder('密码').fill(pw);
  await page.locator('.login .btn').click();
  await page.waitForTimeout(1200);
};

// ---- 一 ----
await open();
ok('服务端没开账号功能：直接进门', await booted() && !(await onLogin()));

// ---- 二 ----
env = ON;
const acct = await direct('/auth/admin', { password: ADMIN, op: 'create', name: '小林' });
await page.evaluate(() => localStorage.removeItem('eira-auth-off'));
await open();
ok('开了：先到登录页', await onLogin());
await page.screenshot({ path: `${OUT}/login-page.png` });
ok('登录页写明不开放注册', /不开放注册/.test(await page.locator('.login').innerText()));
await doLogin('小林', 'wrong-password');
ok('密码错：写明，不进门', await onLogin() && /账号或密码不正确/.test(await page.locator('.login').innerText()));
ok('新账号给的是统一初始密码', acct.password === 'Eira2026', acct.password);
await doLogin('小林', 'Eira2026');
let t2 = await page.locator('.login').innerText();
ok('用初始密码登录：接着要求修改初始密码，可以跳过', /修改初始密码/.test(t2) && /以后再说/.test(t2), t2.slice(0, 200));
await page.screenshot({ path: `${OUT}/login-initial.png` });
await page.getByPlaceholder('新密码（至少 6 位）').fill('lin-pass-1');
await page.getByPlaceholder('再输入一次').fill('lin-pass-2');
await page.locator('.login .btn').click();
await page.waitForTimeout(800);
ok('两次不一致：写明', /两次输入的新密码不一致/.test(await page.locator('.login').innerText()));
await page.getByPlaceholder('再输入一次').fill('lin-pass-1');
await page.locator('.login .btn').click();
await page.waitForTimeout(1200);
ok('改好：进门', await booted());
const lin = 'lin-pass-1';
ok('服务端：初始密码不能再用，新密码能用',
  !(await direct('/auth/login', { name: '小林', password: 'Eira2026', device: 'z' })).token
  && (await direct('/auth/login', { name: '小林', password: lin, device: 'z' })).initial === false);
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/'); });
await page.waitForTimeout(700);
ok('设置里有登录的账号名', /小林/.test(await page.locator('.page').last().innerText()));

// ---- 三 ----
await open();
ok('重开：凭证有效，不再要登录', await booted());

// ---- 六（在凭证有效时先测转发）----
proxied.length = 0;
const songs = await page.evaluate(async () => (await import('/src/system/netease.js')).search('晴天', 1).catch(e => e.message));
ok('网易云转发带着凭证，照常搜到', Array.isArray(songs) && songs[0]?.title === '晴天' && proxied.length > 0, JSON.stringify(songs));
const bare = await worker.fetch(new Request(`${SVC}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://interface.music.163.com/eapi/x', body: '' }) }), env);
ok('不带凭证：转发被拒', bare.status === 401);

// ---- 四 ----
await direct('/auth/login', { name: '小林', password: lin, device: 'other-1' });
await direct('/auth/login', { name: '小林', password: lin, device: 'other-2' });
await open();
const txt4 = await page.locator('#app').innerText();
ok('在另两台设备登录后：本机退出，登录页写明原因', await onLogin() && /其他设备登录/.test(txt4), txt4.slice(0, 200));
await doLogin('小林', lin);
ok('重新登录进门', await booted());

// ---- 五 ----
down = true;
await open();
ok('离线且有凭证：照常进门', await booted());
await page.evaluate(() => { localStorage.removeItem('eira-auth'); localStorage.removeItem('eira-auth-off'); });
await open();
ok('离线、没凭证、不知道服务端开没开：停在登录页，给「重新连接」',
  await onLogin() && /连接不上/.test(await page.locator('.login').innerText()) && await page.locator('.login-retry').count() === 1);
down = false;
await page.locator('.login-retry').click();
await page.waitForTimeout(1600);
ok('恢复网络后点「重新连接」：到正常的登录页', await onLogin() && !/连接不上/.test(await page.locator('.login').innerText()));
await doLogin('小林', lin);

// ---- 七、管理页 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/signin/admin'); });
await page.waitForTimeout(700);
await page.getByPlaceholder('管理员密码').fill('not-it');
await page.locator('.btn', { hasText: '进入' }).click();
await page.waitForTimeout(700);
ok('管理员密码错：进不去', await page.getByPlaceholder('管理员密码').count() === 1);
await page.getByPlaceholder('管理员密码').fill(ADMIN);
await page.locator('.btn', { hasText: '进入' }).click();
await page.waitForTimeout(900);
ok('管理员密码对：列出账号', /小林/.test(await page.locator('.page').last().innerText()));
await page.locator('.btn', { hasText: '添加账号' }).click();
await page.waitForTimeout(400);
ok('添加：不填账号名时按钮不可用', await page.locator('.sheet .btn', { hasText: '添加' }).last().isDisabled());
await page.locator('.sheet').last().getByRole('textbox').first().fill('阿岚');
await page.locator('.sheet .btn', { hasText: /^添加$/ }).click();
await page.waitForTimeout(1200);
ok('添加一个：列表里有它，标着初始密码', /阿岚/.test(await page.locator('.page').last().innerText())
  && /初始密码/.test(await page.locator('.list-item', { hasText: '阿岚' }).first().innerText()));
const login2 = await direct('/auth/login', { name: '阿岚', password: 'Eira2026', device: 'x' });
ok('添加的账号用初始密码能登录', !!login2.token && login2.initial === true);
await page.locator('.btn', { hasText: '批量添加' }).click();
await page.waitForTimeout(300);
await page.locator('.sheet').last().locator('textarea').fill('甲\n乙\n\n乙\n小林');
await page.waitForTimeout(200);
await page.locator('.sheet .btn', { hasText: '添加 3 个' }).click();
for (let i = 0; i < 30 && !(await page.locator('.sheet', { hasText: '已添加' }).count()); i++) await page.waitForTimeout(200);
const rep = await page.locator('.sheet').last().innerText().catch(() => '');
ok('批量添加：一行一个，空行与重复跳过；已存在的列出来', /已添加 2 个账号/.test(rep) && /甲/.test(rep) && /乙/.test(rep)
  && /小林：这个账号名已经有了/.test(rep) && /初始密码：Eira2026/.test(rep), rep);
await page.screenshot({ path: `${OUT}/login-admin.png` });
await page.locator('.sheet .btn', { hasText: '关闭' }).click();
await page.waitForTimeout(300);
await page.locator('.list-item', { hasText: '阿岚' }).first().click();
await page.waitForTimeout(300);
await page.locator('.sheet .list-item', { hasText: '停用' }).click();
await page.waitForTimeout(300);
await page.locator('.modal .modal-btn', { hasText: '确定' }).click();
await page.waitForTimeout(900);
const chk = await direct('/auth/check', { token: login2.token });
ok('停用：该账号已登录的设备检查不通过', /停用/.test(chk.error || ''), JSON.stringify(chk));

// ---- 八、设置里改密码 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('settings', '/signin'); });
await page.waitForTimeout(600);
await page.locator('.list-item', { hasText: '修改密码' }).click();
await page.waitForTimeout(300);
const boxes = page.locator('.sheet').last().locator('input');
await boxes.nth(0).fill(lin);
await boxes.nth(1).fill('lin-pass-9');
await boxes.nth(2).fill('lin-pass-9');
await page.locator('.sheet .btn', { hasText: /^修改$/ }).click();
await page.waitForTimeout(1200);
ok('设置里改密码：新密码能用', !!(await direct('/auth/login', { name: '小林', password: 'lin-pass-9', device: 'y' })).token);

// ---- 九、退出 ----
await page.locator('.list-item', { hasText: '退出登录' }).click();
await page.waitForTimeout(300);
await page.locator('.modal .modal-btn', { hasText: '确定' }).click();
await page.waitForTimeout(1800);
ok('退出登录：回到登录页', await onLogin());
await direct('/auth/admin', { password: ADMIN, op: 'disable', name: '阿岚', on: false });
await doLogin('阿岚', 'Eira2026');
await page.locator('.login-retry', { hasText: '以后再说' }).click();
await page.waitForTimeout(1500);
ok('用初始密码登录可以「以后再说」直接进门', await booted());
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/signin'); });
await page.waitForTimeout(600);
ok('没改过的：设置里提示仍是初始密码', /当前仍是初始密码/.test(await page.locator('.page').last().innerText()));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
