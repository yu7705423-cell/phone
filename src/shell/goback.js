import { nav, back, setSwitcher } from '../system/nav.js';
import { closeTopOverlay } from '../ui/overlay.js';
import { topBack } from '../ui/page.js';

// 「返回上一级」到底该做什么，只在这里定义一次。
//
// 三个地方要用同一套优先级：左上角那个悬浮返回键、原生边缘手势（见 ios/）、
// 以及将来任何一个「返回」入口。各写一份迟早会走岔。
//
// 优先级和 nav.back 对齐，再往前多两级：
//   多任务开着      先关多任务
//   浮层开着        先关最上面那层（整屏浮层、底部浮层、弹窗）
//   这一页有自己的返回  用它 —— 一百多页里有七页的返回是「退出多选」
//                    「关掉预览」这种页内的事，统一 nav.pop 会把它们连页面一起退掉
//   都没有          退路由
export function goBack() {
  if (nav.get().switcher) { setSwitcher(false); return; }
  if (closeTopOverlay()) return;
  const fn = topBack();
  if (fn) fn(); else back();
}

/**
 * 挂到 window 上，给原生外壳调。
 *
 * iOS 的 WKWebView 里，从屏幕最左边起手的触摸先归系统的边缘手势判，
 * 交到网页手里时 touchstart 的 clientX 往往已经不在边缘那一条里了 ——
 * 网页自己那套判定根本不会开始。所以 ipa 那一层改用原生的
 * UIScreenEdgePanGestureRecognizer，识别出来之后回头调这个函数。
 *
 * 外壳注入 window.phoneNativeBack = true，网页那套手势看见它就让开，
 * 免得两边各退一级。
 */
export function install() {
  window.phoneBack = goBack;
  return () => { delete window.phoneBack; };
}
