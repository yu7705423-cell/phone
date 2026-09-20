import { html, render } from './lib.js';
import { ready, settings } from './system/db/index.js';
import { registerApps } from './apps/index.js';
import { setConcurrency } from './system/ai/queue.js';
import { healAndSave } from './screens/home/layout.js';
import { Root } from './shell/Root.js';
import { applyLook, applyCustomCSS } from './system/look.js';
import { migrateLegacy } from './system/ai/services.js';
import { nav } from './system/nav.js';
import { forceUpdate } from './system/refresh.js';
import { BUILD } from './version.js';
import './screens/home/widgets.js';

const mount = document.getElementById('app');

render(html`<div class="boot"><span class="spinner"></span></div>`, mount);

function boot() {
  ready.then(() => {
    migrateLegacy();
    registerApps();
    healAndSave();

    const s = settings.get();
    document.documentElement.dataset.theme = s.theme;
    applyLook(s);
    applyCustomCSS(s.customCSS);
    setConcurrency(2);
    if (!s.showLockScreen) nav.set({ screen: 'home' });

    render(html`<${Root}/>`, mount);
  }).catch(err => {
    console.error('[boot] 启动失败', err);
    render(html`
      <div class="boot boot-error">
        <div class="boot-title">启动失败</div>
        <div class="boot-msg">${String(err.message || err)}</div>
        <div class="boot-hint">若是首次运行，请确认浏览器允许使用 IndexedDB。</div>
      </div>`, mount);
  });
}

// 缓存里的 js 是不是旧的。
//
// 无构建方案没有文件指纹，浏览器会把 js 一直留在 HTTP 缓存里，而且是**新旧混着**：
// 这次新加的文件从没被缓存过，一定是新的；旧文件却可能还是上一版。
// 于是新页面调用了旧模块里还不存在的函数，直接炸在运行时 —— 已经这么炸过一次。
//
// index.html 是导航请求，浏览器对它的重新验证比对子资源积极得多，
// 所以拿 HTML 里那行 meta 当「真实版本」，和 version.js 一比就知道缓存有没有落后。
// 对不上就把代码全换一遍再重开。同一个构建号只自愈一次，免得来回刷。
const declared = document.querySelector('meta[name="build"]')?.content || '';
const HEALED = 'build-healed';

// 记在 localStorage 里，**按构建号记**：这一版自愈过一次就不再愈第二次。
//
// 从前记在 sessionStorage 里。外壳重新载入网页（回到前台、点通知进来、
// 网页进程被系统回收）都会开一个新的 session，那一份记号跟着没了，于是
// 每次进来都要再自愈、再重载一次 —— 人看到的就是「点一下通知，小手机
// 自己刷新了一遍」。构建号一变，这个键的值也变，该愈的下一版照样会愈。
const readHealed = () => {
  try { if (localStorage.getItem(HEALED) === declared) return true; } catch { /* 隐私模式会抛 */ }
  try { return sessionStorage.getItem(HEALED) === declared; } catch { return false; }
};
const markHealed = () => {
  try { localStorage.setItem(HEALED, declared); } catch { /* 同上 */ }
  try { sessionStorage.setItem(HEALED, declared); } catch { /* 同上 */ }
};
const healedBefore = readHealed();

if (declared && declared !== BUILD && !healedBefore) {
  console.warn(`[boot] 代码版本对不上：页面声明 ${declared}，实际加载 ${BUILD}。正在更新`);
  markHealed();
  render(html`
    <div class="boot">
      <span class="spinner"></span>
      <div class="boot-msg">正在更新到最新版本</div>
    </div>`, mount);
  forceUpdate().finally(() => location.reload());
} else {
  boot();
}
