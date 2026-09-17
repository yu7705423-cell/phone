import { settings, layout, images, looks } from './db/index.js';

// 外观预设：把整套装修拍个快照存起来，随时切回去。
// 存的是「壁纸、图标图片、图标位置、挂件、主题参数」这一整套，
// 不碰角色、聊天记录这些内容数据。

export { looks };

// settings 里属于外观的那些字段。别把接口密钥、prompt 模板这些一起拍进来。
const LOOK_KEYS = [
  'theme', 'appIcons', 'iconColor', 'iconShadow', 'iconLabels',
  'bottomLift', 'customCSS', 'statusBar', 'showLockScreen',
];

function pick(obj, keys) {
  const out = {};
  keys.forEach(k => { if (obj[k] !== undefined) out[k] = structuredClone(obj[k]); });
  return out;
}

export function snapshot() {
  return {
    look: pick(settings.get(), LOOK_KEYS),
    layout: structuredClone(layout.get()),
  };
}

// 这套预设用到了哪些图片。清理无引用图片时要认得它们，
// 否则一清理，存好的预设就全成了空壳。
export function imageIdsOf(item) {
  const out = new Set();
  const w = item?.layout?.wallpaper || {};
  if (w.home) out.add(w.home);
  if (w.lock) out.add(w.lock);
  Object.values(item?.look?.appIcons || {}).forEach(v => { if (v?.imageId) out.add(v.imageId); });
  // 挂件里的图片块也存了 imageId
  (item?.layout?.pages || []).forEach(p =>
    (p.cells || []).forEach(c => { if (c.config?.imageId) out.add(c.config.imageId); }));
  return out;
}

export function allImageIds() {
  const out = new Set();
  looks.all().forEach(item => imageIdsOf(item).forEach(id => out.add(id)));
  return out;
}

export function save(name) {
  const snap = snapshot();
  return looks.create({ name: name || '未命名', ...snap });
}

// 用当前的样子覆盖掉一个已有预设
export function update(id) {
  const snap = snapshot();
  return looks.update(id, snap);
}

export function apply(id) {
  const item = looks.get(id);
  if (!item) throw new Error('预设不在了');
  // 缺图的话不要把界面搞成空白：图没了就当没设过
  const missing = [];
  const lay = structuredClone(item.layout || {});
  const w = lay.wallpaper || (lay.wallpaper = {});
  ['home', 'lock'].forEach(k => {
    if (w[k] && !images.has(w[k])) { missing.push(w[k]); w[k] = null; }
  });
  const look = structuredClone(item.look || {});
  const icons = look.appIcons || {};
  Object.keys(icons).forEach(appId => {
    const id2 = icons[appId]?.imageId;
    if (id2 && !images.has(id2)) { missing.push(id2); icons[appId] = { ...icons[appId], imageId: null }; }
  });

  settings.set(look);
  layout.replace({ ...layout.get(), ...lay });
  return { missing: missing.length };
}

export function rename(id, name) { return looks.update(id, { name: name || '未命名' }); }
export function remove(id) { return looks.remove(id); }
