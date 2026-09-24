// 正式版挂在 github.io/phone/ 下面，不在根目录。
//
// 测试平时在根目录下跑，写成 `/vendor/...` 这种从根算的路径也照样找得到 —— 线上却指到
// github.io/vendor/ 去了。ffmpeg 的核心就这么在线上一直加载失败，测试一次都没报过。
// 这里把应用挂到 /phone/ 下面，根目录下的 vendor 一律拦掉，再把 ffmpeg 拉起来。
//
// 顺带查：wasm 是分两块取回来拼的（Cloudflare Pages 单个文件上限 25 MB，整个的放不上去）
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const asked = [];
await page.route(`${BASE}/**`, async r => {
  const url = new URL(r.request().url());
  if (url.pathname.startsWith('/phone/')) {
    asked.push(url.pathname);
    // /phone/ 下面的原样转到根目录那份文件
    const res = await r.fetch({ url: BASE + url.pathname.slice('/phone'.length) + url.search });
    return r.fulfill({ response: res });
  }
  // 根目录下的一律不给：线上那里什么都没有
  asked.push('ROOT ' + url.pathname);
  return r.fulfill({ status: 404, body: 'not here' });
});
await page.goto(`${BASE}/phone/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

ok('挂在 /phone/ 下面：应用照常打开', await page.evaluate(() => !!document.querySelector('.root, .login, .lock')));

const r = await page.evaluate(async () => {
  try {
    const f = await import('./src/system/ffmpeg.js');
    await f.load();
    return { loaded: f.isLoaded() };
  } catch (e) { return { err: String(e.message || e) }; }
});
ok('挂在 /phone/ 下面：ffmpeg 核心加载成功', r.loaded === true, JSON.stringify(r));
ok('没有一个请求落到根目录下', !asked.some(p => p.startsWith('ROOT ')), asked.filter(p => p.startsWith('ROOT ')).join(' '));
ok('wasm 是分两块取回来的，没有去要那个整的',
  asked.includes('/phone/vendor/ffmpeg/ffmpeg-core.wasm.1') && asked.includes('/phone/vendor/ffmpeg/ffmpeg-core.wasm.2')
  && !asked.includes('/phone/vendor/ffmpeg/ffmpeg-core.wasm'), asked.filter(p => /wasm/.test(p)).join(' '));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
