import { idb, write } from './idb.js';
import { uid } from '../store.js';

// 图片一律以 Blob 存 IndexedDB,不存 base64。见 ARCHITECTURE 3.7
const urls = new Map();   // id -> objectURL
const sizes = new Map();  // id -> bytes

export const AVATAR_MAX = 256;
export const PHOTO_MAX = 1280;
const QUALITY = 0.82;

export async function compress(file, maxEdge = PHOTO_MAX) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', QUALITY))
    || await new Promise(res => canvas.toBlob(res, 'image/jpeg', QUALITY));
  return { blob, w, h };
}

export const images = {
  async load() {
    const rows = await idb.all('images');
    rows.forEach(r => sizes.set(r.id, r.bytes || 0));
  },

  async put(file, maxEdge = PHOTO_MAX) {
    const { blob, w, h } = await compress(file, maxEdge);
    const row = { id: uid('img'), blob, w, h, bytes: blob.size, createdAt: Date.now() };
    sizes.set(row.id, row.bytes);
    await write('images', () => idb.put('images', row));
    urls.set(row.id, URL.createObjectURL(blob));
    return row.id;
  },

  // 同步取已缓存的 URL,没有则返回 null 并在后台加载
  peek(id) { return id ? urls.get(id) || null : null; },

  async url(id) {
    if (!id) return null;
    if (urls.has(id)) return urls.get(id);
    const row = await idb.get('images', id);
    if (!row) return null;
    const u = URL.createObjectURL(row.blob);
    urls.set(id, u);
    return u;
  },

  remove(id) {
    const u = urls.get(id);
    if (u) { URL.revokeObjectURL(u); urls.delete(id); }
    sizes.delete(id);
    return write('images', () => idb.del('images', id));
  },

  totalBytes() { return [...sizes.values()].reduce((a, b) => a + b, 0); },
  count() { return sizes.size; },
  ids() { return [...sizes.keys()]; },

  // 释放所有 objectURL。整页卸载时调用
  revokeAll() {
    urls.forEach(u => URL.revokeObjectURL(u));
    urls.clear();
  },
};
