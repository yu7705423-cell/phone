// 长卡片不许把画布撑爆：iOS 上超过上限就是白屏加退出。
// **面积和单边都要守**（见 ARCHITECTURE 4.128）：从前只守面积，
// 于是二百条算出来 656x18300 —— 面积压住了，高度早就越界。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

const r = await page.evaluate(async () => {
  const cs = await import('/src/system/cardshot.js');
  const area = (w, h) => {
    const s = cs.fitScale(w, h);
    // 边长要用没四舍五入过的倍率算 —— 先 toFixed 再乘会差出几个像素，
    // 那几个像素正好骗过「不超过上限」的断言
    return { s: +s.toFixed(3), px: Math.round(w * s * h * s),
      cw: Math.round(w * s), ch: Math.round(h * s) };
  };
  return {
    max: cs.MAX_AREA, side: cs.MAX_SIDE, minScale: cs.MIN_SCALE,
    dpr: window.devicePixelRatio,
    small: area(430, 800),        // 短卡片：照常二倍
    mid: area(430, 5000),         // 中等
    long: area(430, 20000),       // 选了上百条那种
    absurd: area(430, 200000),    // 极端
    okSmall: cs.checkSize(430, 800).ok,
    okMid: cs.checkSize(430, 5000).ok,
    okLong: cs.checkSize(430, 20000),
  };
});
check(r.small.s === 2, `短卡片照常二倍（${JSON.stringify(r.small)}）`);
check(r.long.px <= r.max + 1, `长卡片压在面积上限内（${JSON.stringify(r.long)}）`);
check(r.absurd.px <= r.max + 1, `再长也压得住（${JSON.stringify(r.absurd)}）`);
check(r.mid.px <= r.max + 1 && r.mid.s > 0, `中等的也在线内（${JSON.stringify(r.mid)}）`);
// 单边那一道：这是补上的那一条，面积守住不等于画得出来
check(r.long.cw <= r.side && r.long.ch <= r.side,
  `长卡片的单边也压在上限内（${r.long.cw}x${r.long.ch} ≤ ${r.side}）`);
check(r.absurd.cw <= r.side && r.absurd.ch <= r.side,
  `极端那张的单边同样压得住（${r.absurd.cw}x${r.absurd.ch} ≤ ${r.side}）`);
// 短的中等的照画；压到看不清的那种宁可不画，并且说得出为什么
check(r.okSmall && r.okMid, '短的与中等的照常画');
check(!r.okLong.ok && /像素高/.test(r.okLong.reason || ''),
  `两万像素那张不画，并说明原因（${r.okLong.reason || '没给原因'}）`);

// 真画两张：装得下的那张要出图，装不下的那张要回 null —— 两种都不许把页面带走
const drew = await page.evaluate(async () => {
  const cs = await import('/src/system/cardshot.js');
  const mk = n => Array.from({ length: n }, (_, i) =>
    `<div style="height:48px;background:#eee;margin:2px">第 ${i} 行</div>`).join('');
  const fit = await cs.raster({ html: mk(100), css: 'div{font:14px sans-serif}', width: 430, height: 5000 });
  const huge = await cs.raster({ html: mk(400), css: 'div{font:14px sans-serif}', width: 430, height: 20000 });
  return { fit: fit ? fit.size : 0, huge: huge ? huge.size : null };
});
check(drew.fit > 0, `装得下的那张画得出来（${drew.fit}B）`);
check(drew.huge === null, `两万像素那张不画，回 null（${drew.huge}）`);
const alive = await page.evaluate(() => !!document.querySelector('.root')).catch(() => false);
check(alive, '画完页面还活着');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
