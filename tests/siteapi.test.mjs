// 本站提供的网易云接口（src/site.js）：运营方填了，用户什么都不设就能搜歌、扫码；
// 用户自己填了以自己的为准，清空回到本站的；本站没提供时照旧提示去设置
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const hits = [];
const fakeApi = async ctx => {
  for (const host of ['site-ne.example.com', 'mine.example.com']) {
    await ctx.route(`**/${host}/**`, route => {
      const u = new URL(route.request().url());
      hits.push({ host, path: u.pathname, ip: u.searchParams.get('realIP') || '' });
      const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/cloudsearch') {
        return J({ code: 200, result: { songs: [{ id: 1, name: host === 'mine.example.com' ? '我自己的接口' : '本站接口搜到的', ar: [{ name: '某人' }], al: { picUrl: '' }, dt: 1000 }] } });
      }
      if (u.pathname === '/login/qr/key') return J({ code: 200, data: { unikey: 'k' } });
      if (u.pathname === '/login/qr/create') return J({ code: 200, data: { qrimg: 'data:image/png;base64,iVBORw0KGgo=' } });
      return J({ code: 200 });
    });
  }
};
const open = async site => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await fakeApi(ctx);
  // 运营方填好的 site.js
  if (site) {
    await ctx.route('**/src/site.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript',
      body: `export const SITE = ${JSON.stringify(site)};` }));
  }
  const page = await ctx.newPage();
  await page.addInitScript(b => { window.BASE = b; }, BASE);
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return { ctx, page };
};

// ---- 一、本站提供了接口：用户一样都不填 ----
let { ctx, page } = await open({ neteaseApi: 'https://site-ne.example.com', neteaseRealIP: '1.2.3.4' });
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('music', '/'); });
await page.waitForTimeout(800);
await page.locator('.tab', { hasText: '搜索' }).tap();
await page.waitForTimeout(400);
let txt = await page.locator('.page').last().innerText();
ok('什么都没设置：音乐 app 不再提示「尚未配置音乐接口」', !/尚未配置音乐接口/.test(txt), txt.slice(0, 200));
const res = await page.evaluate(async () => (await import('/src/system/netease.js')).search('晴天', 5));
ok('搜歌走本站提供的接口，带着本站设的 realIP', res[0]?.title === '本站接口搜到的'
  && hits.some(h => h.host === 'site-ne.example.com' && h.path === '/cloudsearch' && h.ip === '1.2.3.4'), JSON.stringify(hits));

await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('settings', '/music'); });
await page.waitForTimeout(800);
txt = await page.locator('.page').last().innerText();
ok('设置页写明：本站已提供，留空即用，当前在用本站的', /本站已提供接口，留空即使用它/.test(txt) && /当前使用本站提供的接口/.test(txt), txt.slice(0, 400));
ok('输入框空着，灰字显示本站的地址', await page.locator('.field', { hasText: '接口地址' }).locator('input').getAttribute('placeholder') === 'https://site-ne.example.com');
ok('账号那一栏直接可以扫码', await page.locator('.btn', { hasText: '获取二维码' }).count() === 1);
await page.locator('.btn', { hasText: '获取二维码' }).tap();
await page.waitForTimeout(700);
ok('扫码走本站的接口，出得来二维码', await page.locator('.qr-img').count() === 1 && hits.some(h => h.host === 'site-ne.example.com' && h.path === '/login/qr/create'));
await page.screenshot({ path: `${OUT}/siteapi-settings.png` });

// ---- 二、用户自己填了：以自己的为准；清空回到本站的 ----
await page.locator('.field', { hasText: '接口地址' }).locator('input').fill('https://mine.example.com');
await page.waitForTimeout(300);
let r2 = await page.evaluate(async () => (await import('/src/system/netease.js')).search('晴天', 5));
ok('自己填了：走自己的接口', r2[0]?.title === '我自己的接口', JSON.stringify(r2[0]));
ok('不再写「当前使用本站提供的接口」', !/当前使用本站提供的接口/.test(await page.locator('.page').last().innerText()));
await page.locator('.field', { hasText: '接口地址' }).locator('input').fill('');
await page.waitForTimeout(300);
r2 = await page.evaluate(async () => (await import('/src/system/netease.js')).search('晴天', 5));
ok('清空：回到本站提供的接口', r2[0]?.title === '本站接口搜到的', JSON.stringify(r2[0]));
await ctx.close();

// ---- 三、本站没提供：照旧提示 ----
({ ctx, page } = await open(null));
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('music', '/'); });
await page.waitForTimeout(800);
await page.locator('.tab', { hasText: '搜索' }).tap();
await page.waitForTimeout(400);
txt = await page.locator('.page').last().innerText();
ok('本站没提供：提示本站未提供默认接口、去设置里填', /尚未配置音乐接口/.test(txt) && /本站未提供默认接口/.test(txt), txt.slice(0, 200));
await ctx.close();

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
