import { stickers, images, settings } from './db/index.js';
import { readZip } from './unzip.js';
import { fetchBlob } from './imghost.js';

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

/**
 * 外链在这个页面上能用的写法：页面是 https 时，http 的图一律被浏览器当混合内容拦下，
 * 换成 https 再试（大多数图床两种都通）。页面本身是 http（本地调试）就原样不动
 */
export function displayUrl(url, secure = (typeof location !== 'undefined' && location.protocol === 'https:')) {
  const u = String(url || '').trim();
  return secure && /^http:\/\//i.test(u) ? u.replace(/^http:/i, 'https:') : u;
}

// 把远程表情缓存到本地。走图床那边的取图（imghost.fetchBlob）：配了中转 Worker 就经中转，
// 能绕开跨域与防盗链；没配就直接取，不带 Referer。取不回来的原样保留链接，原因记在 why 里（4.284）
export async function cacheRemote(list, onProgress) {
  let ok = 0, fail = 0;
  const why = new Map();
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    onProgress && onProgress(i + 1, list.length);
    if (!s.url || s.imageId) continue;
    const r = await fetchBlob(displayUrl(s.url));
    if (!r.ok) { fail++; why.set(r.error || '取回失败', (why.get(r.error || '取回失败') || 0) + 1); continue; }
    try {
      const file = new File([r.blob], `${s.name}.png`, { type: r.blob.type || 'image/png' });
      const imageId = await images.put(file, 512);
      stickers.update(s.id, { imageId });
      ok++;
    } catch (err) { fail++; why.set(String(err.message || err), (why.get(String(err.message || err)) || 0) + 1); }
  }
  return { ok, fail, why: [...why.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} × ${n}`) };
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

// ---- 分组 ----
//
// 分组本来是**从表情身上折出来的**：谁的 group 字段写着什么，就有哪几个组。
// 折出来的东西有一个毛病 —— **空的组不存在**。想先建一个组、再往里放几个，
// 建完那一下屏幕上什么也没发生，因为组里还没有表情，它就折不出来。
//
// 所以自己建的那几个名字单独存一份（settings.stickerGroups），列出来时
// 两边取并集。表情自带的那些不必存：它们本来就折得出来，存了反而要管两处。

const saved = () => (settings.get().stickerGroups || [])
  .map(x => String(x || '').trim()).filter(Boolean);

/** 建一个空分组。已经有了就当建过，返回规范化之后的名字。 */
export function addGroup(name) {
  const g = String(name || '').trim().slice(0, 20);
  if (!g) return '';
  const list = saved();
  if (!list.includes(g) && g !== DEFAULT_GROUP) settings.set({ stickerGroups: [...list, g] });
  return g;
}

/** 把这个名字从自己建的那一份里划掉。组里的表情由调用方处置。 */
export function removeGroup(name) {
  const g = String(name || '').trim();
  const list = saved();
  if (list.includes(g)) settings.set({ stickerGroups: list.filter(x => x !== g) });
}

/** 改名。组里的表情跟着走，自己建的那一份里也改掉。 */
export function renameGroup(from, to) {
  const a = String(from || '').trim();
  const b = String(to || '').trim().slice(0, 20);
  if (!a || !b || a === b) return a;
  inGroup(a).forEach(s => stickers.update(s.id, { group: b }));
  const list = saved();
  if (list.includes(a) || a !== DEFAULT_GROUP) {
    settings.set({ stickerGroups: [...new Set([...list.filter(x => x !== a), b])] });
  }
  return b;
}

/**
 * 列出分组。
 *
 * `onlyUsed` 为真时只给真的有表情的那几个 —— 发送面板上摆一个空标签页，
 * 点进去什么也没有，那是管理页才该看见的东西。
 */
export function groups({ onlyUsed = false } = {}) {
  const set = new Set(stickers.all().map(s => (s.group || '').trim() || DEFAULT_GROUP));
  if (!onlyUsed) saved().forEach(g => set.add(g));
  return [...set].sort((a, b) => a === DEFAULT_GROUP ? -1 : b === DEFAULT_GROUP ? 1 : a.localeCompare(b, 'zh'));
}

/** 这个表情属于哪个组。空的一律算默认组 —— 各处都这么折，一处定义。 */
export const groupOf = s => (s?.group || '').trim() || DEFAULT_GROUP;

/**
 * 列给模型时它叫什么。
 *
 * **重名的要带上分组。** 两套表情包都有「开心」时，名单里出现两个「开心」，
 * 模型挑哪个都是同一个字，而 `byName` 只会返回先建的那一个 ——
 * 后加的那一组里凡是重名的，角色一个都发不出来。
 * 这正是「一个分组能用、另一个不能用」的由来。
 *
 * 不重名的照旧只写名字：绝大多数表情不重名，给每一个都缀上分组只是把
 * 名单撑长，而名单是要占 token 的。
 */
export function labelOf(s, dupes) {
  const name = String(s?.name || '').trim();
  if (!name) return '';
  const set = dupes || dupeNames();
  return set.has(normalizeName(name)) ? `${name}（${groupOf(s)}）` : name;
}

/** 哪些名字不止一个表情在用。归一之后再比，「开心」和「开心.png」算同一个。 */
export function dupeNames() {
  const seen = new Map();
  for (const s of stickers.all()) {
    const k = normalizeName(s.name);
    if (!k) continue;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * 角色发不出来的那些。表情管理页拿它摆出来。
 *
 * 判据只有一条：**拿它自己的名字去找，找不找得回它自己。** 找不回来的，
 * 角色写对了名字也发不出去 —— 发出去的是另一个，或者干脆没有。
 */
export function unreachable() {
  const dupes = dupeNames();
  const out = [];
  for (const s of stickers.all()) {
    const name = String(s.name || '').trim();
    if (!name) { out.push({ id: s.id, name: '', group: groupOf(s), why: '没有名称' }); continue; }
    const back = byName(labelOf(s, dupes));
    if (back?.id === s.id) continue;
    out.push({
      id: s.id, name, group: groupOf(s),
      why: back ? `与「${back.name}」（${groupOf(back)}）重名，会发成那一个` : '按名称找不到',
    });
  }
  return out;
}

export function inGroup(group) {
  return stickers.all()
    .filter(s => ((s.group || '').trim() || DEFAULT_GROUP) === group)
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0) || (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * 名字对名字之前先抹平这几样。
 *
 * **两边看着一模一样、比起来却不等**，是这一步最常见的死法：
 *
 *   全角与半角     `（笑）` 与 `(笑)`、`：` 与 `:`
 *   零宽字符       从网页或文档里复制过来的名字里常夹着 U+200B、U+FEFF
 *   扩展名         `开心.png`，从文件名生成的名字带着它
 *   包裹的符号     模型爱写成 `「开心」`、`"开心"`、`[开心]`
 *   中间的空白     `开心  1` 与 `开心 1`
 *
 * 一个都不抹平，看见的就是「名字明明一样却找不到」。
 */
export function normalizeName(text) {
  return String(text || '')
    .normalize('NFKC')                       // 全角转半角，兼容字形归一
    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // 零宽
    .replace(/\.(png|jpe?g|gif|webp|bmp|apng)$/i, '')
    .replace(/^[\s"'`「『【\[(（]+|[\s"'`」』】\])）]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 角色写 [表情：名字] 时按名字找。
 *
 * 四级：抹平之后精确对、关键词对、去掉所有空白再对、最后才是包含匹配。
 * 一个字的名字不做包含匹配，否则「哦」能匹上一半的表情。
 *
 * **找不到不是世界末日**：气泡上会写出它想发的是哪个名字，点一下就能自己
 * 指认（见会话页），指认完那个名字会记成关键词，下次自己就对上了。
 */
export function byName(name) {
  const raw = String(name || '');
  const all = stickers.all();

  // 「开心（猫猫）」这种：两个分组里有重名时，名单里给的就是这个形状，
  // 不然模型没法说清要哪一个（见 groupOf 与 labelOf）
  const m = raw.match(/^(.+?)\s*[（(]([^（()）]+)[)）]\s*$/);
  if (m) {
    const want = normalizeName(m[1]);
    const g = normalizeName(m[2]);
    const hit = want && all.find(s => normalizeName(s.name) === want
      && normalizeName(groupOf(s)) === g);
    if (hit) return hit;
  }

  const q = normalizeName(name);
  if (!q) return null;
  const nameOf = s => normalizeName(s.name);
  const bare = t => t.replace(/\s+/g, '');
  return all.find(s => nameOf(s) === q)
    || all.find(s => (s.keywords || []).some(k => normalizeName(k) === q))
    || all.find(s => bare(nameOf(s)) === bare(q))
    || (q.length >= 2
      ? all.find(s => nameOf(s).length >= 2 && (nameOf(s).includes(q) || q.includes(nameOf(s))))
      : null)
    || null;
}

/**
 * 把模型写的这个名字记到某个表情上，当关键词。
 *
 * 手动指认之后叫一次：**下一回它再写同一个名字就自己对上了**，
 * 不必每次都来指认一遍。
 */
export function learnName(stickerId, name) {
  const s = stickers.get(stickerId);
  const raw = String(name || '').trim();
  if (!s || !raw) return null;
  const has = [...(s.keywords || []), s.name].some(k => normalizeName(k) === normalizeName(raw));
  if (has) return s;
  return stickers.update(stickerId, { keywords: [...(s.keywords || []), raw].slice(0, 12) });
}

export function markUsed(id) {
  const s = stickers.get(id);
  if (s) stickers.update(id, { useCount: (s.useCount || 0) + 1 });
}
