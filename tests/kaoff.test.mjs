// 保活关掉之后，那段音频必须真的停下、并且不能被再播起来（网页那条路，system/keepalive.js）。
//
// 从前关掉只是 pause()：元素还挂着、音源还在，系统的播放条照样留着。之后锁屏上点一下播放、
// 按一下耳机线控，它就又循环播下去，而保活那边「关着的时候在播」这种情况没人管。
//
//   打开：在播
//   关掉：停了，而且音源卸掉了（系统的播放条跟着消失）
//   关掉之后有人点了播放（锁屏播放条、耳机线控）：播不起来，或者播起来立刻被停掉
//   再打开：照样能播；开着时被系统按停，照样自己续上
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
// 记下页面里每一个调过 play() 的音频元素（保活那个不在 DOM 里，只能这样拿到）
await page.addInitScript(() => {
  window.__audios = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    if (!window.__audios.includes(this)) window.__audios.push(this);
    return play.apply(this, a);
  };
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const setKA = v => page.evaluate(async on => (await import('/src/system/db/index.js')).settings.set({ keepAlive: on }), v);
const look = () => page.evaluate(async () => {
  const ka = await import('/src/system/keepalive.js');
  return {
    on: ka.state.get().on,
    list: window.__audios.map(a => ({ paused: a.paused, src: a.getAttribute('src') || '', ready: a.readyState })),
    playing: window.__audios.filter(a => !a.paused).length,
  };
});

await setKA(true);
await page.waitForTimeout(800);
let s = await look();
ok('打开保活：在播', s.on && s.playing === 1, JSON.stringify(s));

await setKA(false);
await page.waitForTimeout(600);
s = await look();
const first = s.list[0] || {};
ok('关掉：停了', !s.on && s.playing === 0, JSON.stringify(s));
ok('关掉：音源卸掉了（系统的播放条跟着消失）', first.src === '' && first.ready === 0, JSON.stringify(first));

// 关掉之后有人点了播放：锁屏播放条、耳机线控都是直接对这个元素 play()
await page.evaluate(() => window.__audios.forEach(a => a.play().catch(() => {})));
await page.waitForTimeout(1500);
s = await look();
ok('关掉之后被点了播放：没有在播', s.playing === 0 && !s.on, JSON.stringify(s));

// 再打开
await setKA(true);
await page.waitForTimeout(800);
s = await look();
ok('再打开：照样能播', s.on && s.playing === 1, JSON.stringify(s));
// 开着时被系统按停：自己续上
await page.evaluate(() => window.__audios.filter(a => !a.paused).forEach(a => a.pause()));
await page.waitForTimeout(1800);
s = await look();
ok('开着时被按停：自己续上', s.on && s.playing === 1, JSON.stringify(s));

await setKA(false);
await page.waitForTimeout(600);
s = await look();
ok('最后关掉：一个都不在播', s.playing === 0 && !s.on, JSON.stringify(s));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
