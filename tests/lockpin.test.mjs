// 本机锁屏密码（system/pinlock.js，ARCHITECTURE 4.231）
//
//   一、设置里设一个四位密码：输两遍；库里存的不是原文
//   二、重开：先停在锁屏；导航被别处推去了某个 app 也露不出来；输错写明，输对进门，落在那个 app 里
//   三、连错五次要等，键盘不接
//   四、忘记密码：账号密码错了不放行；对了清掉锁屏密码并进门
//   五、设置里关掉：先核对旧密码
import { EXE, chromium } from './_env.mjs';
import { BASE } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

// 账号服务：真的 worker/netease.js，KV 放内存
const SVC = 'https://acc.example.com';
const worker = (await import('../worker/netease.js')).default;
const m = new Map();
const kv = {
  async get(k) { return m.has(k) ? m.get(k).v : null; },
  async put(k, v, o = {}) { m.set(k, { v: String(v), meta: o.metadata || null }); },
  async delete(k) { m.delete(k); },
  async list({ prefix = '' } = {}) {
    return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: m.get(name).meta })), list_complete: true };
  },
};
const ADMIN = 'the-admin-password-123';
const env = { ACCOUNTS: kv, ADMIN_PASSWORD: ADMIN };

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route('**/src/site.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript',
  body: `export const SITE = ${JSON.stringify({ neteaseApi: '', neteaseRealIP: '', neteaseWorker: '', accounts: SVC })};` }));
await ctx.route(`${SVC}/**`, async route => {
  const q = route.request();
  const res = await worker.fetch(new Request(q.url(), {
    method: q.method(), headers: q.headers(), body: ['GET', 'OPTIONS'].includes(q.method()) ? undefined : q.postData(),
  }), env);
  return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));

const boot = async () => { await page.goto(`${BASE}/index.html`); await page.waitForTimeout(2200); };
const keys = async code => {
  for (const d of code) { await page.locator(`.pinpad-key[aria-label="${d}"]`).click(); await page.waitForTimeout(60); }
  await page.waitForTimeout(400);
};
const note = () => page.locator('.pinpad-note').innerText().catch(() => '');

// 先登录（管理员账号，不占设备名额）
await boot();
await page.evaluate(async pw => (await import('/src/system/auth.js')).login('admin', pw), ADMIN);
await boot();

// ---- 一、设置 ----
await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings', '/'); n.push('/appearance');
});
await page.waitForTimeout(700);
await page.locator('.list-item', { hasText: '锁屏密码' }).click();
await page.waitForTimeout(500);
ok('外观里有「锁屏密码」，点进去就是输新密码', /输入 4 位新密码/.test(await note()), await note());
await keys('1234');
ok('输完一遍要求再输一遍', /再输入一遍/.test(await note()), await note());
await keys('1235');
ok('两遍不一致：写明并重来', /两次输入不一致/.test(await note()), await note());
await keys('1234');
await keys('1234');
const stored = await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().lockPin);
ok('设好了：库里是加盐的散列，不是原文',
  stored?.hash && stored.len === 4 && !JSON.stringify(stored).includes('1234'), JSON.stringify(stored));

// ---- 二、重开 ----
await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.set({ showLockScreen: false }));
await page.waitForTimeout(300);
await boot();
ok('重开：「启动时显示锁屏」关着也先停在锁屏', await page.locator('.lock').count() === 1);
// 别处把导航推去了某个 app（点了系统通知）：锁屏照样挡着
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.openApp('chat', '/'); });
await page.waitForTimeout(500);
ok('导航被推去了聊天：界面上仍然只有锁屏',
  await page.locator('.lock').count() === 1 && await page.locator('.app-layer').count() === 0);
await page.locator('.lock-unlock').click();
await page.waitForTimeout(300);
ok('点「上滑解锁」出数字键盘', /输入 4 位锁屏密码/.test(await note()), await note());
await keys('0000');
ok('输错：写明', /密码错误/.test(await note()), await note());
await keys('1234');
await page.waitForTimeout(500);
ok('输对：进门，落在刚才被推去的聊天里',
  await page.locator('.lock').count() === 0 && await page.locator('.app-layer').count() === 1);

// ---- 三、连错 ----
await boot();
await page.locator('.lock-unlock').click();
for (let i = 0; i < 5; i++) await keys('9999');
ok('连错五次：要等，写明几秒', /秒后可再试/.test(await note()), await note());
ok('等的时候键盘不接', await page.locator('.pinpad-key[aria-label="1"]').isDisabled());
await page.evaluate(() => localStorage.removeItem('eira-pin-fail'));

// ---- 四、忘记密码 ----
await boot();
await page.locator('.lock-unlock').click();
await page.locator('.lock-pin-acts button', { hasText: '忘记密码' }).click();
await page.waitForTimeout(300);
ok('忘记密码：问的是账号的登录密码，输入框是密码框',
  await page.locator('.modal input[type="password"]').count() === 1);
await page.locator('.modal input').fill('wrong-password');
await page.locator('.modal button', { hasText: '验证' }).click();
await page.waitForTimeout(800);
const still = await page.evaluate(async () => (await import('/src/system/pinlock.js')).hasPin());
ok('账号密码错了：不放行，锁屏密码还在', still && await page.locator('.lock').count() === 1);
await page.locator('.lock-pin-acts button', { hasText: '忘记密码' }).click();
await page.waitForTimeout(300);
await page.locator('.modal input').fill(ADMIN);
await page.locator('.modal button', { hasText: '验证' }).click();
await page.waitForTimeout(1000);
const gone = await page.evaluate(async () => (await import('/src/system/pinlock.js')).hasPin());
ok('账号密码对了：锁屏密码清掉，进门', !gone && await page.locator('.lock').count() === 0);

// ---- 五、关掉要先核对 ----
await page.evaluate(async () => (await import('/src/system/pinlock.js')).setPin('246810'));
await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  n.openApp('settings', '/'); n.popToRoot(); n.push('/lockpin');
});
await page.waitForTimeout(600);
await page.locator('.list-item', { hasText: '关闭密码' }).click();
await page.waitForTimeout(300);
ok('六位密码：键盘要六位', await page.locator('.pinpad-dots i').count() === 6);
await keys('111111');
ok('关闭时旧密码不对：不关', /密码错误/.test(await note()) && await page.evaluate(async () => (await import('/src/system/pinlock.js')).hasPin()));
await keys('246810');
ok('旧密码对了：关掉', !await page.evaluate(async () => (await import('/src/system/pinlock.js')).hasPin()));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
