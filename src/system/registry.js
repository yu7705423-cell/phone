import { createStore } from './store.js';

const apps = new Map();
const widgets = new Map();
export const registryStore = createStore({ v: 0 });

const REQUIRED = ['id', 'name', 'icon', 'entry'];

function validate(m) {
  const problems = [];
  REQUIRED.forEach(k => { if (!m[k]) problems.push(`缺少 ${k}`); });
  if (m.id && apps.has(m.id)) problems.push(`id 重复: ${m.id}`);
  if (m.entry && typeof m.entry !== 'function') problems.push('entry 必须是返回 import() 的函数');
  return problems;
}

export function registerApp(manifest) {
  const problems = validate(manifest);
  if (problems.length) {
    console.error(`[registry] app 注册失败 (${manifest?.id || '未知'}):`, problems.join('; '));
    return false;
  }
  apps.set(manifest.id, {
    permissions: [],
    showOnHome: true,
    ...manifest,
  });
  registryStore.set({ v: registryStore.get().v + 1 });
  return true;
}

export function registerWidget(spec) {
  if (!spec?.id || typeof spec.render !== 'function') {
    console.error('[registry] 挂件注册失败', spec?.id);
    return false;
  }
  widgets.set(spec.id, { sizes: [[2, 2]], editable: false, ...spec });
  registryStore.set({ v: registryStore.get().v + 1 });
  return true;
}

export const getApp = id => apps.get(id) || null;
export const listApps = () => [...apps.values()];
export const hasApp = id => apps.has(id);
export const getWidget = id => widgets.get(id) || null;
export const listWidgets = () => [...widgets.values()];
export const hasWidget = id => widgets.has(id);

// 懒加载缓存
const loaded = new Map();
export function loadApp(id) {
  if (loaded.has(id)) return loaded.get(id);
  const app = apps.get(id);
  if (!app) return Promise.reject(new Error(`未注册的 app: ${id}`));
  const p = app.entry().then(mod => mod.default || mod.App).catch(err => {
    loaded.delete(id);
    throw err;
  });
  loaded.set(id, p);
  return p;
}
