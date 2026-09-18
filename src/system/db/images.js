import { idb, write } from './idb.js';
import { uid } from '../store.js';

// 图片一律以 Blob 存 IndexedDB,不存 base64。见 ARCHITECTURE 3.7
const urls = new Map();   // id -> objectURL
const sizes = new Map();  // id -> bytes

export const AVATAR_MAX = 256;
export const PHOTO_MAX = 1280;
export const ICON_MAX = 256;
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

// 整张图完整放进正方形画布，留白透明。用于应用图标。
// 不做居中裁切：宽图被裁掉两边就只剩中间一小块，什么都看不出来。
export async function compressFit(file, size = ICON_MAX) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(size / bmp.width, size / bmp.height);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bmp, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  bmp.close && bmp.close();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', QUALITY))
    || await new Promise(res => canvas.toBlob(res, 'image/png'));
  return { blob, w: size, h: size };
}

export const images = {
  async load() {
    const rows = await idb.all('images');
    rows.forEach(r => sizes.set(r.id, r.bytes || 0));
  },

  async putIcon(file, size = ICON_MAX) {
    const { blob, w, h } = await compressFit(file, size);
    const row = { id: uid('img'), blob, w, h, bytes: blob.size, createdAt: Date.now() };
    sizes.set(row.id, row.bytes);
    await write('images', () => idb.put('images', row));
    urls.set(row.id, URL.createObjectURL(blob));
    return row.id;
  },

  async put(file, maxEdge = PHOTO_MAX) {
    const { blob, w, h } = await compress(file, maxEdge);
    const row = { id: uid('img'), blob, w, h, bytes: blob.size, createdAt: Date.now() };
    sizes.set(row.id, row.bytes);
    await write('images', () => idb.put('images', row));
    urls.set(row.id, URL.createObjectURL(blob));
    return row.id;
  },

  /**
   * 按**原来的 id** 放一张回去。只有恢复备份会用到。
   *
   * 不走 put：那边会重新压一遍并发一个新 id，而消息、角色卡里存的是旧 id，
   * 换了就全对不上。这里原样写回去，压缩在当初导出之前就已经做过了。
   */
  async putRaw(id, blob, meta = {}) {
    if (!id || !blob) return null;
    const row = {
      id, blob, w: meta.w || 0, h: meta.h || 0,
      bytes: blob.size, createdAt: meta.createdAt || Date.now(),
    };
    sizes.set(id, row.bytes);
    await write('images', () => idb.put('images', row));
    const old = urls.get(id);
    if (old) { URL.revokeObjectURL(old); urls.delete(id); }
    return id;
  },

  // 同步取已缓存的 URL,没有则返回 null 并在后台加载
  peek(id) { return id ? urls.get(id) || null : null; },

  // 原始 Blob。识图要把它读成 dataURL 发出去
  async blob(id) {
    if (!id) return null;
    const row = await idb.get('images', id);
    return row ? row.blob : null;
  },

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

  has(id) { return !!id && sizes.has(id); },
  totalBytes() { return [...sizes.values()].reduce((a, b) => a + b, 0); },
  count() { return sizes.size; },
  ids() { return [...sizes.keys()]; },

  // 释放所有 objectURL。整页卸载时调用
  revokeAll() {
    urls.forEach(u => URL.revokeObjectURL(u));
    urls.clear();
  },
};
