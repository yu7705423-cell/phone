// 排查顶上、底下空一条用的读数。地址后面加 ?diag 打开，?diag=off 关掉，平时不加载。
//
// 打开一次就记住（localStorage）：加到主屏幕的那一份没有地址栏，没法在地址后面加东西，
// 在 Chrome 里用 ?diag 打开一次，主屏幕那一份再打开时同样显示。
// 另外记下刚启动那一刻和 3 秒后的读数：系统状态栏只在启动时露一下，要看的正是它前后的变化。
//
// 空出来的那一条是谁留的，只有在出问题的那台真机上才看得到：浏览器报的安全区、
// 100vh 实际多高、外壳从哪儿开始画、页面有没有被推开。一张截图把这几样都带上。
// 读数放在屏幕中间，不挡住顶上和底下要看的那两条。
import { BUILD } from '../version.js';

const px = v => Math.round(v * 10) / 10;

function probe() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;'
    + 'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(el);
  return el;
}

function read(env) {
  const cs = getComputedStyle(env);
  const root = document.querySelector('.root');
  const bar = document.querySelector('.statusbar');
  const scr = document.querySelector('.screen');
  const r = root?.getBoundingClientRect();
  const rs = root ? getComputedStyle(root) : null;
  const vv = window.visualViewport;
  const mode = ['fullscreen', 'standalone', 'minimal-ui', 'browser']
    .find(m => matchMedia(`(display-mode: ${m})`).matches);
  return [
    `build ${BUILD}`,
    `full ${document.fullscreenElement ? 'yes' : 'no'}  mode ${mode}  dpr ${devicePixelRatio}`,
    `screen ${screen.width}x${screen.height}  inner ${innerWidth}x${innerHeight}  outer ${outerWidth}x${outerHeight}`,
    `vv h ${px(vv?.height ?? 0)} top ${px(vv?.offsetTop ?? 0)} pageTop ${px(vv?.pageTop ?? 0)}`,
    `html h ${px(parseFloat(getComputedStyle(document.documentElement).height))}  scrollY ${px(scrollY)}`,
    `env top ${cs.paddingTop} bottom ${cs.paddingBottom}`,
    `root top ${px(r?.top ?? -1)} h ${px(r?.height ?? -1)} pad ${rs?.paddingTop} safe ${rs?.getPropertyValue('--safe-top').trim()}`,
    `bar ${bar ? `top ${px(bar.getBoundingClientRect().top)} h ${px(bar.getBoundingClientRect().height)}` : 'none'}`
      + `  screen top ${px(scr?.getBoundingClientRect().top ?? -1)}`,
  ].join('\n');
}

const KEY = 'eira-diag';
function wanted() {
  const m = location.search.match(/[?&]diag(?:=(\w+))?/);
  try {
    if (m) m[1] === 'off' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, '1');
    return localStorage.getItem(KEY) === '1';
  } catch { return !!m && m[1] !== 'off'; }
}

// 刚启动与 3 秒后：只记最能说明问题的几项
const brief = env => `inner ${innerHeight} screen ${screen.height} env ${getComputedStyle(env).paddingTop}`
  + ` root ${Math.round(document.querySelector('.root')?.getBoundingClientRect().top ?? -1)}`;

export function install() {
  if (!wanted()) return;
  const env = probe();
  const box = document.createElement('pre');
  box.className = 'diag';
  document.body.appendChild(box);
  const at = { t0: brief(env), t3: '' };
  setTimeout(() => { at.t3 = brief(env); }, 3000);
  const tick = () => { box.textContent = `${read(env)}\nt0 ${at.t0}\nt3 ${at.t3}`; };
  tick();
  setInterval(tick, 500);
  window.addEventListener('resize', tick);
  document.addEventListener('fullscreenchange', tick);
}
