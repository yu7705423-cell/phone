import { idb, write } from './idb.js';
import { uid } from '../store.js';
import { registerBlobCache } from './blobs.js';

// 图片一律以 Blob 存 IndexedDB,不存 base64。见 ARCHITECTURE 3.7
const urls = new Map();       // id -> objectURL（原图）
const thumbUrls = new Map();  // id -> objectURL（缩略图）
const sizes = new Map();      // id -> bytes

export const AVATAR_MAX = 256;
export const PHOTO_MAX = 1280;
export const ICON_MAX = 256;
const QUALITY = 0.82;

// 缩略图。列表里画的一律是这一张，原图只在需要原图的地方用。
// 气泡最宽 200 逻辑像素，却要把 1280 的原图整个解码成位图，一屏十几张
// 就是几十兆内存，滚动时反复解。640 在三倍屏上够用，像素数只有四分之一。
export const THUMB_MAX = 640;

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

// 地址失效后整体换新（见 blobs.js）。不 revoke：失效的本来就作废了，
// 没失效的可能还画在屏幕上，等 hook 换上新地址自然没人再用
registerBlobCache({
  sample: () => urls.values().next().value || thumbUrls.values().next().value || null,
  owns: u => [...urls.values()].includes(u) || [...thumbUrls.values()].includes(u),
  reset: () => { urls.clear(); thumbUrls.clear(); },
});

// 够小的就不另存一张：缩略图和原图一样大，白占一份空间。
const wantThumb = (w, h) => Math.max(w || 0, h || 0) > THUMB_MAX;

// 老图第一次用到时现做一张存回去。按 id 去重，不然一屏里做十几遍。
const making = new Map();
function makeThumb(row) {
  if (making.has(row.id)) return making.get(row.id);
  const job = (async () => {
    if (!wantThumb(row.w, row.h)) {
      // 本来就小。记下来，省得每次打开这一页都再问一遍
      await write('images', () => idb.put('images', { ...row, thumb: null, noThumb: true }));
      return null;
    }
    const { blob, w, h } = await compress(row.blob, THUMB_MAX);
    const next = { ...row, thumb: blob, tw: w, th: h, bytes: row.blob.size + blob.size };
    sizes.set(row.id, next.bytes);
    await write('images', () => idb.put('images', next));
    return blob;
  })().catch(() => null).finally(() => making.delete(row.id));
  making.set(row.id, job);
  return job;
}

let usage = null;
let pending = [];
let pendingTimer = null;
function sweep() {
  const batch = pending;
  pending = [];
  pendingTimer = null;
  let used = null;
  try { used = usage ? usage() : null; } catch (err) { console.error('[images] 引用表算不出来，这一批不删', err); }
  batch.forEach(({ id, done }) => {
    if (!used || used.has(id)) { done(false); return; }
    images.destroy(id).then(() => done(true), () => done(false));
  });
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
    // 当场做好。等第一次显示再做，那一下正是列表在滚的时候
    if (wantThumb(w, h)) {
      const t = await compress(blob, THUMB_MAX);
      row.thumb = t.blob; row.tw = t.w; row.th = t.h;
      row.bytes = blob.size + t.blob.size;
      thumbUrls.set(row.id, URL.createObjectURL(t.blob));
    } else {
      row.noThumb = true;
    }
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
    // 缩略图不进备份，第一次用到时再现做
    const oldThumb = thumbUrls.get(id);
    if (oldThumb) { URL.revokeObjectURL(oldThumb); thumbUrls.delete(id); }
    return id;
  },

  // 同步取已缓存的 URL,没有则返回 null 并在后台加载
  peek(id) { return id ? urls.get(id) || null : null; },

  // 缩略图那一份。没有缩略图（图本来就小）就退回原图，调用方不必分情况
  peekThumb(id) { return id ? thumbUrls.get(id) || urls.get(id) || null : null; },

  async thumbUrl(id) {
    if (!id) return null;
    if (thumbUrls.has(id)) return thumbUrls.get(id);
    const row = await idb.get('images', id);
    if (!row) return null;
    if (row.noThumb) return this.url(id);
    const blob = row.thumb || await makeThumb(row);
    if (!blob) return this.url(id);
    if (thumbUrls.has(id)) return thumbUrls.get(id);
    const u = URL.createObjectURL(blob);
    thumbUrls.set(id, u);
    return u;
  },

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

  /**
   * 不再用这张图了：**没有别处在用才删**。
   *
   * 同一个 id 常被几处共用：外观预设存的是当时的壁纸与图标 id，角色的头像从头像池里挑，
   * 「保存到相册」存的是消息那一张。从前换一张壁纸就把旧 id 直接删掉，存着它的预设随之成了空壳，
   * 头像池里被挑中过的那张也跟着没了。
   *
   * 所以这里只登记，到下一个宏任务再按引用表（purge.usedImageIds）核一遍：调用方通常先 remove
   * 旧的、再把新 id 写上去，等这一轮同步代码跑完，引用表才是换过之后的样子。
   * 同一轮登记的多张一起核，引用表只算一次。不知道谁在用（引用表没登记上）就一张都不删。
   * 确定要删的（恢复备份前清空、清理无引用）用 destroy。
   */
  remove(id) {
    if (!id) return Promise.resolve(false);
    return new Promise(done => {
      pending.push({ id, done });
      if (!pendingTimer) pendingTimer = setTimeout(sweep, 0);
    });
  },

  /** 谁在用哪些图。purge.js 在加载时登记，images 这一层不去读各个数据域 */
  setUsage(fn) { usage = fn; },

  /** 直接删，不看有没有别处在用 */
  destroy(id) {
    const u = urls.get(id);
    if (u) { URL.revokeObjectURL(u); urls.delete(id); }
    const t = thumbUrls.get(id);
    if (t) { URL.revokeObjectURL(t); thumbUrls.delete(id); }
    sizes.delete(id);
    return write('images', () => idb.del('images', id));
  },

  has(id) { return !!id && sizes.has(id); },
  totalBytes() { return [...sizes.values()].reduce((a, b) => a + b, 0); },
  count() { return sizes.size; },
  ids() { return [...sizes.keys()]; },

};
