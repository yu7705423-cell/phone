// 排查顶上、底下空一条用的读数。地址后面加 ?diag 打开，平时不加载。
//
// 空出来的那一条是谁留的，只有在出问题的那台真机上才看得到：浏览器报的安全区、
// 100vh 实际多高、外壳从哪儿开始画、页面有没有被推开。一张截图把这几样都带上。
// 读数放在屏幕中间，不挡住顶上和底下要看的那两条。

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

export function install() {
  if (!/[?&]diag\b/.test(location.search)) return;
  const env = probe();
  const box = document.createElement('pre');
  box.className = 'diag';
  document.body.appendChild(box);
  const tick = () => { box.textContent = read(env); };
  tick();
  setInterval(tick, 500);
  window.addEventListener('resize', tick);
  document.addEventListener('fullscreenchange', tick);
}
