// 安卓外壳的原生接口从哪里调。见 ARCHITECTURE 4.249
//
// 新外壳的每个接口都要带口令，口令在主页面的 bridge.js 里，经 window.EiraShell 调（口令它自己带）。
// 旧外壳没有 EiraShell，接口不要口令，照旧调 window.EiraNative。
// 网页一律经这里取，不直接碰 window.EiraNative：新外壳上直接调它会因为少了口令被拒。

/** 当前外壳的原生接口，浏览器里是 null */
export const shellApi = () => (typeof window === 'undefined' ? null : (window.EiraShell || window.EiraNative || null));
