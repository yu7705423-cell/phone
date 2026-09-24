// 聊天背景与上下栏样式。见 ARCHITECTURE 4.198
//
// **这一段会话自己的设置，不是美化包。** 美化是一份能挂在几段会话上、能导出分享的样式；
// 这里是「这段会话换张背景、把栏调透一点」，存在会话记录上（chat.look），换一段不影响另一段。
// 两者同时在时，这里赢：`.page.look-top > .navbar` 比作者常写的 `.ph-navbar` 更具体。
//
// 值一律以 `--ph-*` 挂在 .page 上（第 18 条：只留一条路），真正的声明在 app.css。
// 没设过的那一栏**不挂类名也不发变量**，那一栏就还是应用自己的样子，美化照样盖得住。
//
// 背景图存在 images 域，登记在 purge.usedImageIds 与 charpack.collect（CLAUDE.md 备份完整性）。
import { chats, images } from './db/index.js';
import { PHOTO_MAX } from './db/images.js';

export const STYLES = [
  { id: 'solid', label: '实色' },
  { id: 'clear', label: '半透明' },
  { id: 'glass', label: '毛玻璃' },
];
export const FGS = [
  { id: '', label: '跟随主题' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];
// 预设几种低饱和的底色。和线下那几套主题一样，是给用户挑的一组值，不是设计令牌
// （tokens.css 开头那段）。空串是「跟随主题」，用当前主题的底色
export const COLORS = ['', '#FFFFFF', '#F2F2F7', '#E9E4DA', '#DCE4EA', '#E4DCE6', '#DDE6DA',
  '#8E8E93', '#3A3A3C', '#1C1C1E', '#000000'];

const BAR = { style: 'solid', color: '', alpha: 70, blur: 20, fg: '' };
const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const barOf = raw => {
  const b = { ...BAR, ...(raw || {}) };
  return {
    style: STYLES.some(s => s.id === b.style) ? b.style : 'solid',
    color: typeof b.color === 'string' && /^(#[0-9a-fA-F]{6})?$/.test(b.color) ? b.color : '',
    alpha: clamp(b.alpha, 0, 100, BAR.alpha),
    blur: clamp(b.blur, 0, 40, BAR.blur),
    fg: FGS.some(f => f.id === b.fg) ? b.fg : '',
  };
};

/** 一段会话的设置，缺的项补默认值。上下没分开时 bottom 就是 top */
export function lookOf(chat) {
  const l = chat?.look || {};
  const top = barOf(l.top);
  return {
    bg: typeof l.bg === 'string' ? l.bg : '',
    veil: clamp(l.veil, 0, 90, 0),
    split: !!l.split,
    top,
    bottom: l.split ? barOf(l.bottom) : top,
  };
}

/** 这一栏动过没有。实色、跟随主题、跟随字色 —— 就是应用本来的样子 */
export const barSet = b => b.style !== 'solid' || !!b.color || !!b.fg;
export const isSet = chat => { const l = lookOf(chat); return !!l.bg || barSet(l.top) || barSet(l.bottom); };

/** 改一部分。top / bottom 按项合并 */
export function setLook(chatId, patch) {
  const cur = chats.get(chatId)?.look || {};
  const next = { ...cur, ...patch };
  if (patch.top) next.top = { ...(cur.top || {}), ...patch.top };
  if (patch.bottom) next.bottom = { ...(cur.bottom || {}), ...patch.bottom };
  // 刚分开时，下面那一栏从上面那一栏抄一份起步，而不是跳回默认
  if (patch.split && !cur.split && !cur.bottom) next.bottom = { ...(next.top || {}) };
  chats.update(chatId, { look: next });
}

/** 换背景。旧图没人用了才真的删（images.remove 会先核一遍引用） */
function swapBg(chatId, id) {
  const old = chats.get(chatId)?.look?.bg || '';
  setLook(chatId, { bg: id });
  if (old && old !== id) images.remove(old);
}
export async function setBgFile(chatId, file) {
  swapBg(chatId, await images.put(file, PHOTO_MAX));
}
/** 相册里已有的图：直接引用同一个 id，不另存一份 */
export const setBgImage = (chatId, imageId) => swapBg(chatId, imageId);
export const clearBg = chatId => swapBg(chatId, '');

/** 全部恢复默认 */
export function reset(chatId) {
  const old = chats.get(chatId)?.look?.bg || '';
  chats.update(chatId, { look: null });
  if (old) images.remove(old);
}

/** 把这一段的设置照搬到其余全部会话（群聊在内）。背景图共用同一个 id */
export function applyToAll(chatId) {
  const look = chats.get(chatId)?.look || null;
  let n = 0;
  chats.all().forEach(c => {
    if (c.id === chatId) return;
    const old = c.look?.bg || '';
    chats.update(c.id, { look: look ? structuredClone(look) : null });
    if (old && old !== (look?.bg || '')) images.remove(old);
    n++;
  });
  return n;
}

const barVars = (b, side) => {
  if (!barSet(b)) return [];
  const alpha = b.style === 'solid' ? 100 : b.alpha;
  return [
    `--ph-bar-${side}:color-mix(in srgb, ${b.color || 'var(--bg)'} ${alpha}%, transparent)`,
    `--ph-bar-${side}-blur:${b.style === 'glass' ? b.blur : 0}px`,
  ];
};

/** 挂在 .page 上的类名与变量。bgUrl 是背景图的地址（useImage 给的），没有就不画背景 */
export function pageOf(chat, bgUrl) {
  const l = lookOf(chat);
  const cls = [];
  const vars = [];
  if (bgUrl) {
    cls.push('has-chat-bg');
    vars.push(`--ph-chat-bg:url("${bgUrl}")`, `--ph-chat-veil:${l.veil}%`);
  }
  for (const side of ['top', 'bottom']) {
    const b = l[side];
    if (!barSet(b)) continue;
    cls.push(`look-${side}`);
    if (b.fg) cls.push(`look-${side}-${b.fg}`);
    vars.push(...barVars(b, side));
  }
  // 网页自己画状态栏的时候（安卓全屏、安卓安装包、电脑），状态栏那一行在 .page 外面，
  // 读不到上面这几个变量。顶栏换了颜色，那一行给同一个颜色，不然顶上一条白的
  const status = barSet(l.top) ? (l.top.color || '') : '';
  return { cls: cls.join(' '), vars: vars.join(';'), fg: barSet(l.top) ? l.top.fg : '', status };
}
