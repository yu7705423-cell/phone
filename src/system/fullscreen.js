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
// 不请求全屏的地方：
//   iPhone、iPad    系统状态栏一直都在，iPhone 上也没有这个接口
//   加到主屏幕       manifest 里已经是 fullscreen，本来就铺满
//   安卓安装包       外壳自己藏了系统状态栏（window.phoneFullscreen）
//
// 但「加到主屏幕」那一种和这里请求来的全屏是同一个处境（系统栏藏着、网页自己画状态栏、
// 状态栏划出来过一次之后 Chrome 报的安全区不回去），所以下面的安全区清零、留白重排
// 两样对它一样做（drawsBars）。
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

// 系统栏藏着、网页自己画状态栏的两种：这里请求来的全屏，和加到主屏幕、以全屏打开的
const installedFull = () => mq('(display-mode: fullscreen)') && !isFull();
// **苹果设备一律不算。** 苹果把加到主屏幕的应用也报成 display-mode: fullscreen，
// 可它的系统状态栏一直都在：照安卓那样清零安全区，主页就钻进状态栏底下，
// 左上角的返回键点不到（build .120 到 .130）
const drawsBars = () => !apple() && (isFull() || installedFull());

// 系统状态栏闪过一下之后（进全屏那一下，或者从顶上划出来又收回去），安卓 Chrome 有时
// 不再把页面画进摄像头那一行：页面从那一行下面开始（innerHeight 比 screen.height 矮一截），
// 那一行留成白的。这时把 viewport-fit 换成 auto 再换回 cover，Chrome 会重新决定画不画进去。
//
// 三道闸，缺一道就会像 build .117 那样整屏上下跳个不停（换本身会触发 resize）：
//   只在量出来确实矮一截时换
//   换的过程中来的 resize 一律不理
//   连着换两次还是矮，就不再换，直到哪一次量出来已经铺满了才重新计数
const REFIT_MAX = 2;
let refits = 0;
let flipping = false;
const shortOfScreen = () => drawsBars() && screen.height - innerHeight > 8;
function flip() {
  const m = document.querySelector('meta[name="viewport"]');
  if (flipping || !m || !/viewport-fit=cover/.test(m.content)) return false;
  flipping = true;
  const was = m.content;
  m.content = was.replace('viewport-fit=cover', 'viewport-fit=auto');
  requestAnimationFrame(() => requestAnimationFrame(() => { m.content = was; }));
  setTimeout(() => { flipping = false; }, 800);
  return true;
}
function refit() {
  if (flipping) return;
  if (!shortOfScreen()) { refits = 0; return; }
  if (refits >= REFIT_MAX) return;
  if (flip()) refits++;
}
// 桌面全屏版启动时（以及从后台切回来时），系统状态栏先露一下再收起。有的机器上
// 量不出「矮一截」，那一行照样留白。所以等它收完，不看量出来多少，重排一次 ——
// 只这一次，由计时器触发，不接 resize，不会自己追着自己跑
const SETTLE_MS = 2500;
const refitOnce = () => { if (drawsBars()) flip(); };
// 划出来的状态栏几秒后自己收回去，收回去之后再量；量早了它还在，矮一截是对的
let refitTimer = 0;
const refitLater = ms => { clearTimeout(refitTimer); refitTimer = setTimeout(refit, ms); };

function mark() {
  // 样式靠这个属性把安全区清零、把状态栏加高（base.css）
  document.documentElement.toggleAttribute('data-browser-full', drawsBars());
  fullStore.set({ full: isFull() });
}

// 电脑上点一下就全屏太突兀，自动的那一档只在触摸屏上
const wanted = () => settings.get().autoFullscreen !== false && mq('(pointer: coarse)');

export function install() {
  if (typeof document === 'undefined') return;
  mark();
  window.matchMedia('(display-mode: fullscreen)').addEventListener?.('change', mark);
  document.addEventListener('fullscreenchange', () => {
    mark();
    // 状态栏闪完、收回去之后再量
    if (isFull()) { refits = 0; setTimeout(refit, 500); setTimeout(refit, 1500); }
  });
  if (installedFull()) setTimeout(refitOnce, SETTLE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && drawsBars()) setTimeout(refitOnce, SETTLE_MS);
  });
  window.addEventListener('resize', () => { if (!flipping && drawsBars()) refitLater(3500); });

  // pointerup（触摸）与 click 都算一次点按，浏览器认它做进全屏的理由。
  // 只认「点」，不认「划」：边缘右滑返回这种由页面自己接住的滑动，浏览器不发
  // pointercancel，抬手时照样有 pointerup —— 划一下返回不该顺带进全屏
  let down = null;
  document.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; }, true);
  const tap = e => {
    if (e.type === 'pointerup') {
      if (e.pointerType === 'mouse') return;
      const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
      down = null;
      if (moved > 12) return;
    }
    if (wanted()) enter();
  };
  document.addEventListener('pointerup', tap, true);
  document.addEventListener('click', tap, true);
}
