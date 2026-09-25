// 发了新版之后，本机不许留着上一版的文件（ARCHITECTURE 4.230）。
//
// 无构建方案没有文件指纹，启动时那道构建号比对（main.js）只看得见 version.js。
// 下面两类文件从前是它看不见的：
//
//   一、样式表。图标上传的图、壁纸、朋友圈的图都是样式表读一个变量画出来的（美化契约不许写死
//       内联 background-image）。新代码配旧样式表，变量没人读，图标与图片一起消失，别的都正常。
//   二、点开某个 app 才载入的那些 js。开机那一批在比对之后整份换新了，这一批没有：
//       Service Worker 缓存没命中时去网络取，默认走浏览器的 HTTP 缓存，拿到的是十分钟前那一份，
//       而且被存进新版的缓存，此后每次打开都是它，直到再发一版。
//
// 服务器学 GitHub Pages：页面 no-cache，其余 max-age=600。每一版在 shell.css 与聊天 app 的入口里
// 各加一个记号，看最后跑起来的是哪一版。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXE, chromium } from './_env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/plain' };
const REPO_BUILD = String(await readFile(join(ROOT, 'src/version.js'))).match(/BUILD\s*=\s*'([^']*)'/)[1];
let build = 'mix.1';
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (path === '/index.html' || path === '/') body = Buffer.from(String(body).split(REPO_BUILD).join(build));
    if (path === '/src/version.js') body = Buffer.from(`export const BUILD = '${build}';\n`);
    if (path === '/src/site.js') body = Buffer.from(String(body).replace(/accounts:\s*'[^']*'/, "accounts: ''"));
    if (path === '/styles/shell.css') body = Buffer.from(`${body}\n:root { --t-build: "${build}"; }\n`);
    if (path === '/src/apps/chat/App.js') body = Buffer.from(`${body}\nexport const __T_BUILD = '${build}';\n`);
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
const errs = [];
page.on('pageerror', e => errs.push(e.message));

const state = () => page.evaluate(async () => {
  const v = await import('/src/version.js');
  return {
    code: v.BUILD,
    css: getComputedStyle(document.documentElement).getPropertyValue('--t-build').trim().replace(/"/g, ''),
    home: !!document.querySelector('.home, .lock'),
    sw: navigator.serviceWorker.controller?.scriptURL || '',
  };
}).catch(e => ({ err: String(e) }));
const settle = async want => {
  for (let i = 0; i < 40; i++) {
    const s = await state();
    if (s.code === want && s.home && s.sw.includes(`b=${want}`)) return s;
    await page.waitForTimeout(500);
  }
  return state();
};
// 点开聊天 app：它的 js 这时才载入
const openChat = async () => {
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', '/'); });
  await page.waitForSelector('.ph-tabbar', { timeout: 15000 });
  await page.waitForTimeout(600);
  return page.evaluate(async () => (await import('/src/apps/chat/App.js')).__T_BUILD);
};

// ---- 第一版：打开两次，缓存好，聊天 app 也点开过 ----
await page.goto(`${BASE}/index.html`);
await settle('mix.1');
await openChat();
await page.waitForTimeout(1500);
await page.reload();
await settle('mix.1');
ok('第一版：聊天 app 是第一版', await openChat() === 'mix.1');

// ---- 发第二版（十分钟之内，浏览器 HTTP 缓存里还是第一版那一份）----
build = 'mix.2';
await page.reload();
const s2 = await settle('mix.2');
ok('第二版：开机那批代码换成第二版', s2.code === 'mix.2', JSON.stringify(s2));
ok('第二版：样式表是第二版', s2.css === 'mix.2', JSON.stringify(s2));
const chat2 = await openChat();
ok('第二版：点开之后才载入的聊天 app 也是第二版', chat2 === 'mix.2', chat2);

// 再开一次：存进本机缓存的那一份也得是第二版
await page.reload();
const s3 = await settle('mix.2');
ok('再打开：样式表仍是第二版', s3.css === 'mix.2', JSON.stringify(s3));
const chat3 = await openChat();
ok('再打开：聊天 app 仍是第二版（本机缓存里没有存进旧的）', chat3 === 'mix.2', chat3);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
server.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
