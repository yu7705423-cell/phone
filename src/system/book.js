import { ebooks, files, images } from './db/index.js';
import { unzip } from './zip.js';

// 书。txt 与 epub 读成一段纯文本 + 一张章节表，之后一切都按「第几个字」算。
//
// **正文不进 ebooks 行里。** 一本长篇一两百万字，放进内存镜像等于每次
// 列个书单都把整本书拎一遍。正文另存进 files 域，要读的时候才取，
// 取过一次缓存在内存里。行里只留章节表与进度。

const texts = new Map();   // bookId -> 正文
const MAX_BYTES = 80 * 1024 * 1024;

// 一页多少字。阅读页、一起读、进度都按它算 —— 分成两个数，
// 屏幕上写着 100% 而记录里写着 60%，用户只会当成 bug
export const PAGE = 2400;

export { ebooks };

export const all = () => ebooks.all().sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
export const get = id => ebooks.get(id);

// ---- 读文件 ----

// 中文 txt 十有八九是 GBK。先按 UTF-8 严格解一遍，崩了再退回 GBK。
function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { /* 不是 UTF-8 */ }
  for (const enc of ['gb18030', 'big5']) {
    try {
      const text = new TextDecoder(enc, { fatal: true }).decode(buf);
      if (text) return text;
    } catch { /* 换下一个 */ }
  }
  return new TextDecoder('utf-8').decode(buf);   // 都不行就凑合，别抛
}

const CHAPTER = /^[ \t　]*(?:第\s*[0-9零一二三四五六七八九十百千两]+\s*[章节回卷篇部]|序章|楔子|尾声|后记|番外|Chapter\s+\d+)[^\n]{0,40}$/;

// 从正文里找章节。找不到就整本算一章 —— 硬切成等长的几段更难看
function chaptersOf(text) {
  const out = [];
  const lines = text.split('\n');
  let at = 0;
  for (const line of lines) {
    if (CHAPTER.test(line.trim()) && line.trim().length <= 44) {
      out.push({ title: line.trim(), start: at });
    }
    at += line.length + 1;
  }
  if (!out.length) return [{ title: '全文', start: 0, end: text.length }];
  if (out[0].start > 0) out.unshift({ title: '开头', start: 0 });
  out.forEach((c, i) => { c.end = i + 1 < out.length ? out[i + 1].start : text.length; });
  return out;
}

const strip = html => html
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  .replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

// epub 就是一个 zip：container.xml 指向 opf，opf 里写着按什么顺序读哪几个文件
async function readEpub(file) {
  const zipped = await unzip(file);
  const pick = name => {
    const hit = [...zipped.keys()].find(k => k.toLowerCase() === name.toLowerCase());
    return hit ? zipped.get(hit) : null;
  };
  const container = pick('META-INF/container.xml');
  if (!container) throw new Error('这不是一个 epub：找不到 container.xml');
  const dom = new DOMParser().parseFromString(await container.text(), 'application/xml');
  const opfPath = dom.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('这个 epub 里没写正文清单的位置');

  const opfBlob = pick(opfPath);
  if (!opfBlob) throw new Error('这个 epub 的正文清单丢了');
  const opf = new DOMParser().parseFromString(await opfBlob.text(), 'application/xml');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const join = href => (href.startsWith('/') ? href.slice(1) : base + href)
    .replace(/[^/]+\/\.\.\//g, '');

  const title = opf.querySelector('metadata > title, title')?.textContent?.trim() || '';
  const author = opf.querySelector('metadata > creator, creator')?.textContent?.trim() || '';

  const items = new Map();
  opf.querySelectorAll('manifest > item').forEach(it => {
    items.set(it.getAttribute('id'), {
      href: join(it.getAttribute('href') || ''),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    });
  });

  // 封面：manifest 里标了 cover-image 的，或者 metadata 里指名的那个
  let coverBlob = null;
  const coverId = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute('content');
  const coverItem = [...items.values()].find(i => i.props.includes('cover-image'))
    || (coverId && items.get(coverId));
  if (coverItem && /^image\//.test(coverItem.type)) coverBlob = pick(coverItem.href);

  const order = [...opf.querySelectorAll('spine > itemref')]
    .map(r => items.get(r.getAttribute('idref')))
    .filter(i => i && /html|xml/.test(i.type));
  if (!order.length) throw new Error('这个 epub 里没有正文');

  const parts = [];
  const chapters = [];
  let at = 0;
  for (const it of order) {
    const blob = pick(it.href);
    if (!blob) continue;
    const raw = await blob.text();
    const head = raw.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const body = strip(raw).trim();
    if (!body) continue;
    const name = strip(head ? head[1] : '').trim().slice(0, 44);
    chapters.push({ title: name || `第 ${chapters.length + 1} 节`, start: at });
    parts.push(body);
    at += body.length + 2;
  }
  const text = parts.join('\n\n');
  chapters.forEach((c, i) => { c.end = i + 1 < chapters.length ? chapters[i + 1].start : text.length; });
  return { title, author, text, chapters, coverBlob };
}

/** 读一个文件，还不入库。界面拿它先给用户看一眼。 */
export async function parse(file) {
  if (!file) throw new Error('请先选择一个文件');
  if (file.size > MAX_BYTES) throw new Error(`文件超过 ${Math.round(MAX_BYTES / 1048576)} MB`);
  const name = (file.name || '').replace(/\.[^.]+$/, '');

  if (/\.epub$/i.test(file.name || '')) {
    const got = await readEpub(file);
    return { ...got, kind: 'epub', title: got.title || name };
  }
  const text = decode(await file.arrayBuffer()).replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('这个文件里没有文字');
  return { kind: 'txt', title: name, author: '', text, chapters: chaptersOf(text), coverBlob: null };
}

/** 真正入库。正文另存一份到 files，行里只留章节表。 */
export async function add({ title, author = '', kind = 'txt', text, chapters, coverBlob = null }) {
  const body = String(text || '');
  if (!body.trim()) throw new Error('这本书没有正文');
  const fileId = await files.put(new Blob([body], { type: 'text/plain' }),
    { name: `${title || 'book'}.txt`, type: 'text/plain' });
  const cover = coverBlob ? await images.put(new File([coverBlob], 'cover', { type: coverBlob.type })) : null;
  const row = ebooks.create({
    title: String(title || '未命名').slice(0, 80),
    author: String(author || '').slice(0, 40),
    kind, fileId, cover,
    chars: body.length,
    chapters: (chapters || []).slice(0, 2000),
    at: 0, lastAt: Date.now(),
  });
  texts.set(row.id, body);
  // 各个角色书架上同名的占位，接上这本真书
  import('./shelf.js').then(m => m.linkImported(row.id)).catch(() => {});
  return row;
}

export function remove(id) {
  const row = ebooks.get(id);
  if (!row) return false;
  if (row.fileId) files.remove(row.fileId);
  if (row.cover) images.remove(row.cover);
  texts.delete(id);
  import('./shelf.js').then(m => m.unlinkBook(id)).catch(() => {});
  // 书没了，跟着它的段评也留不住。动态引入避开循环依赖
  import('./paracomment.js').then(m => m.dropBook(id)).catch(() => {});
  return ebooks.remove(id);
}

/** 正文。第一次要用的时候才从 files 里取，之后缓存着。 */
export async function textOf(id) {
  if (texts.has(id)) return texts.get(id);
  const row = ebooks.get(id);
  if (!row?.fileId) return '';
  const blob = await files.blob(row.fileId);
  const text = blob ? await blob.text() : '';
  texts.set(id, text);
  return text;
}

export const peekText = id => texts.get(id) || '';

/** 读到哪儿了。按字数记，换设备、换字号都不受影响。 */
export function setAt(id, at) {
  const row = ebooks.get(id);
  if (!row) return;
  const next = Math.max(0, Math.min(row.chars || 0, Math.round(at) || 0));
  if (next === row.at) return;
  ebooks.update(id, { at: next, lastAt: Date.now() });
}

// 「读到百分之多少」= 当前这一页读完为止，和屏幕上那个数是同一个口径
export const percentOf = row =>
  (!row?.chars ? 0 : Math.min(100, Math.round(((row.at || 0) + PAGE) / row.chars * 100)));

/** 这个位置落在第几章。 */
export function chapterAt(row, at = row?.at || 0) {
  const list = row?.chapters || [];
  for (let i = list.length - 1; i >= 0; i--) if (at >= list[i].start) return { ...list[i], index: i };
  return list[0] ? { ...list[0], index: 0 } : null;
}

/**
 * 这一页里的每一段，带上它在**全书正文**里的字符起点。
 *
 * 段评就挂在这个起点上 —— 和阅读进度同一套坐标，翻页、换字号、改分页大小
 * 都不会让它对错地方。重新导入同一本书才会错位，那和进度丢失是同一回事。
 */
export function paragraphsOf(text, from = 0, span = 2400) {
  const start = Math.max(0, Math.min(text.length, from));
  const chunk = text.slice(start, Math.min(text.length, start + span));
  const out = [];
  let cursor = start;
  for (const raw of chunk.split('\n')) {
    const t = raw.trim();
    if (t) out.push({ at: cursor + (raw.length - raw.trimStart().length), text: t });
    cursor += raw.length + 1;      // +1 是被 split 吃掉的那个换行
  }
  return out;
}

/**
 * 从这个起点开始的那一整段（到下一个换行为止）。
 *
 * 不要用 `paragraphsOf(text, at, 1)` 代替它 —— 那个的第三个参数是**要切多少字**，
 * 传 1 就只切出一个字来。段评页和送进 prompt 的原文都栽在这上面过。
 */
export function paragraphAt(text, at) {
  const start = Math.max(0, Math.min(text.length, at));
  const nl = text.indexOf('\n', start);
  return text.slice(start, nl < 0 ? text.length : nl).trim();
}

/** 从某处起的一段正文。阅读页按段取，不一次性铺一整本。 */
export function slice(text, from, size = 2400) {
  const start = Math.max(0, Math.min(text.length, from));
  return text.slice(start, Math.min(text.length, start + size));
}
