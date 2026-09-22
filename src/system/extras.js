import { messages, chats, characters, settings } from './db/index.js';
import * as accounts from './accounts.js';

// 关系小件。四样东西凑在一个模块里，因为它们是同一类东西：
// 都很小、都长在「这段关系」上、都不值得各开一个文件。
//
//   **拍一拍** 双击头像，落一行提示；
//   **骰子**   本地掷点，角色这一轮还不知道结果；
//   **特别关心** 通知加个前缀，动态也弹一下；
//   **心声**   她这句话背后真正想的，默认藏着，点头像才看。

const trim = (v, n) => String(v || '').trim().slice(0, n);

// ---- 拍一拍 ----
//
// 后缀归**被拍的那一方**设：别人拍我，显示的是我给自己设的那一句。
// 所以拍角色时读角色卡上的，角色拍我时读我自己的。

export const PAT_SUFFIXES = ['的头', '的肩膀', '的脸', '的头发', '的尾巴', '的脑门'];
export const DEFAULT_PAT = PAT_SUFFIXES[0];

export const patOfChar = char => trim(char?.patSuffix, 20) || DEFAULT_PAT;
export const patOfMine = () => trim(settings.get().patSuffix, 20) || DEFAULT_PAT;

export function setMyPat(text) { settings.set({ patSuffix: trim(text, 20) }); }
export function setCharPat(charId, text) { characters.update(charId, { patSuffix: trim(text, 20) }); }

/**
 * 拍一下。role 是谁拍的。
 *
 * 落的是一行提示，不是一条消息 —— 拍一拍不是「说了句话」，
 * 它就是这件事本身。提示行的正文会进上下文，所以对面知道被拍了。
 */
export function pat({ chatId, role = 'user' }) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  const char = characters.get((chat.characterIds || [])[0]);
  const me = accounts.get(chat.personaId) || accounts.current();
  const meName = me?.name || '我';
  const charName = char?.name || '对方';

  const text = role === 'user'
    ? `${meName}拍了拍${charName}${patOfChar(char)}`
    : `${charName}拍了拍${meName}${patOfMine()}`;

  const msg = messages.create({
    chatId, role, authorId: role === 'user' ? 'me' : (char?.id || ''),
    kind: 'notice', pat: true, content: `[${text}]`, status: 'done',
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

// ---- 骰子 ----
//
// 点数是本地掷的。让模型自己写一个数，它会一直写 6 和 1 —— 那不是随机，
// 是它对「戏剧性」的偏好。和随机事件、距离、金额同一条规矩：
// **数字不是模型的活**。
//
// 还有一层：掷出来的那一条要到**下一轮**才进历史，所以角色写下 [骰子]
// 的那一刻并不知道点数。这和礼物拆开之前不知道里面是什么是同构的 ——
// 信息控制本身就是玩法。

export const FACES = [6, 20, 100];
// 少于两面的骰子没有意义，一律落回默认的六面 —— 夹到两面等于凭空
// 给了用户一个他没要过的硬币。
const cleanFaces = n => {
  const v = Math.round(Number(n) || 0);
  return v >= 2 ? v : 6;
};
export const facesOf = chat => cleanFaces(chat?.diceFaces);
export function setFaces(chatId, n) { chats.update(chatId, { diceFaces: cleanFaces(n) }); }

/**
 * 掷一次。
 *
 * `row` 是角色那条路上传进来的整行底子（`turnId`、`authorId`、`createdAt`
 * 那几样）。**从前这里自己拼字段，于是掷出来的那一条不属于任何一轮** ——
 * 重新生成这一轮时 `clearTurn` 按 turnId 删，删不到它，它就留成孤儿挂在
 * 那儿；手动重新分条时同样换不掉。用户自己点骰子那条路不传 row，照旧。
 */
export function roll({ chatId, role = 'user', faces, rng = Math.random, row = null } = {}) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  const char = characters.get((chat.characterIds || [])[0]);
  const n = faces === undefined ? facesOf(chat) : cleanFaces(faces);
  const value = 1 + Math.floor(rng() * n);

  const msg = messages.create({
    ...(row || {}),
    chatId, role, authorId: row?.authorId || (role === 'user' ? 'me' : (char?.id || '')),
    kind: 'dice', faces: n, value,
    content: n === 6 ? `[骰子：${value}]` : `[骰子：${value}（${n} 面）]`,
    status: 'done',
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

// ---- 特别关心 ----

export const STAR_PREFIX = '【特别关心】';
export const isStarred = char => !!(char && char.star);
export function setStar(charId, on) { characters.update(charId, { star: !!on }); }

// 通知标题前面加那一句。没开就原样返回 —— 调用方不必自己判断。
export const starTitle = (char, title) =>
  (isStarred(char) ? STAR_PREFIX : '') + String(title || '');

// ---- 心声 ----
//
// 她这句话背后真正想的那一层。两种产出方式，差别只在**花不花第二次钱**：
//
//   inline 让她在同一次回复里多写一行 [心声：…]。不额外调接口，
//          但心声和台词出自同一次生成，多少会互相迁就。
//   apart  整轮说完之后另起一次调用，只问「刚才那几句话背后你在想什么」。
//          隔了一次，写出来的东西更像背面那一层，代价是每轮多一次调用。
//
// 默认关。见 CLAUDE.md 第 13 条：要花钱的必须能关，而且得说清楚开了多花什么。

export const INNER_OFF = 'off';
export const INNER_INLINE = 'inline';
export const INNER_APART = 'apart';

export const INNER_STYLES = [
  { id: 'quiet', label: '淡色小字' },
  { id: 'card', label: '独立卡片' },
];

export function innerMode(chat) {
  const m = chat?.innerMode;
  return m === INNER_INLINE || m === INNER_APART ? m : INNER_OFF;
}
export const innerOn = chat => innerMode(chat) !== INNER_OFF;
export function setInnerMode(chatId, mode) {
  chats.update(chatId, { innerMode: [INNER_INLINE, INNER_APART].includes(mode) ? mode : INNER_OFF });
}

export function innerStyle() {
  const s = settings.get().innerStyle;
  return INNER_STYLES.some(x => x.id === s) ? s : 'quiet';
}
export function setInnerStyle(id) { settings.set({ innerStyle: id }); }

// 写回某一条消息的心声。空字符串等于清掉。
export function setInnerText(msgId, text) {
  const m = messages.get(msgId);
  if (!m) return null;
  return messages.update(msgId, { inner: trim(text, 300) });
}

// 这一轮该把心声挂在哪一条上：最后一条角色说的话。
// 挂在第一条上会抢在台词前面被读到，那就不是「背后那一层」了。
export function innerTarget(created) {
  for (let i = (created || []).length - 1; i >= 0; i--) {
    const m = created[i];
    if (m && m.role === 'char' && m.kind === 'text') return m;
  }
  return null;
}
