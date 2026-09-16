import { settings } from './db/index.js';
import { getApp, listApps } from './registry.js';

export const TILE_SHADES = ['tile-1', 'tile-2', 'tile-3', 'tile-4',
                            'tile-5', 'tile-6', 'tile-7', 'tile-8'];

// app 的外观 = manifest 默认值 叠加 用户在设置里的自定义
export function appLook(appId) {
  const app = getApp(appId);
  if (!app) return null;
  const custom = (settings.get().appIcons || {})[appId] || {};
  return {
    ...app,
    icon: custom.icon || app.icon,
    accent: custom.tile ? `var(--${custom.tile})` : app.accent,
  };
}

export function listAppLooks() {
  return listApps().map(a => appLook(a.id));
}
