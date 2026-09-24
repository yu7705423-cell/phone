// 正式版与测试版（system/channel.js，CLAUDE.md「正式版与测试版」）。
//
// 测试版放在 Cloudflare Pages（*.pages.dev），按网址认出来之后挂一枚「测试版」、改标题、
// 设置页的构建号后面写明 —— 免得和正式版弄混。正式版上一样都没有。
// 测试里没有那个域名，用 localStorage 的 eira-channel=test 代替
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const look = async test => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  if (test) await p.addInitScript(() => localStorage.setItem('eira-channel', 'test'));
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  await p.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/'); });
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => ({
    tag: document.querySelector('.test-tag')?.textContent || '',
    title: document.title,
    foot: [...document.querySelectorAll('.settings-foot')].map(e => e.innerText).join(' '),
    pe: document.querySelector('.test-tag') ? getComputedStyle(document.querySelector('.test-tag')).pointerEvents : '',
  }));
  await c.close();
  return r;
};

const prod = await look(false);
ok('正式版：没有测试版标记', !prod.tag && !/测试版/.test(prod.title) && !/测试版/.test(prod.foot), JSON.stringify(prod));
const test = await look(true);
ok('测试版：左边缘挂着「测试版」', test.tag === '测试版', JSON.stringify(test));
ok('测试版：标记点不到，不挡边缘返回', test.pe === 'none', test.pe);
ok('测试版：标题写明', test.title === 'Eira 测试版', test.title);
ok('测试版：设置页构建号后面写明', /构建 \S+ · 测试版/.test(test.foot), test.foot);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
