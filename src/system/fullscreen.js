// 在浏览器标签页里铺满整屏（安卓 Chrome 这一类）。
//
// 标签页里网页够不到最顶上那一条：系统状态栏和地址栏都是浏览器的，viewport-fit、
// theme-color 都只能改它的颜色，改不掉它。唯一的办法是 Fullscreen API ——
// 它把地址栏和系统状态栏一起藏起来，那时网页自己画一条状态栏（shell/StatusBar.js）。
//
// 进全屏必须由一次点按触发，浏览器不让网页自己进。所以开着「浏览器中全屏」时，
// 每次触摸屏幕都看一眼：不在全屏就请求一次。退出全屏（安卓的返回手势）之后，
// 下一次触摸会再进去。
//
// 不做的地方：
//   iPhone、iPad    系统状态栏一直都在，iPhone 上也没有这个接口
//   加到主屏幕       manifest 里已经是 fullscreen，本来就铺满
//   安卓安装包       外壳自己藏了系统状态栏（window.phoneFullscreen）
import { createStore } from './store.js';
import { settings } from './db/index.js';

export const fullStore = createStore({ full: false });

const apple = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mq = q => window.matchMedia(q).matches;

export const isFull = () => !!document.fullscreenElement;

/** 这台设备、这种打开方式下，「浏览器中全屏」有没有意义 */
export function supported() {
  if (typeof document === 'undefined' || !document.documentElement.requestFullscreen) return false;
  if (apple() || window.phoneFullscreen || navigator.standalone === true) return false;
  if (mq('(display-mode: standalone)')) return false;
  // 加到主屏幕、以全屏方式打开的：display-mode 是 fullscreen，但不是这里请求来的
  if (mq('(display-mode: fullscreen)') && !isFull()) return false;
  return true;
}

let asking = false;
export function enter() {
  if (isFull() || asking || !supported()) return;
  asking = true;
  Promise.resolve()
    .then(() => document.documentElement.requestFullscreen({ navigationUI: 'hide' }))
    .catch(() => {})
    .finally(() => { asking = false; });
}

// 电脑上点一下就全屏太突兀，自动的那一档只在触摸屏上
const wanted = () => settings.get().autoFullscreen !== false && mq('(pointer: coarse)');

export function install() {
  if (typeof document === 'undefined') return;
  document.addEventListener('fullscreenchange', () => fullStore.set({ full: isFull() }));
  // pointerup（触摸）与 click 都算一次点按，浏览器认它做进全屏的理由。
  // 滑动滚动时浏览器发的是 pointercancel，不会在划一下的时候进全屏
  const tap = e => {
    if (e.type === 'pointerup' && e.pointerType === 'mouse') return;
    if (wanted()) enter();
  };
  document.addEventListener('pointerup', tap, true);
  document.addEventListener('click', tap, true);
}
