// 缓存开着的时候发了新版，用户打开时拿到的必须是新代码（sw.js 与 main.js 的构建号比对，ARCHITECTURE 4.220）。
//
// 自己起一台小服务器：文件照仓库里的给，只有 index.html 的 meta 和 src/version.js 的构建号可以当场改 ——
// 这样就能在测试中途「发一版」。缓存头学 GitHub Pages 给十分钟，浏览器的 HTTP 缓存也算进来。
//
//   第一版打开、缓存好
//   发第二版，再打开：代码换成第二版（不挂「代码是旧的」那一条），Service Worker 换成第二版的，第一版的缓存删掉
//   再发第三版，断网之前打开一次，断网再打开：进得去，是第三版
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXE, chromium } from './_env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain' };
let build = 'swtest.1';
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (path === '/index.html' || path === '/') body = Buffer.from(String(body).replace(/<meta name="build" content="[^"]*">/, `<meta name="build" content="${build}">`));
    if (path === '/src/version.js') body = Buffer.from(`export const BUILD = '${build}';\n`);
    if (path === '/src/site.js') body = Buffer.from(String(body).replace(/accounts:\s*'[^']*'/, "accounts: ''"));
    // 页面本身不缓存（和 GitHub Pages 的 HTML 一样会重新验证），其余给十分钟
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': extname(file) === '.html' || path === '/' ? 'no-cache' : 'max-age=600' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { try { localStorage.setItem('eira-sw-test', '1'); } catch { /* */ } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const page = await ctx.newPage();

const state = () => page.evaluate(async () => {
  const v = await import('/src/version.js');
  const keys = (await caches.keys()).filter(k => k.startsWith('eira-'));
  return {
    meta: document.querySelector('meta[name="build"]')?.content, code: v.BUILD,
    stale: !!document.querySelector('#stale.is-on'),
    home: !!document.querySelector('.home, .lock, .home-layer'),
    sw: navigator.serviceWorker.controller?.scriptURL || '', keys,
  };
}).catch(e => ({ err: String(e) }));
const settle = async want => {
  for (let i = 0; i < 40; i++) {
    const s = await state();
    if (s.code === want && s.home && s.sw.includes(`b=${want}`) && s.keys.length === 1) return s;
    await page.waitForTimeout(500);
  }
  return state();
};

// 第一版
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
let s = await settle('swtest.1');
ok('第一版：打开、Service Worker 接管、只有这一版的缓存', s.code === 'swtest.1' && s.sw.includes('b=swtest.1') && JSON.stringify(s.keys) === '["eira-swtest.1"]', JSON.stringify(s));
for (let i = 0; i < 40; i++) {
  const n = await page.evaluate(async () => (await (await caches.open('eira-swtest.1')).keys()).length);
  if (n > 100) break;
  await page.waitForTimeout(500);
}

// 发第二版
build = 'swtest.2';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
s = await settle('swtest.2');
ok('发了第二版再打开：代码是第二版，没有挂「代码是旧的」', s.meta === 'swtest.2' && s.code === 'swtest.2' && !s.stale && s.home, JSON.stringify(s));
// 第二版的 Service Worker 在上一版还管着这一页时装上，要等下一次打开才完全接管（浏览器等上一版手上的事做完）。
// 这期间页面照常用第二版的代码。再开一次看它接管、删掉第一版的缓存
await page.reload({ waitUntil: 'domcontentloaded' });
s = await settle('swtest.2');
ok('再开一次：Service Worker 换成第二版的，第一版的缓存整份删掉', s.code === 'swtest.2' && s.sw.includes('b=swtest.2') && JSON.stringify(s.keys) === '["eira-swtest.2"]', JSON.stringify(s));

// 发第三版，打开一次，再断网打开
build = 'swtest.3';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
s = await settle('swtest.3');
for (let i = 0; i < 40; i++) {
  const n = await page.evaluate(async () => (await (await caches.open('eira-swtest.3')).keys()).length);
  if (n > 100) break;
  await page.waitForTimeout(500);
}
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(3000);
s = await state();
ok('第三版缓存好之后断网再开：进得去，是第三版', s.home && s.code === 'swtest.3' && !s.stale, JSON.stringify(s));
await ctx.setOffline(false);

await browser.close();
server.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
