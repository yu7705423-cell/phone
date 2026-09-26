// HTML 卡片：世界书里的一种条目，角色在聊天里按它发一张渲染好的卡片。见 ARCHITECTURE 4.250
//
// 一张卡片 = 世界书条目 { type: 'card', comment: 卡片名, content: 说明（进 prompt）, keys, constant, …,
//   card: { html: 模板, fields: { 字段名 或 列表.子字段: { desc, max, long, lines } }, width, ratio, height, images, sampleText } }
//
// 用户要求：只用 HTML 与 CSS，不要脚本（「感觉风险有点大」）。所以这里的墙比工具箱那边多一道：
//
//   1. iframe 给 sandbox=""（连 allow-scripts 都没有），CSP 里 script-src 'none'。
//   2. 渲染完先清洗：脚本、iframe、表单、meta、base、事件属性、javascript: 与外部链接一律拿掉。
//   3. 占位符不许出现在网址里（src、href、<style> 里的 url() 之类）。角色填的值只能是文字 ——
//      否则一份恶意模板可以让模型把隐私写进字段，再拼进一张外部图片的地址里带出去。
//      开了外部图片的模板更严：占位符只许出现在正文与 alt、title 里。
//   4. 每张卡片各在自己的 iframe 里，和应用、美化包、别的卡片的样式互不相碰（类名隔离）。
//
// 占位符是 Mustache 的一个子集：{{字段}}、{{#列表}}…{{/列表}}、{{^字段}}为空时{{/字段}}、列表项里的 {{.}}。
// 应用自己填的几个：{{char}} {{user}} {{char_avatar}} {{user_avatar}}。

import { lorebooks, settings } from './db/index.js';
import { BUILTIN, BUILTIN_BOOK_ID } from './cardkit.js';
import { images } from './db/images.js';
import { wrap } from './sandbox.js';
import { chatBooksFor } from './ai/context/lorebook.js';

export const TYPE = 'card';
export const isCard = e => e?.type === TYPE;

/**
 * 应用自己填、不用角色写的那几个名字。
 * author_avatar：卡片设了「发帖人字段」（card.authorField）时，那一栏写的名字是角色就用角色头像、是用户就用用户头像，
 * 都不是就空着 —— 模板里配 {{^author_avatar}} 画一个首字头像（内置的帖子卡片就是这么做的）
 */
export const SYSTEM = ['char', 'user', 'char_avatar', 'user_avatar', 'author_avatar'];
/** 其中是图片地址的（应用给的 data: 地址），允许出现在网址里 */
const SYSTEM_URL = new Set(['char_avatar', 'user_avatar', 'author_avatar']);

// 尺寸：宽度两档，高度按形状。聊天里实际量过：普通气泡最宽约为屏幕的 74%，手机上约 270px
export const WIDTHS = { bubble: 270, full: 340 };
export const RATIOS = {
  strip: { label: '横条', h: 96 },
  '4:3': { label: '4:3', r: 3 / 4 },
  '1:1': { label: '方形', r: 1 },
  '3:4': { label: '3:4 竖版', r: 4 / 3 },
  long: { label: '长图', h: 520 },
  custom: { label: '自定高度' },
};

/** 一张卡片在聊天里的宽高（px） */
export function sizeOf(card) {
  const c = card || {};
  const w = WIDTHS[c.width] || WIDTHS.bubble;
  const r = RATIOS[c.ratio] || RATIOS['4:3'];
  const h = c.ratio === 'custom' ? Math.max(40, Math.round(Number(c.height) || 300))
    : r.h || Math.round(w * r.r);
  return { w, h };
}

// ---- 模板 ----

const TAG = /\{\{\{?\s*([#^/]?)\s*([^{}]*?)\s*\}?\}\}/g;

/**
 * 占位符所在的位置：正文、某个属性里、<style> 里。
 * 模板很短，逐个往前找最近的 < 与 > 就够了，不值得写一个完整的解析器
 */
function contextAt(tpl, at) {
  const before = tpl.slice(0, at);
  const lt = before.lastIndexOf('<');
  const gt = before.lastIndexOf('>');
  const styleOpen = before.search(/<style[\s>][\s\S]*$/i);
  if (styleOpen >= 0 && !/<\/style\s*>/i.test(before.slice(styleOpen))) return { where: 'style' };
  if (lt > gt) {
    const inTag = before.slice(lt);
    const m = inTag.match(/([^\s"'=<>/]+)\s*=\s*(["']?)[^"'>]*$/);
    if (m) return { where: 'attr', attr: m[1].toLowerCase() };
    return { where: 'tag' };
  }
  return { where: 'text' };
}

const URL_ATTRS = new Set(['src', 'href', 'srcset', 'action', 'formaction', 'poster', 'data', 'xlink:href',
  'background', 'lowsrc', 'ping', 'cite', 'longdesc', 'manifest', 'codebase', 'dynsrc', 'srcdoc']);
const QUIET_ATTRS = new Set(['alt', 'title', 'aria-label']);

/** 这一处占位符能不能填。images：这张卡片开了外部图片 */
function allowed(name, ctx, images) {
  if (SYSTEM_URL.has(name)) return true;
  if (ctx.where === 'text') return true;
  if (ctx.where === 'style' || ctx.where === 'tag') return false;
  const a = ctx.attr || '';
  if (a.startsWith('on') || URL_ATTRS.has(a)) return false;
  if (images) return QUIET_ATTRS.has(a) || a.startsWith('aria-');
  return true;
}

/** 模板切成树：文字、占位符、区块（列表或条件） */
function parse(tpl, images) {
  const root = { kids: [] };
  const stack = [root];
  const problems = [];
  let last = 0;
  let m;
  TAG.lastIndex = 0;
  const src = String(tpl || '');
  while ((m = TAG.exec(src))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.kids.push({ t: 'text', v: src.slice(last, m.index) });
    last = m.index + m[0].length;
    const [, op, rawName] = m;
    const name = rawName.trim();
    if (!name) continue;
    if (op === '#' || op === '^') {
      const node = { t: 'sec', name, inv: op === '^', kids: [] };
      top.kids.push(node);
      stack.push(node);
    } else if (op === '/') {
      // 收错名字的、多收的都不理，只收最近那个同名的
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
    } else {
      const ctx = contextAt(src, m.index);
      const ok = allowed(name, ctx, images);
      if (!ok) problems.push({ name, where: ctx.where === 'attr' ? ctx.attr : ctx.where });
      top.kids.push({ t: 'var', name, attr: ctx.where !== 'text', off: !ok });
    }
  }
  if (last < src.length) stack[stack.length - 1].kids.push({ t: 'text', v: src.slice(last) });
  return { root, problems };
}

/**
 * 模板里要角色填的字段，按出现顺序。
 * 列表区块（里面有 {{.}} 或别的字段）是一个列表字段，里面那几个是它的子字段；
 * 只包着自己的（{{#地点}}{{地点}}{{/地点}}）或者什么都不包的，是一个普通字段的「有没有」。
 *
 * 光看模板分不清「{{#评分}}{{星级}}{{/评分}}」是列表还是「有评分时显示星级」—— Mustache 本身是看值的。
 * 默认按列表读；字段设置里 scalar: true 的按普通字段读，里面的字段各算各的（编辑页上有开关）。
 */
export function fieldsOf(tpl, cfg = {}) {
  const { root } = parse(tpl, false);
  const out = [];
  const seen = new Map();
  const add = f => { if (!seen.has(f.name)) { seen.set(f.name, f); out.push(f); } return seen.get(f.name); };
  const walk = (node, inList) => {
    for (const k of node.kids) {
      if (k.t === 'var') {
        if (k.name === '.' || SYSTEM.includes(k.name) || k.name.startsWith('img:')) continue;
        if (!inList) add({ name: k.name, list: false, sub: [] });
      } else if (k.t === 'sec') {
        if (SYSTEM.includes(k.name)) { walk(k, inList); continue; }
        if (inList) { walk(k, inList); continue; }
        const inner = [];
        let dot = false;
        const scan = n => n.kids.forEach(x => {
          if (x.t === 'var') {
            if (x.name === '.') dot = true;
            else if (x.name !== k.name && !SYSTEM.includes(x.name) && !x.name.startsWith('img:')) {
              if (!inner.includes(x.name)) inner.push(x.name);
            }
          } else if (x.t === 'sec') scan(x);
        });
        scan(k);
        if (!k.inv && (dot || inner.length) && !(cfg || {})[k.name]?.scalar) {
          const f = add({ name: k.name, list: true, sub: inner });
          f.list = true;
          inner.forEach(n => { if (!f.sub.includes(n)) f.sub.push(n); });
        } else {
          add({ name: k.name, list: false, sub: [] });
          walk(k, false);
        }
      }
    }
  };
  walk(root, false);
  return out;
}

/** 模板里填不了的那几处（占位符在网址、<style> 里之类），给编辑页提示用 */
export function problemsOf(tpl, { images = false } = {}) {
  const { problems } = parse(tpl, images);
  const out = problems.map(p => `「${p.name}」位于${p.where === 'style' ? '样式表' : p.where === 'tag' ? '标签' : ` ${p.where} 属性`}中，不会被填入`);
  if (/<script[\s>]/i.test(String(tpl || ''))) out.push('模板中的脚本不会运行，渲染前会被移除');
  return out;
}

// ---- 渲染 ----

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 字段设置：列表里的子字段按「列表.子字段」存 */
const cfgOf = (card, name, parent) => (card?.fields || {})[parent ? `${parent}.${name}` : name] || {};

function cut(v, max) {
  const s = String(v ?? '');
  const n = Math.round(Number(max) || 0);
  if (n > 0 && [...s].length > n) return [...s].slice(0, n).join('') + '…';
  return s;
}

function renderNodes(kids, stack, card, parentList) {
  let out = '';
  const lookup = name => {
    if (name === '.') return stack[stack.length - 1];
    for (let i = stack.length - 1; i >= 0; i--) {
      const c = stack[i];
      if (c && typeof c === 'object' && !Array.isArray(c) && Object.prototype.hasOwnProperty.call(c, name)) return c[name];
    }
    return undefined;
  };
  for (const k of kids) {
    if (k.t === 'text') { out += k.v; continue; }
    if (k.t === 'var') {
      if (k.off) continue;
      let v = lookup(k.name);
      if (Array.isArray(v)) v = v.map(x => (x && typeof x === 'object' ? Object.values(x).join(' ') : x)).join('、');
      if (v == null) continue;
      if (SYSTEM_URL.has(k.name)) { out += esc(v); continue; }
      const inItem = stack.length > 1;
      const cfg = cfgOf(card, k.name === '.' ? parentList : k.name, inItem && k.name !== '.' ? parentList : '');
      const text = esc(cut(v, cfg.max));
      if (k.attr) { out += text.replace(/\n/g, ' '); continue; }
      if (cfg.long) {
        const lines = Math.max(1, Math.round(Number(cfg.lines) || 6));
        out += `<span class="eira-long" style="max-height:${(lines * 1.5).toFixed(1)}em">${text}</span>`;
      } else out += text.replace(/\n/g, '<br>');
      continue;
    }
    // 区块
    const v = lookup(k.name);
    const empty = v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
    if (k.inv) { if (empty) out += renderNodes(k.kids, stack, card, parentList); continue; }
    if (empty) continue;
    if (Array.isArray(v)) {
      for (const item of v) out += renderNodes(k.kids, [...stack, item], card, k.name);
    } else out += renderNodes(k.kids, stack, card, parentList);
  }
  return out;
}

/** 模板填上值，得到一段 HTML（还没清洗） */
export function fill(card, values = {}, sys = {}) {
  const { root } = parse(card?.html || '', !!card?.images);
  const top = { ...values };
  SYSTEM.forEach(n => { if (sys[n] != null) top[n] = sys[n]; });
  const who = card?.authorField ? String(values[card.authorField] ?? '').trim() : '';
  top.author_avatar = !who ? '' : who === String(sys.char || '').trim() ? (sys.char_avatar || '')
    : who === String(sys.user || '').trim() ? (sys.user_avatar || '') : '';
  return renderNodes(root.kids, [top], card, '');
}

const DROP = 'script,iframe,frame,frameset,object,embed,applet,base,meta,portal,noscript,template';
const LINKY = ['src', 'srcset', 'poster', 'background', 'xlink:href', 'href', 'data', 'lowsrc'];

/**
 * 清洗。卡片本来就在不给脚本的盒子里，CSP 也挡着联网，这里是第三道：
 * 就算盒子哪天被改松了，这份 HTML 里也没有能跑的东西、能点出去的链接
 */
export function sanitize(htmlText, { images = false, rootClass = '', baseCss = '' } = {}) {
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${htmlText}</body></html>`, 'text/html');
  doc.querySelectorAll(DROP).forEach(n => n.remove());
  // 表单交不出去（盒子不给 allow-forms），外壳留着里面的东西
  doc.querySelectorAll('form').forEach(f => { f.replaceWith(...f.childNodes); });
  doc.querySelectorAll('link').forEach(l => {
    const ok = images && /stylesheet/i.test(l.getAttribute('rel') || '') && /^https:\/\//i.test(l.getAttribute('href') || '');
    if (!ok) l.remove();
  });
  for (const el of doc.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      const v = a.value.trim();
      if (n.startsWith('on') || n === 'formaction' || n === 'action' || n === 'ping' || n === 'srcdoc' || n === 'target') {
        el.removeAttribute(a.name); continue;
      }
      if (el.tagName === 'LINK' && n === 'href') continue;
      if (!LINKY.includes(n)) continue;
      // 页内跳转（#id，配合 :target 做切换）留着；其余只认 data: 与（开了外部图片时的）https:
      if ((n === 'href' || n === 'xlink:href') && v.startsWith('#')) continue;
      if (/^data:image\//i.test(v) || /^data:font\//i.test(v)) continue;
      if (images && /^https:\/\//i.test(v) && n !== 'href') continue;
      el.removeAttribute(a.name);
    }
  }
  if (rootClass) doc.documentElement.classList.add(rootClass);
  if (baseCss) {
    const st = doc.createElement('style');
    st.textContent = baseCss;
    doc.head.insertBefore(st, doc.head.firstChild);
  }
  return doc.documentElement.outerHTML;
}

// 所有卡片都垫着的一层。模板自己的样式写在后面，同名的以它为准
// html 与 body 定高，模板里 min-height:100% 就能铺满整张卡片（卡片里也不写 vh，CLAUDE.md 第 1 条的检查一视同仁）
const BASE_CSS = 'html,body{margin:0;padding:0;height:100%}'
  + 'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}'
  + 'body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;'
  + 'overflow-wrap:anywhere;line-height:1.5}'
  + 'img{max-width:100%}'
  + '.eira-long{display:block;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;white-space:pre-wrap}'
  + '.eira-scroll{overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}';

/** 应用现在是不是深色（设置里选了深色，或跟随系统且系统是深色） */
export function themeDark() {
  try {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  } catch { return false; }
}

/**
 * 一张卡片的整页（放进 srcdoc）。
 * sys：{ char, user, char_avatar, user_avatar }；dark：应用是不是深色（给 <html> 挂 eira-dark），不传就看应用当前的
 */
export function docOf(card, values = {}, sys = {}, { dark = themeDark() } = {}) {
  const images = !!card?.images;
  const html = sanitize(fill(card, values, sys), { images, rootClass: dark ? 'eira-dark' : 'eira-light', baseCss: BASE_CSS });
  return wrap(html, { images, scripts: false });
}

// ---- 角色写的那一段 ----

/**
 * 一段「字段：值」读成值。
 *   正文：……                 普通字段
 *   评论：路人甲｜这是哪｜326  列表字段，一行一项，子字段按顺序用｜隔开
 *   配图：夜里的街｜咖啡       没有子字段的列表，一行里用｜隔开也算几项
 * 认不出是哪个字段的行，接在上一个字段后面（长文本换行）。
 */
export function parseValues(text, fields = []) {
  const byName = new Map(fields.map(f => [f.name, f]));
  const known = fields.length > 0;
  const values = {};
  let lastKey = null;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { if (lastKey && typeof values[lastKey] === 'string') values[lastKey] += '\n'; continue; }
    const m = line.match(/^([^：:\n]{1,24}?)\s*[：:]\s*([\s\S]*)$/);
    const key = m ? m[1].trim() : '';
    const isField = m && (known ? byName.has(key) : true);
    if (!isField) {
      if (lastKey != null) {
        const cur = values[lastKey];
        if (Array.isArray(cur)) {
          const tail = cur[cur.length - 1];
          if (typeof tail === 'string') cur[cur.length - 1] = `${tail}\n${line}`;
        } else values[lastKey] = cur ? `${cur}\n${line}`.replace(/\n{3,}/g, '\n\n') : line;
      }
      continue;
    }
    const f = byName.get(key) || { name: key, list: false, sub: [] };
    const v = m[2].trim();
    lastKey = key;
    if (f.list) {
      const arr = Array.isArray(values[key]) ? values[key] : [];
      if (f.sub.length) {
        const bits = v.split(/[|｜]/).map(x => x.trim());
        const item = {};
        f.sub.forEach((s, i) => { item[s] = bits[i] ?? ''; });
        arr.push(item);
      } else v.split(/[|｜]/).map(x => x.trim()).filter(Boolean).forEach(x => arr.push(x));
      values[key] = arr;
    } else if (values[key] == null || values[key] === '') values[key] = v;
    else values[key] = `${values[key]}\n${v}`;
  }
  for (const k of Object.keys(values)) if (typeof values[k] === 'string') values[k] = values[k].trim();
  return values;
}

/** 值写回成角色那种写法。消息正文、历史里角色读到的就是它 */
export function blockOf(name, values = {}, fields = []) {
  const lines = [`[卡片：${name}]`];
  const order = fields.length ? fields.map(f => f.name) : Object.keys(values);
  Object.keys(values).forEach(k => { if (!order.includes(k)) order.push(k); });
  for (const k of order) {
    const v = values[k];
    if (v == null || v === '') continue;
    const f = fields.find(x => x.name === k);
    if (Array.isArray(v)) {
      for (const item of v) {
        const text = item && typeof item === 'object'
          ? (f?.sub?.length ? f.sub : Object.keys(item)).map(s => item[s] ?? '').join('｜') : String(item);
        lines.push(`${k}：${text}`);
      }
    } else lines.push(`${k}：${String(v)}`);
  }
  lines.push('[/卡片]');
  return lines.join('\n');
}

/** 列表、通知里那一行 */
export function previewOf(name, values = {}) {
  const first = Object.values(values).find(v => typeof v === 'string' && v.trim());
  return `[卡片] ${name}${first ? ` ${first.replace(/\s+/g, ' ').slice(0, 30)}` : ''}`;
}

/**
 * 进 prompt 的那份清单（skeleton.card 的 {{cards}}）：卡片名、说明、字段与字数。
 * 模板一个字都不进 —— 模型只管填值，长什么样由模板决定
 */
export function promptList(cards) {
  return cards.map(e => {
    const card = e.card || {};
    const desc = String(e.content || '').trim();
    const out = [`· ${cardName(e)}${desc ? `: ${desc}` : ''}`];
    for (const f of fieldsOf(card.html, card.fields)) {
      const cfg = cfgOf(card, f.name);
      const bits = [];
      if (f.list) bits.push(f.sub.length ? `list, each item: ${f.sub.join('｜')}` : 'list');
      if (Number(cfg.max) > 0) bits.push(`up to ${Math.round(cfg.max)} characters${f.list ? ' per item' : ''}`);
      out.push(`  ${f.name}${bits.length ? ` (${bits.join('; ')})` : ''}${cfg.desc ? `: ${String(cfg.desc).trim()}` : ''}`);
      for (const sub of f.sub) {
        const sc = cfgOf(card, sub, f.name);
        if (!sc.desc && !(Number(sc.max) > 0)) continue;
        out.push(`    ${sub}${Number(sc.max) > 0 ? ` (up to ${Math.round(sc.max)} characters)` : ''}${sc.desc ? `: ${String(sc.desc).trim()}` : ''}`);
      }
    }
    return out.join('\n');
  }).join('\n');
}

// ---- 找卡片 ----

const cardName = e => String(e?.comment || '').trim();

// ---- 内置卡片（system/cardkit.js）----
// 不存进数据库，只在设置里记三样：全局生效、停用了哪几张。挂给某个角色走角色的 lorebookIds，和别的书一样

export { BUILTIN_BOOK_ID };
export const builtinState = () => ({ global: false, off: [], ...(settings.get().builtinCards || {}) });
export const setBuiltin = patch => settings.set({ builtinCards: { ...builtinState(), ...patch } });

/** 内置那本书，长得和数据库里的书一样（只读） */
export function builtinBook() {
  const st = builtinState();
  return {
    id: BUILTIN_BOOK_ID, name: '内置卡片', builtin: true, global: !!st.global,
    entries: BUILTIN.map(e => ({ ...e, enabled: !(st.off || []).includes(e.id) })),
  };
}

/** 某个角色用得上的卡片（挂在它身上的与全局的对话用世界书里，启用着的） */
export function cardsFor(char) {
  const out = [];
  const bb = builtinBook();
  const books = [...chatBooksFor(char)];
  if (bb.global || (char?.lorebookIds || []).includes(BUILTIN_BOOK_ID)) books.push(bb);
  for (const book of books) {
    for (const e of book.entries || []) {
      if (isCard(e) && e.enabled !== false && cardName(e) && e.card?.html) out.push({ ...e, bookId: book.id });
    }
  }
  return out;
}

/** 这一轮命中的卡片：常驻的，或者扫描窗口里出现了关键词的 */
export function hitCards(char, scanText) {
  const text = String(scanText || '');
  const lower = text.toLowerCase();
  return cardsFor(char).filter(e => {
    if (e.constant) return true;
    const keys = (e.keys || []).filter(Boolean);
    return keys.some(k => (e.caseSensitive ? text.includes(k) : lower.includes(k.toLowerCase())));
  });
}

/** 按消息上记的位置找；那一条删了或改了名字，再按名字在全部世界书里找 */
export function resolve(ref = {}, char = null) {
  const book = ref.bookId === BUILTIN_BOOK_ID ? builtinBook() : ref.bookId ? lorebooks.get(ref.bookId) : null;
  const direct = book?.entries?.find(e => e.id === ref.entryId && isCard(e));
  if (direct) return { ...direct, bookId: book.id };
  const name = String(ref.name || '').trim();
  if (!name) return null;
  const pool = char ? cardsFor(char) : [];
  const hit = pool.find(e => cardName(e) === name);
  if (hit) return hit;
  for (const b of [...lorebooks.all(), builtinBook()]) {
    const e = (b.entries || []).find(x => isCard(x) && cardName(x) === name);
    if (e) return { ...e, bookId: b.id };
  }
  return null;
}

/** 按名字找这个角色能用的那一张，找不到给 null */
export const byName = (name, char) => {
  const n = String(name || '').trim();
  return (char ? cardsFor(char) : []).find(e => cardName(e) === n) || resolve({ name: n });
};

// ---- 头像 ----

const avatarCache = new Map();

/** 头像缩成小图的 data: 地址（盒子里认不了应用的 blob: 地址）。没有给 '' */
export async function avatarData(imageId, size = 96) {
  if (!imageId) return '';
  if (avatarCache.has(imageId)) return avatarCache.get(imageId);
  let out = '';
  try {
    const blob = await images.blob(imageId);
    if (blob) {
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', 0.86);
    }
  } catch { out = ''; }
  avatarCache.set(imageId, out);
  return out;
}

/** 一张卡片要的那几样应用自己的值 */
export async function sysOf({ char = null, persona = null } = {}) {
  const c = char || null;
  return {
    char: c?.name || '',
    user: persona?.name || '',
    char_avatar: c?.avatar ? await avatarData(c.avatar) : '',
    user_avatar: persona?.avatar ? await avatarData(persona.avatar) : '',
  };
}

/** 编辑页预览、确认页用：没有角色时的占位值 */
export const sampleSys = () => ({ char: '角色', user: '用户', char_avatar: '', user_avatar: '' });
