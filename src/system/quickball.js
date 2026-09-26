// 悬浮球（ARCHITECTURE 4.256）。
//
// 点一下展开快捷操作，长按选放哪些，拖动换位置、松手贴边。整个应用都有；「当前对话」那一组只在聊天页里出现。
//
// **不能丢**（用户原话：别的网页里的悬浮球「用一段时间之后消失不见了，反复开关也不出现」）。那种多半是
// 位置存成了像素坐标，换了横竖屏、弹过键盘、窗口变小之后落在屏幕外，每次打开都读回那个坐标。这里：
//
//   1. 位置只存「贴哪一边」加「从上往下的比例」，不存像素；
//   2. 每次画都按当下的屏幕重新算，并夹回可见区域（避开刘海与底部横条）；窗口一变就重算；
//   3. 拖不出屏幕，松手贴到近的那一边，整个球露在外面；
//   4. 读到的东西不合法一律用默认；
//   5. 挂在外壳最外层（shell/QuickBall.js），切应用、切页面不卸载；
//   6. 设置「主题」旁边的「悬浮球」里固定有「恢复默认位置」，球在不在屏幕上都能点。
//
// 位置平时就是用户放的地方，关掉再打开、刷新都不变（用户要求），只有「恢复默认位置」才放回去。
//
// **外观**（用户要求：大小自己调、换成自己的图并且可以溢出球外、进阶可以自己写 CSS）：
//   - 换了图，图按「球的大小 × 溢出倍数」画，居中压在球上，可以比球大；夹回屏幕时按图的大小算，
//     溢出的那一圈也不会出屏幕（第 2 条对图同样成立）；
//   - 自己写的 CSS 只作用在悬浮球那一层（外面包一层 .qb-layer，见 scopeCss），写 body 之类的碰不到别处；
//     设置 app 里一律不挂，那里的「恢复默认样式」永远点得到（和全局美化同一个逃生口，CLAUDE.md 第 18 条）。

import { createStore, uid } from './store.js';
import { settings, images } from './db/index.js';

export const DEFAULT_ITEMS = ['lore', 'reply', 'regen', 'model', 'theme', 'home', 'back'];
export const SIZE_MIN = 32;
export const SIZE_MAX = 120;
export const SCALE_MIN = 1;
export const SCALE_MAX = 3;
const DEF = { on: false, items: DEFAULT_ITEMS, side: 'right', y: 0.42, size: 56, idle: 0.45,
  img: '', scale: 1.4, plate: false, css: '' };
// 存图的边长：最大的球乘最大的倍数，在三倍屏上也不糊太多
const IMG_EDGE = 720;

const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** 读出一份干净的设置：什么坏值都换成默认 */
export function cfg() {
  const q = settings.get().quickBall;
  const o = q && typeof q === 'object' ? q : {};
  return {
    on: o.on === true,
    items: Array.isArray(o.items) ? o.items.filter(x => typeof x === 'string') : DEF.items,
    side: o.side === 'left' ? 'left' : 'right',
    y: num(o.y, 0, 1, DEF.y),
    size: Math.round(num(o.size, SIZE_MIN, SIZE_MAX, DEF.size)),
    idle: num(o.idle, 0.2, 1, DEF.idle),
    img: typeof o.img === 'string' ? o.img : '',
    scale: Math.round(num(o.scale, SCALE_MIN, SCALE_MAX, DEF.scale) * 10) / 10,
    plate: o.plate === true,
    css: typeof o.css === 'string' ? o.css : '',
  };
}

export function setCfg(patch) {
  settings.set({ quickBall: { ...cfg(), ...patch } });
}

/** 放回默认位置（右侧、上下居中偏上） */
export const resetPos = () => setCfg({ side: DEF.side, y: DEF.y });

/** 外观全部放回默认：大小、透明度、图、溢出倍数、底板、CSS。位置和放了哪些不动 */
export function resetLook() {
  const old = cfg().img;
  setCfg({ size: DEF.size, idle: DEF.idle, img: '', scale: DEF.scale, plate: DEF.plate, css: '' });
  if (old) images.remove(old);
}

/**
 * 换成自己的图。先存新图、换上，再删旧的（images.remove 先核引用，CLAUDE.md 第 20 条）。
 * 动图（gif）原样存，过一遍画布就只剩第一帧；其余裁掉四周透明边后存成方图，透明的地方仍透明
 */
export async function setImage(file) {
  const old = cfg().img;
  const id = file.type === 'image/gif'
    ? await images.putRaw(uid('img'), file)
    : await images.putIcon(file, IMG_EDGE, { trim: true });
  setCfg({ img: id });
  if (old && old !== id) images.remove(old);
  return id;
}

export function clearImage() {
  const old = cfg().img;
  setCfg({ img: '' });
  if (old) images.remove(old);
}

const EDGE = 8;

/** 画出来有多大：换了图就是图的大小（可以比球大），没换就是球本身 */
export const visual = c => (c.img ? c.size * c.scale : c.size);
// 溢出球外的那一圈有多宽。夹回屏幕时四边各多让这么多
const over = c => Math.max(0, (visual(c) - c.size) / 2);

/**
 * 按当下的屏幕算出球的左上角（px），一定在可见区域内。
 * W、H 是外壳那一块的宽高；top、bottom 是上下要让出来的（刘海、状态栏、底部横条）
 */
export function place(c, W, H, { top = 0, bottom = 0 } = {}) {
  const size = c.size;
  const e = EDGE + over(c);
  const minY = top + e;
  const maxY = Math.max(minY, H - bottom - size - e);
  const x = c.side === 'left' ? e : Math.max(e, W - size - e);
  const y = Math.round(minY + (maxY - minY) * num(c.y, 0, 1, DEF.y));
  return { x, y };
}

/** 松手的那一刻：贴到近的那一边，记下上下的比例 */
export function dropAt(x, y, W, H, c, { top = 0, bottom = 0 } = {}) {
  const size = c.size;
  const e = EDGE + over(c);
  const minY = top + e;
  const maxY = Math.max(minY, H - bottom - size - e);
  return {
    side: x + size / 2 < W / 2 ? 'left' : 'right',
    y: maxY > minY ? num((y - minY) / (maxY - minY), 0, 1, DEF.y) : DEF.y,
  };
}

/** 拖动中的夹取：整张图（含溢出的那一圈）都在外壳里 */
export function clampDrag(x, y, W, H, c) {
  const o = over(c);
  return {
    x: Math.min(Math.max(o, x), Math.max(o, W - c.size - o)),
    y: Math.min(Math.max(o, y), Math.max(o, H - c.size - o)),
  };
}

// ---- 自己写的 CSS ----
//
// 整段包进 `.qb-layer { ... }`（CSS 嵌套）：`.qb-ball {}` 变成 `.qb-layer .qb-ball`，
// 写 `body {}`、`.root {}` 的变成 `.qb-layer body`，什么都选不中，改不到悬浮球以外。
// @keyframes、@font-face 放在规则里面不生效，挑出来留在最外层；@import 一律去掉（不许从别处拉样式）。
// 写了 & 的那段不收（见下）。不认嵌套的旧浏览器整段丢掉，结果是「没生效」，不是「改坏了别处」。
const HOIST = /^@(-webkit-)?(keyframes|font-face)\b/i;
export function scopeCss(css) {
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const top = [];
  const inner = [];
  let i = 0;
  while (i < src.length) {
    // 下一段顶层的东西：到分号（@import 那种）或配平的大括号为止
    let j = i;
    let depth = 0;
    let quote = '';
    let stray = false;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (quote) { if (ch === '\\') j++; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { stray = depth === 0; depth--; if (depth <= 0) { j++; break; } }
      else if (ch === ';' && depth === 0) { j++; break; }
    }
    // 多出来的右括号会提前合上外面那层 .qb-layer，让后面的规则漏到全局：那一段整个丢掉。
    // 少了的右括号补上
    let chunk = src.slice(i, j).trim();
    i = j;
    if (!chunk || stray) continue;
    if (depth > 0) chunk += '}'.repeat(depth);
    if (/^@import\b/i.test(chunk) || /^@charset\b/i.test(chunk)) continue;
    if (HOIST.test(chunk)) { top.push(chunk); continue; }
    // 写了 & 的规则不再自动带上 .qb-layer 前缀（`& ~ *` 选得到悬浮球后面的一切）：整段不收
    if (chunk.includes('&')) continue;
    inner.push(chunk);
  }
  const body = inner.join('\n');
  return [...top, body ? `.qb-layer {\n${body}\n}` : ''].filter(Boolean).join('\n');
}

// ---- 当前对话 ----
// 会话页打开时把自己能做的几件事登记在这里（让角色接着说、重新生成……），关掉时撤掉。
// 球只在「现在正看着的就是这一段」时才给这一组
export const chatStore = createStore({ chatId: null, charId: null, group: false, api: null });

export function bindChat(chatId, { charId = null, group = false, api }) {
  chatStore.set({ chatId, charId, group, api });
  return () => { if (chatStore.get().chatId === chatId) chatStore.set({ chatId: null, charId: null, group: false, api: null }); };
}
