import { settings } from './db/index.js';
import { getApp, listApps } from './registry.js';

// 图标一律白底黑图。颜色、阴影、名称显示与否在主题设置里统一控制，
// 不再有每个 app 各自的底色。
export function appLook(appId) {
  const app = getApp(appId);
  if (!app) return null;
  const custom = (settings.get().appIcons || {})[appId] || {};
  return { ...app, icon: custom.icon || app.icon, name: custom.name || app.name };
}

export function listAppLooks() {
  return listApps().map(a => appLook(a.id));
}

// 把主题设置写进 CSS 变量与根元素的标记位
export function applyLook(s) {
  const root = document.documentElement;
  root.style.setProperty('--icon-color', s.iconColor || '#000000');
  root.dataset.iconShadow = s.iconShadow === false ? 'off' : 'on';
  root.dataset.iconLabel = s.iconLabels === false ? 'off' : 'on';
}

// 用户自定义 CSS。注入到独立的 style 节点，随时可清空。
let styleEl = null;
export function applyCustomCSS(css) {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'user-css';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css || '';
}
