// 别人写的网页（工具箱里的网页工具、主屏的自定义组件）放进来之前，先关进这个盒子。
// 见 ARCHITECTURE 4.247
//
// 不去审代码 —— 混淆一下就看不出来。靠的是浏览器保证的几道墙：
//
// 1. iframe 只给 `sandbox="allow-scripts"`，**不给 allow-same-origin**。
//    它拿到的是一个不透明源：读不到本应用的 IndexedDB、localStorage（密钥、聊天、角色都在里面），
//    碰不到外面的页面，不能把整个应用跳走，也弹不了新窗口、alert。
// 2. 文档最前面插一条 CSP：不许连任何外部地址、不许加载外部脚本与字体。
//    下载不了别的代码，也发不出任何东西。
//    **外部图片与字体可以开**（用户要求：「要有可以打开外部图片的」「字体也要」），
//    连同为了字体引的外部样式表。这几样的地址本身能捎带东西出去，
//    所以只在「盒子里没有用户数据」或用户知情时开：主屏组件一律开（它拿不到任何数据）；
//    网页工具每个一个开关，默认开，开着时往里交角色、世界书之前会提醒一句。
// 3. 它还能把自己那一小块跳到外部网址、顺带捎点东西出去 —— 外面数 load 次数，
//    第二次 load 就说明它跳了，当场拆掉（见 watchFrame）。
//
// 4. 装成 App 时，外壳的原生接口（安卓的 EiraNative、iOS 的 messageHandlers）会出现在每一个 frame 里，
//    沙盒也挡不住它们 —— 能经外壳发任意请求、读健康数据。新外壳只认主页面（安卓靠口令，iOS 核 isMainFrame），
//    并声明 phoneFrameGuard；认不出它的旧外壳，盒子里一律不给运行脚本（见 sandboxFlags 与 ARCHITECTURE 4.249）。
//
// 堵不死的：部分浏览器的 WebRTC 绕得过 CSP。它手里只有用户当场交给它的那一点东西，
// 最坏也就漏那一点。死循环卡住整个页面也挡不住，只能保证重开之后不再自动跑（工具箱那边管）。

const policy = (images, scripts = true) => [
  "default-src 'none'",
  scripts ? "script-src 'unsafe-inline' 'unsafe-eval'" : "script-src 'none'",
  // 外部样式表只为字体（Google Fonts 那种先引一份 css、再由它去拉字体文件）。样式表跑不了脚本
  images ? "style-src 'unsafe-inline' https:" : "style-src 'unsafe-inline'",
  images ? 'img-src data: blob: https:' : 'img-src data: blob:',
  images ? 'font-src data: https:' : 'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
].join('; ');

/** 不许外部图片的那一条（最严的一档） */
export const CSP = policy(false);
/**
 * images：外部 https 图片、字体、字体用的样式表一起放开。
 * scripts: false 是 HTML 卡片那一档（ARCHITECTURE 4.250）：盒子本身就不给脚本，CSP 再挡一道
 */
export const cspOf = ({ images = false, scripts = true } = {}) => policy(images, scripts);

/** 在不在 App 外壳里（安卓 APK、iOS IPA） */
const inShell = () => typeof window !== 'undefined'
  && !!(window.phoneAppVersion || window.EiraNative || window.webkit?.messageHandlers);

/**
 * 盒子里能不能运行脚本。浏览器里能；App 里只有新外壳能（它的原生接口只认主页面）。
 * 旧外壳里脚本一跑就摸得到外壳的接口，所以不给，只显示静态的 HTML 与 CSS。
 */
export const scriptsAllowed = () => !inShell() || window.phoneFrameGuard === true;

/** iframe 的 sandbox 属性。**永不含 allow-same-origin** */
export const sandboxFlags = () => (scriptsAllowed() ? 'allow-scripts' : '');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * 把一段 HTML 包成可以放进 srcdoc 的整页。
 *
 * CSP 必须在它自己的任何东西之前：放在最前面，并去掉它自己的 doctype
 * （doctype 前面有内容会进怪异模式，所以我们自己补一个在最前）。
 * 解析器会把最前面这几样放进 head，后面它自己的 <html>、<head> 合并进来，不影响它的写法。
 *
 * `bridge` 是一段放在 CSP 之后、它的代码之前的脚本（工具箱给网页工具的 window.eira）。
 * `images` 放开 https 外部图片、字体与字体用的样式表。
 */
export function wrap(html, { bridge = '', images = false, scripts = true } = {}) {
  const body = String(html || '').replace(/^\uFEFF?\s*<!doctype[^>]*>/i, '');
  return '<!DOCTYPE html>'
    + `<meta http-equiv="Content-Security-Policy" content="${esc(cspOf({ images, scripts }))}">`
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + (bridge ? `<script>${bridge}</script>` : '')
    + body;
}

/**
 * 盯着一个 srcdoc iframe：第一次 load 是它自己；再 load 一次就是它把自己跳走了。
 * 跳走的那一刻它可能已经把地址里捎带的东西发出去，但之后不会再有第二次。
 *
 * 返回的是 onLoad 处理函数，直接挂在 iframe 的 onLoad 上 —— 必须在它进文档之前就挂好：
 * 等渲染完再 addEventListener，第一次 load 可能已经过去了，那样跳走的那一次反而被当成第一次。
 * 每次重新挂一个 iframe（换 key）都要拿一个新的。
 */
export function escapeGuard(onEscape) {
  let loads = 0;
  return () => {
    loads += 1;
    if (loads > 1) onEscape?.();
  };
}
