import { stickers, images } from './db/index.js';
import { readZip } from './unzip.js';

export const DEFAULT_GROUP = '默认';

// ---- 解析 ----
const URL_RE = /(https?:\/\/[^\s|,，、"'<>）)]+)/i;

// 一行可能是：名称|链接 / 名称,链接 / 名称 链接 / 只有链接
export function parseLine(line) {
  const text = String(line || '').trim();
  if (!text || text.startsWith('#')) return null;

  const m = text.match(URL_RE);
  if (!m) return null;
  const url = m[1];
  const rest = (text.slice(0, m.index) + text.slice(m.index + url.length))
    .replace(/[|,，、\t]+/g, ' ').trim();

  const name = rest || decodeURIComponent(url.split('/').pop() || '').replace(/\.\w+$/, '');
  return { name: name.slice(0, 40), keywords: splitKeywords(rest), url };
}

export function splitKeywords(text) {
  return String(text || '')
    .split(/[|,，、\s]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function parseText(content) {
  return String(content || '').split(/\r?\n/).map(parseLine).filter(Boolean);
}

// docx 就是 zip：正文文本按行解析，内嵌图片单独收集
export async function parseDocx(file) {
  const zip = await readZip(file);
  const xml = await zip.text('word/document.xml');
  const rows = [];

  if (xml) {
    // 每个 <w:p> 是一段，段内的 <w:t> 拼起来就是这一行的文字
    const paras = xml.split(/<w:p[\s>]/).slice(1);
    for (const para of paras) {
      const text = (para.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
        .map(t => t.replace(/<[^>]+>/g, ''))
        .join('')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const row = parseLine(text);
      if (row) rows.push(row);
    }
    // 文档里的外部超链接也算
    const rels = await zip.text('word/_rels/document.xml.rels');
    if (rels) {
      for (const m of rels.matchAll(/Target="(https?:[^"]+)"/g)) {
        const url = m[1];
        if (!rows.some(r => r.url === url)) {
          rows.push({ name: decodeURIComponent(url.split('/').pop() || '').replace(/\.\w+$/, ''), keywords: [], url });
        }
      }
    }
  }

  const media = zip.list('word/media/').filter(e => /\.(png|jpe?g|gif|webp|bmp)$/i.test(e.name));
  const blobs = [];
  for (const e of media) {
    const blob = await zip.blob(e.name);
    if (blob) blobs.push({ name: e.name.split('/').pop().replace(/\.\w+$/, ''), blob });
  }
  return { rows, blobs };
}

// ---- 入库 ----
export function addFromUrl({ name, keywords, url, group }) {
  return stickers.create({
    name: name || '未命名',
    keywords: keywords && keywords.length ? keywords : splitKeywords(name),
    url, imageId: null,
    group: group || DEFAULT_GROUP,
    useCount: 0,
  });
}

export async function addFromBlob({ name, keywords, blob, group }) {
  const file = blob instanceof File ? blob : new File([blob], `${name || 'sticker'}.png`, { type: blob.type || 'image/png' });
  const imageId = await images.put(file, 512);
  return stickers.create({
    name: name || '未命名',
    keywords: keywords && keywords.length ? keywords : splitKeywords(name),
    url: null, imageId,
    group: group || DEFAULT_GROUP,
    useCount: 0,
  });
}

// 把远程表情缓存到本地。跨域取不回来的原样保留链接。
export async function cacheRemote(list, onProgress) {
  let ok = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    onProgress && onProgress(i + 1, list.length);
    if (!s.url || s.imageId) continue;
    try {
      const res = await fetch(s.url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], `${s.name}.png`, { type: blob.type || 'image/png' });
      const imageId = await images.put(file, 512);
      stickers.update(s.id, { imageId });
      ok++;
    } catch { fail++; }
  }
  return { ok, fail };
}

// ---- 匹配 ----
// 输入框里打字时按名称和关键词推荐
export function suggest(text, limit = 12) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return [];
  const all = stickers.all();
  const scored = [];
  for (const s of all) {
    const name = (s.name || '').toLowerCase();
    const kws = (s.keywords || []).map(k => String(k).toLowerCase());
    let score = -1;
    if (name === q || kws.includes(q)) score = 0;
    else if (name.startsWith(q) || kws.some(k => k.startsWith(q))) score = 1;
    else if (name.includes(q) || kws.some(k => k.includes(q))) score = 2;
    else if (q.length >= 2 && (q.includes(name) && name.length >= 2)) score = 3;
    if (score >= 0) scored.push([score, -(s.useCount || 0), s]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map(x => x[2]);
}

export function groups() {
  const set = new Set(stickers.all().map(s => (s.group || '').trim() || DEFAULT_GROUP));
  return [...set].sort((a, b) => a === DEFAULT_GROUP ? -1 : b === DEFAULT_GROUP ? 1 : a.localeCompare(b, 'zh'));
}

export function inGroup(group) {
  return stickers.all()
    .filter(s => ((s.group || '').trim() || DEFAULT_GROUP) === group)
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0) || (b.createdAt || 0) - (a.createdAt || 0));
}

export function markUsed(id) {
  const s = stickers.get(id);
  if (s) stickers.update(id, { useCount: (s.useCount || 0) + 1 });
}
