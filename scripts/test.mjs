// 回归测试：把 tests/ 下的 *.test.mjs 挨个跑一遍。
//
//   SMOKE_PW=<装了 playwright 的目录> node scripts/test.mjs            全部
//   SMOKE_PW=... node scripts/test.mjs group badges                     名字里带这些词的
//   TEST_JOBS=4 ...                                                     同时跑几个，默认 3
//
// **从前这些测试全在一次性的临时目录里**，容器一回收就没了 —— 攒了几个月，
// 下一次改代码时没有任何东西能证明旧功能没坏。现在进仓库。
//
// 自己起一个静态服务器（不依赖 python），地址经 TEST_BASE 传给每个测试。
// 找不到 playwright 就跳过，不拦提交（和冒烟一样）。
//
// 每个测试是一个独立的进程，退出码非 0 就算没过。输出只在没过时打印。

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    // 本站开了登录时，应用一打开先要账号 —— 测试里谁也登不进去。账号服务的地址在这里抹掉，
    // 应用照没开登录那样直接进门。登录本身另有测试（tests/login.test.mjs 自己模拟 site.js）
    if (path === '/src/site.js') body = Buffer.from(String(body).replace(/accounts:\s*'[^']*'/, "accounts: ''"));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const want = process.argv.slice(2);
const all = (await readdir(join(ROOT, 'tests'))).filter(f => f.endsWith('.test.mjs')).sort();
const files = want.length ? all.filter(f => want.some(w => f.includes(w))) : all;
const jobs = Math.max(1, Number(process.env.TEST_JOBS) || 3);

const run = file => new Promise(resolve => {
  const started = Date.now();
  const p = spawn(process.execPath, [join(ROOT, 'tests', file)], {
    env: { ...process.env, TEST_BASE: BASE }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  const kill = setTimeout(() => p.kill('SIGKILL'), 300000);
  p.on('close', code => {
    clearTimeout(kill);
    resolve({ file, code, out, secs: ((Date.now() - started) / 1000).toFixed(0) });
  });
});

// 文件里写了 `// @serial` 的，等并行那一批跑完再一个一个跑：它们有时间上的断言
//（一帧多少毫秒、几百毫秒内闪一下），和别的测试抢 CPU 时会误报
const isSerial = async f => /^\/\/ @serial/m.test(await readFile(join(ROOT, 'tests', f), 'utf8'));
const flags = await Promise.all(files.map(isSerial));
const parallel = files.filter((_, i) => !flags[i]);
const serial = files.filter((_, i) => flags[i]);

const results = [];
const report = r => {
  results.push(r);
  const skipped = /跳过：找不到 playwright/.test(r.out);
  console.log(`  ${r.code === 0 ? (skipped ? 'skip' : 'ok  ') : 'FAIL'} ${r.file.replace('.test.mjs', '').padEnd(22)} ${r.secs}s`);
  if (r.code !== 0) console.log(r.out.split('\n').filter(l => /FAIL|Error|错误/.test(l)).slice(0, 8).map(l => '       ' + l.trim()).join('\n'));
};
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < parallel.length) report(await run(parallel[next++]));
}));
for (const f of serial) report(await run(f));
server.close();

const bad = results.filter(r => r.code !== 0);
console.log(`\n${results.length - bad.length}/${results.length} 个测试通过`);
process.exit(bad.length ? 1 : 0);
