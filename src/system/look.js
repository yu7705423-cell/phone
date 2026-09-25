import { settings, images } from './db/index.js';
import { ICON_MAX } from './db/images.js';
import { getApp, listApps } from './registry.js';

// 图标一律白底黑图。颜色、阴影、名称显示与否在主题设置里统一控制，
// 不再有每个 app 各自的底色。
export function appLook(appId) {
  const app = getApp(appId);
  if (!app) return null;
  const custom = (settings.get().appIcons || {})[appId] || {};
  return {
    ...app,
    icon: custom.icon || app.icon,
    name: custom.name || app.name,
    imageId: custom.imageId || null,     // 自定义图片，有则盖过 SVG
  };
}

export function listAppLooks() {
  return listApps().map(a => appLook(a.id));
}

// 把主题设置写进 CSS 变量与根元素的标记位
export function applyLook(s) {
  const root = document.documentElement;
  root.style.setProperty('--icon-color', s.iconColor || '#000000');
  // **不钳成非负。** 负数是把底部往下放，地址栏不存在时用来收回多余的留白。
  // 从前这里写着 Math.max(0, …)，于是设置里那条滑杆放开到 -40 也没用 ——
  // 滑杆动了、值也存了，到这一步被抹平
  root.style.setProperty('--bottom-lift', (Number(s.bottomLift) || 0) + 'px');
  root.dataset.iconShadow = s.iconShadow === false ? 'off' : 'on';
  root.dataset.iconLabel = s.iconLabels === false ? 'off' : 'on';
  // 图标名称的颜色。空着就是「自动」：有壁纸白字带投影，没有跟主题走（shell.css 的 .app-name）。
  // 写的是契约变量，美化包也能写同一个，用户在这儿选了的以这儿为准（第 18 条）
  if (s.iconLabelColor) root.style.setProperty('--ph-tile-name-color', s.iconLabelColor);
  else root.style.removeProperty('--ph-tile-name-color');
  root.dataset.glass = s.glass === true ? 'on' : 'off';
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

// 浏览器顶上那一条（地址栏、安卓的系统状态栏）的颜色。
// index.html 里那两条按系统的深浅色分，可应用里的深色模式是自己切的，两边会对不上：
// 系统是浅色、应用切到深色时，顶上一条白、底下一片黑。这里改成跟着应用实际的底色走。
export function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (!bg) return;
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  metas.slice(1).forEach(m => m.remove());
  const m = metas[0] || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  m.removeAttribute('media');
  m.content = bg;
}


// ---- 每个 app 的图标与名称 ----
//
// 数据在 settings.appIcons[appId]，改它的地方有三处：设置 - 外观、主界面上
// 长按图标、文件夹里长按图标。逻辑放这里，三处共用，界面是 ui/IconPicker。

export const iconOverride = appId => (settings.get().appIcons || {})[appId] || {};

export function setAppIcon(appId, patch) {
  const all = settings.get().appIcons || {};
  settings.set({ appIcons: { ...all, [appId]: { ...(all[appId] || {}), ...patch } } });
}

export function resetAppIcon(appId) {
  const s = settings.get();
  const all = { ...(s.appIcons || {}) };
  const cur = all[appId];
  if (cur?.imageId) images.remove(cur.imageId);
  delete all[appId];
  settings.replace({ ...s, appIcons: all });
}

export async function setAppIconFile(appId, file) {
  const id = await images.putIcon(file, ICON_MAX);
  const old = iconOverride(appId).imageId;
  if (old) images.remove(old);
  setAppIcon(appId, { imageId: id });
  return id;
}

// 链接同样落到本地，不做远程引用
export async function setAppIconUrl(appId, url) {
  const res = await fetch(String(url || '').trim());
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  if (!/^image\//.test(blob.type)) throw new Error('这个链接不是图片');
  return setAppIconFile(appId, new File([blob], 'icon', { type: blob.type }));
}

export function clearAppIconImage(appId) {
  const old = iconOverride(appId).imageId;
  if (old) images.remove(old);
  setAppIcon(appId, { imageId: null });
}
