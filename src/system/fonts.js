import { settings } from './db/index.js';
import { files } from './db/files.js';

// 自定义字体。字体文件存进 files 域（二进制，不压缩），
// 用 FontFace 直接喂 ArrayBuffer 注册 —— 比 blob URL 稳，
// 不用猜 format()，woff2 / woff / ttf / otf 一视同仁。

export const ACCEPT = '.ttf,.otf,.woff,.woff2,font/*,application/font-woff,application/x-font-ttf';

const loaded = new Map();   // 记录 id -> FontFace，避免重复注册

export function list() {
  return settings.get().fonts || [];
}

export function get(id) {
  return list().find(f => f.id === id) || null;
}

// family 名用记录 id，保证唯一，不会和系统里同名字体打架
export const familyOf = id => `uf-${id}`;

export async function ensureLoaded(id) {
  if (!id || loaded.has(id)) return loaded.get(id) || null;
  const rec = get(id);
  if (!rec) return null;
  const blob = await files.blob(rec.fileId);
  if (!blob) throw new Error('字体文件不见了');
  const face = new FontFace(familyOf(id), await blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  loaded.set(id, face);
  return face;
}

function stackFor(id, fallbackVar) {
  return id ? `${familyOf(id)}, ${fallbackVar}` : fallbackVar;
}

// 把当前选中的字体应用到两个槽位。没选就用回令牌里的默认值。
export async function apply(s = settings.get()) {
  const root = document.documentElement;
  const jobs = [];

  const slot = (id, prop, fallback) => {
    if (!id || !get(id)) { root.style.removeProperty(prop); return; }
    // 先设上去，加载完之前浏览器自己会回落到后面的系统字体，不会白屏
    root.style.setProperty(prop, stackFor(id, fallback));
    jobs.push(ensureLoaded(id).catch(err => {
      console.warn('[fonts] 装不上:', err.message || err);
      root.style.removeProperty(prop);
    }));
  };

  slot(s.fontBody, '--font',
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
  slot(s.fontSerif, '--font-serif',
    '"Songti SC", "Times New Roman", Georgia, serif');

  await Promise.all(jobs);
}

export async function add(file) {
  const name = (file.name || '字体').replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '');
  const buf = await file.arrayBuffer();
  // 先验一遍能不能用，别把坏文件存进去
  const probe = new FontFace('uf-probe', buf);
  try {
    await probe.load();
  } catch {
    throw new Error('这个文件解析不出字体，换一个 ttf / otf / woff / woff2');
  }
  const fileId = await files.put(file, { name: file.name, type: file.type || 'font/ttf' });
  const rec = { id: 'fnt-' + Date.now().toString(36), name, fileId, bytes: file.size };
  settings.set({ fonts: [...list(), rec] });
  return rec;
}

export async function remove(id) {
  const rec = get(id);
  if (!rec) return;
  const s = settings.get();
  const patch = { fonts: list().filter(f => f.id !== id) };
  // 正在用就先摘下来，否则界面会指向一个不存在的字体
  if (s.fontBody === id) patch.fontBody = '';
  if (s.fontSerif === id) patch.fontSerif = '';
  settings.set(patch);
  loaded.delete(id);
  await files.remove(rec.fileId);
  await apply();
}

export function rename(id, name) {
  settings.set({ fonts: list().map(f => f.id === id ? { ...f, name: name || f.name } : f) });
}
