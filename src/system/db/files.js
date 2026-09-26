import { idb, write } from './idb.js';
import { uid } from '../store.js';
import { registerBlobCache, solidBlob } from './blobs.js';

// 任意二进制附件（目前是语音）。图片走 images，那边会压缩，音频不能压。
const urls = new Map();
const meta = new Map();
registerBlobCache({
  sample: () => urls.values().next().value || null,
  owns: u => [...urls.values()].includes(u),
  reset: () => urls.clear(),
});
const meta_set = row => meta.set(row.id, { type: row.type, bytes: row.bytes, name: row.name });

export const files = {
  async load() {
    const rows = await idb.all('files');
    rows.forEach(r => meta.set(r.id, { type: r.type, bytes: r.bytes, name: r.name }));
  },

  async put(blob, { name = '', type = '' } = {}) {
    const row = {
      id: uid('f'), blob, name,
      type: type || blob.type || 'application/octet-stream',
      bytes: blob.size, createdAt: Date.now(),
    };
    meta.set(row.id, { type: row.type, bytes: row.bytes, name });
    await write('files', () => idb.put('files', row));
    urls.set(row.id, URL.createObjectURL(blob));
    return row.id;
  },

  /** 按原来的 id 放回去。只有恢复备份会用到，理由同 images.putRaw。 */
  async putRaw(id, raw, meta = {}) {
    if (!id || !raw) return null;
    // 切片先抄成独立的 Blob（4.273）
    const blob = await solidBlob(raw);
    const row = {
      id, blob, name: meta.name || '',
      type: meta.type || blob.type || 'application/octet-stream',
      bytes: blob.size, createdAt: meta.createdAt || Date.now(),
    };
    meta_set(row);
    await write('files', () => idb.put('files', row));
    const old = urls.get(id);
    if (old) { URL.revokeObjectURL(old); urls.delete(id); }
    return id;
  },

  peek(id) { return id ? urls.get(id) || null : null; },

  async url(id) {
    if (!id) return null;
    if (urls.has(id)) return urls.get(id);
    const row = await idb.get('files', id);
    if (!row) return null;
    const u = URL.createObjectURL(row.blob);
    urls.set(id, u);
    return u;
  },

  async blob(id) {
    const row = await idb.get('files', id);
    return row ? row.blob : null;
  },

  info(id) { return meta.get(id) || null; },

  remove(id) {
    const u = urls.get(id);
    if (u) { URL.revokeObjectURL(u); urls.delete(id); }
    meta.delete(id);
    return write('files', () => idb.del('files', id));
  },

  totalBytes() { return [...meta.values()].reduce((a, b) => a + (b.bytes || 0), 0); },
  count() { return meta.size; },
  ids() { return [...meta.keys()]; },
  /** 每个文件一行：id 与那三项。存储页要按大小列出来，光有 ids 不够 */
  list() { return [...meta.entries()].map(([id, m]) => ({ id, ...m })); },
};

// 让用户把单条语音存到本地
export async function download(id, filename) {
  const blob = await files.blob(id);
  if (!blob) throw new Error('这段音频已经不在了');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${id}.mp3`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
