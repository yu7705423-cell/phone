// 打包：源 Blob 中途读不出来时，包仍然是完整的（长度按真读到的记）。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

const r = await page.evaluate(async () => {
  const z = await import('/src/system/zip.js');
  const out = {};

  // 正常的几种照旧
  const plain = await z.zip([{ name: 'backup.json', text: '{"a":1}' },
    { name: 'images/a.png', blob: new Blob([new Uint8Array(1000).fill(7)]) }]);
  out.plain = await z.verify(plain, ['backup.json']);
  out.plainBack = [...(await z.unzip(plain)).keys()];

  // **关键一条**：一个「说自己有一万字节、实际只给得出三千」的 Blob。
  // iOS 上 IndexedDB 里的 Blob 隔一会儿再读就是这个样子
  const liar = new Blob([new Uint8Array(3000).fill(9)]);
  Object.defineProperty(liar, 'size', { value: 10000 });
  const bad = await z.zip([
    { name: 'backup.json', text: '{"a":1}' },
    { name: 'images/liar.png', blob: liar },
    { name: 'images/after.png', blob: new Blob([new Uint8Array(500).fill(3)]) },
  ]);
  out.liar = await z.verify(bad, ['backup.json']);
  out.liarShort = bad.shortNames || [];
  const back = await z.unzip(bad);
  out.liarNames = [...back.keys()];
  out.liarBytes = back.get('images/liar.png')?.size;
  out.afterBytes = back.get('images/after.png')?.size;
  out.jsonText = await back.get('backup.json')?.text();
  return out;
});

check(r.plain.ok, `正常的包照旧过（${JSON.stringify(r.plain.problem || 'ok')}）`);
check(r.plainBack.length === 2, '正常的包解得开');
check(r.liar.ok === true, `源 Blob 读短了，包仍然自检通过（${JSON.stringify(r.liar.problem || 'ok')}）`);
check(r.liarShort.includes('images/liar.png'), `读短的那一条被记下来了（${JSON.stringify(r.liarShort)}）`);
check(r.liarBytes === 3000, `读短那条按真读到的长度记（${r.liarBytes}）`);
check(r.afterBytes === 500, `它后面那条没被带歪（${r.afterBytes}）`);
check(r.jsonText === '{"a":1}', 'backup.json 原样取得回来');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
