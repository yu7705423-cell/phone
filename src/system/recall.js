// 撤回。消息和动态两样，都是「对方那边收回去了，自己这边留着痕迹」。见 ARCHITECTURE 4.207
//
// **撤回不是删除。** 删除是整条从库里抹掉；撤回是在那一条上记一笔 `recalled`，
// 界面上折成一行「某某撤回了一条消息」，点一下还看得到原文 —— 用户要的正是这个。
//
//   消息  `msg.recalled = { at, by, seen }`
//         by    'user' 我撤回的 / 'char' 角色撤回的
//         at    从这一刻起算撤回。角色那一条写的是「发出后再过一会儿」，
//               所以先照常显示，过几秒才折起来 —— 看上去才像发出去又收回
//         seen  我撤回时，角色是不是已经回过话（回过就说明它读到了）
//
//   动态  `mo.recalled = { at }`   只有角色的动态会被撤回：我自己的直接删就是了
//
// 进上下文的写法（engine.buildHistory）：
//   我撤回的、角色没读到    [撤回了一条消息]
//   我撤回的、角色读到过    [撤回了一条消息：原文]
//   角色自己撤回的          原文，下一行 [撤回] —— 和它自己该写的格式一模一样，
//                           历史就是示范，写别的它会照着学别的
import { messages, moments, messagesOf } from './db/index.js';

/** 角色那一条发出去之后，隔多久折起来 */
export const CHAR_DELAY = 2500;

/** 这一条此刻算不算已撤回。角色那一条在撤回时刻之前还照常显示 */
export const isRecalled = (m, now = Date.now()) => !!(m?.recalled && (m.recalled.at || 0) <= now);

/** 还要过多久才折起来。已经折了、或者根本没撤回，给 0 */
export const waitOf = (m, now = Date.now()) =>
  (m?.recalled ? Math.max(0, (m.recalled.at || 0) - now) : 0);

/** 能不能由我撤回：只能撤回自己说的话，提示行、线下那一整场不算说的话 */
export const canRecall = m => !!m && m.role === 'user' && !m.recalled
  && m.kind !== 'notice' && m.kind !== 'scene';

/** 我撤回一条。回给更新后的那一条，不能撤回的给 null */
export function recallMine(id) {
  const m = messages.get(id);
  if (!canRecall(m)) return null;
  const seen = messagesOf(m.chatId).some(x => x.role === 'char'
    && x.kind !== 'notice' && (x.createdAt || 0) > (m.createdAt || 0));
  return messages.update(id, { recalled: { at: Date.now(), by: 'user', seen } });
}

/** 角色那一条的撤回字段。发出时就写上，at 在几秒以后 */
export const charMark = (now = Date.now()) => ({ at: now + CHAR_DELAY, by: 'char' });

/** 折起来那一行的字 */
export function lineOf(m, name) {
  return m?.recalled?.by === 'char' || m?.role === 'char'
    ? `${name || '对方'}撤回了一条消息`
    : '你撤回了一条消息';
}

/**
 * 我撤回的那一条进上下文的样子。text 是这一条原本要进去的文字（带着引用出处）。
 * 角色的消息不在这里换 —— 原文照进，末尾由 tailOf 补一行 [撤回]
 */
export function historyText(m, text) {
  if (!m?.recalled || m.role !== 'user') return text;
  return m.recalled.seen ? `[撤回了一条消息：${text}]` : '[撤回了一条消息]';
}

/** 角色自己撤回的那一条，末尾补的那一行。放在译文后面，和它该写的顺序一致 */
export const tailOf = m => (m?.recalled && m.role === 'char' ? '\n[撤回]' : '');

/** 会话列表那一行预览。不等那几秒：列表那一行不会为了到点再重画一次 */
export const previewOf = (m, name) => (m?.recalled ? lineOf(m, name) : null);

// ---- 动态 ----

export const momentRecalled = mo => !!mo?.recalled;
/** 还挂在朋友圈上的（没撤回的）。主屏小组件、主页照片格只数这些 */
export const liveMoments = list => list.filter(m => !m.recalled);

/** 角色最近一条还挂着的动态 */
export function latestMoment(charId) {
  return moments.all()
    .filter(m => m.authorId === charId && !m.recalled)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

/** 撤回一条动态。只收角色的；已经撤回过的不再动 */
export function recallMoment(id) {
  const mo = moments.get(id);
  if (!mo || mo.authorId === 'me' || mo.recalled) return null;
  return moments.update(id, { recalled: { at: Date.now() } });
}
