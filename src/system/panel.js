import { settings } from './db/index.js';

// 会话输入框上面那一格一格的面板。
//
// 格子多了之后一屏放不下，所以分两层：常用的留在面板上，其余收进「更多」。
// **哪些留在面板上、按什么顺序，全由用户自己定**，代码只给一个默认。
//
// 顺序和「在不在面板上」分成两个字段存，不是存一个「面板上的清单」：
// 那样从更多里挪回来时，它只能落在末尾，用户上次排好的位置就丢了。
// 分开存，挪进挪出都不动顺序。

export const ITEMS = [
  // 世界书与文风：这段会话用哪几本书、线下时的文风。放在「更多」最上面（4.282）
  { id: 'lore', icon: 'book', label: '世界书与文风' },
  { id: 'photo', icon: 'image', label: '图片' },
  { id: 'voice', icon: 'headphone', label: '语音' },
  { id: 'transfer', icon: 'wallet', label: '转账' },
  { id: 'call', icon: 'phone', label: '通话' },
  { id: 'video', icon: 'film', label: '视频通话' },
  { id: 'gift', icon: 'gift', label: '礼物' },
  { id: 'location', icon: 'map', label: '位置' },
  { id: 'listen', icon: 'music', label: '一起听' },
  { id: 'song', icon: 'disc', label: '分享音乐' },
  { id: 'watch', icon: 'film', label: '一起看' },
  { id: 'takeout', icon: 'cup', label: '点外卖' },
  { id: 'request', icon: 'users', label: '申请' },
  { id: 'share', icon: 'compass', label: '共享位置' },
  { id: 'dice', icon: 'grid', label: '骰子' },
  { id: 'offline', icon: 'book', label: '线下' },
  { id: 'makeclip', icon: 'sparkle', label: '生成视频' },
  // HTML 卡片：自己填一张发出去（ARCHITECTURE 4.253）
  { id: 'card', icon: 'layers', label: '卡片' },
  { id: 'file', icon: 'folder', label: '文件' },
];

const ALL = ITEMS.map(x => x.id);
export const itemOf = id => ITEMS.find(x => x.id === id) || null;

// 默认收进「更多」的：不常用，或者一次配好就不怎么动的那几个
const DEFAULT_MORE = ['lore', 'video', 'share', 'dice', 'request', 'makeclip', 'card', 'file'];

/**
 * 读出一份干净的顺序。丢掉不认识的 id，补上配置里缺失的 ——
 * 没有这一步，以后每新增一格，老用户的面板里就少一格，而且是静默的。
 * 和注入区块那边 resolveOrder 同一个道理（见 4.2 B2）。
 */
export function order() {
  const raw = settings.get().panelOrder;
  const seen = new Set();
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(id => {
    if (ALL.includes(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  });
  // 新加的一格补在末尾；只有世界书那一格补在最前面 —— 它就该在「更多」的顶上（4.282）
  ALL.forEach(id => { if (!seen.has(id)) { seen.add(id); if (id === 'lore') out.unshift(id); else out.push(id); } });
  return out;
}

export function moreSet() {
  const raw = settings.get().panelMore;
  // 从来没设过（undefined）才用默认。设成空数组是「我全都要放面板上」
  const list = Array.isArray(raw) ? raw : DEFAULT_MORE;
  return new Set(list.filter(id => ALL.includes(id)));
}

/** 面板上那几格，按用户排的顺序。 */
export function onPanel() {
  const more = moreSet();
  return order().filter(id => !more.has(id));
}

export function setMore(id, yes) {
  const next = moreSet();
  if (yes) next.add(id); else next.delete(id);
  settings.set({ panelMore: [...next] });
}

/** 往上或往下挪一格。dir 是 -1 或 1。 */
export function move(id, dir) {
  const list = order();
  const i = list.indexOf(id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  settings.set({ panelOrder: list });
  return list;
}

export function reset() {
  settings.set({ panelOrder: [...ALL], panelMore: [...DEFAULT_MORE] });
}
