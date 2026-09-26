import { settings, images } from './db/index.js';
import { ICON_MAX, hasPadding } from './db/images.js';
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
    scale: custom.scale || 0,            // 图片在格子里占多大（百分数），0 为整格
    bare: custom.bare === true,          // 不要底板：异形图标只剩图片本身
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
  applyFontScale(s.fontScale);
}

// 整体字号。字号令牌都是像素（tokens.css 的 --fs-*），按倍数逐个改写到 :root 上；
// 倍数为 1 时全部撤掉，令牌回到样式表里的原值。气泡、挂件、线下的字号都从这几个令牌算，一起变
export const FONT_SIZES = [9, 11, 12, 13, 14, 15, 17, 20, 24, 28, 40, 56];
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.4;
export const fontScaleOf = v => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n)) : 1;
};
export function applyFontScale(v) {
  const root = document.documentElement;
  const k = fontScaleOf(v);
  FONT_SIZES.forEach(n => {
    if (k === 1) root.style.removeProperty(`--fs-${n}`);
    else root.style.setProperty(`--fs-${n}`, `${Math.round(n * k * 10) / 10}px`);
  });
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

// 上传时裁不裁四周的透明边。默认裁；想保留留白的在换图标那张表里关掉。
// 自己主屏、角色手机的图标、批量更换都照这一项（全局一项，不按图标分）
export const autoTrim = () => settings.get().iconTrim !== false;
export const setAutoTrim = on => settings.set({ iconTrim: !!on });

// 存之前先裁掉四周的透明边（images.compressFit 的 trim），关了就整张原样放
export async function setAppIconFile(appId, file) {
  const id = await images.putIcon(file, ICON_MAX, { trim: autoTrim() });
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

/**
 * 已经存着的那张重新裁一遍透明边。给回有没有变：本来就贴边的不动。
 * 换进来的是新图、新 id，旧的那张删掉
 */
export async function trimAppIcon(appId) {
  const old = iconOverride(appId).imageId;
  if (!old) return false;
  const blob = await images.blob(old);
  if (!blob || !(await hasPadding(blob))) return false;
  const id = await images.putIcon(blob, ICON_MAX, { trim: true });
  setAppIcon(appId, { imageId: id });
  images.remove(old);
  return true;
}

/** 图片在格子里占多大，百分数。100 是整格；空着按 100 算 */
export const ICON_SCALE = { min: 50, max: 160, def: 100 };
export function setAppIconScale(appId, pct) {
  const n = Math.round(Number(pct) || ICON_SCALE.def);
  setAppIcon(appId, { scale: n === ICON_SCALE.def ? undefined : Math.max(ICON_SCALE.min, Math.min(ICON_SCALE.max, n)) });
}

export function clearAppIconImage(appId) {
  const old = iconOverride(appId).imageId;
  if (old) images.remove(old);
  setAppIcon(appId, { imageId: null });
}
