import { html, useState, useEffect } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { useStore } from '../system/store.js';
import { settings } from '../system/db/index.js';

// 移动端浏览器本身就有状态栏,再画一条就是双份。
// auto = 触摸设备自动隐藏;on / off 手动覆盖。
//
// 例外是**系统状态栏被藏起来了**的时候：安卓上加到主屏幕走的是全屏显示（manifest 的 display），
// 安卓安装包也藏了系统状态栏（外壳注入 window.phoneFullscreen）。那时不画就看不到时间和电量。
//
// iPhone、iPad 上系统状态栏一直都在（加到主屏幕、安装包、浏览器里都是），「自动」一律不画 ——
// 画了就是顶上平白多出 26 像素，开着壁纸时字是白的，看起来就是一条空白
const apple = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function shouldShow(mode) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  if (apple() && window.matchMedia('(pointer: coarse)').matches) return false;
  if (window.phoneFullscreen || window.matchMedia('(display-mode: fullscreen)').matches) return true;
  return !window.matchMedia('(pointer: coarse)').matches;
}

function useClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    let timer;
    const tick = () => {
      const now = new Date();
      setT(now);
      // 对齐到下一个整分,不做每秒轮询
      timer = setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
    };
    timer = setTimeout(tick, 60000 - (Date.now() % 60000));
    return () => clearTimeout(timer);
  }, []);
  return t;
}

function useBattery() {
  const [level, setLevel] = useState(null);
  useEffect(() => {
    if (!navigator.getBattery) return;
    let bat, alive = true;
    navigator.getBattery().then(b => {
      if (!alive) return;
      bat = b;
      const update = () => setLevel(Math.round(b.level * 100));
      update();
      b.addEventListener('levelchange', update);
      bat._update = update;
    }).catch(() => {});
    return () => {
      alive = false;
      if (bat && bat._update) bat.removeEventListener('levelchange', bat._update);
    };
  }, []);
  return level;
}

export function StatusBar() {
  const s = useStore(settings.store);
  const now = useClock();
  const level = useBattery();
  if (!shouldShow(s.statusBar)) return null;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  return html`
    <div class="statusbar ph-statusbar">
      <div class="sb-time">${hh}:${mm}</div>
      <div class="sb-icons">
        <${Icon} name="signal" size=${14}/>
        <${Icon} name="wifi" size=${14}/>
        ${level != null ? html`<span class="sb-level">${level}</span>` : null}
        <${Icon} name="battery" size=${16}/>
      </div>
    </div>`;
}
