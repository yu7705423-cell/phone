import { phones, phoneChats } from './db/index.js';

// 角色手机的数据层。
//
// 一个角色一台，一行装下：锁屏、壁纸、图标、备忘录、浏览记录。
// 那几样都不多，摊成几个域只会多几处要记得登记进备份的地方。
// 会话另算一个域（phoneChats），因为「进去之后再生成」改的正好是一整行。
//
// **这里只管存取，不调接口。** 生成在 ai/tasks/phone.js。

export const get = charId => phones.byIndex(charId)[0] || null;

const blank = charId => ({
  charId,
  lock: null,          // { code, why, hints: [] }。没生成过就是 null
  wallpaper: null,     // 图片 id。没有就用角色卡的封面
  icons: {},           // appId -> { name, icon }
  notes: [],           // 备忘录
  visits: [],          // 浏览记录
  createdAt: Date.now(),
});

/** 取那一行，没有就建一行。 */
export function ensure(charId) {
  return get(charId) || phones.create(blank(charId));
}

export function set(charId, patch) {
  const row = ensure(charId);
  return phones.update(row.id, patch);
}

// ---- 锁屏 ----
//
// 密码是按人设生成的：生日、一个数字、一件对它有意义的事。
// **生成的时候不给你看。** 看了就没得猜了 —— 这一下本来就是这个功能的全部意思。
//
// 猜不出来可以问它。提示是生成密码的那一次**一起**产出的，问的时候不再调接口
// （第 15 条：能一次要回来的不分两次）。提示问完了还猜不出，可以直接看答案。

/** 这台手机锁着没有。没生成过密码的不算锁着 —— 那是还没开始。 */
export const locked = charId => !!get(charId)?.lock?.code;

export const lockOf = charId => get(charId)?.lock || null;

export function setLock(charId, lock) {
  return set(charId, { lock: lock ? { ...lock, shown: 0 } : null });
}

/** 猜一次。对了返回 true，不落任何痕迹 —— 猜错几次不该被记下来。 */
export const tryCode = (charId, input) => {
  const code = String(lockOf(charId)?.code || '');
  return !!code && String(input || '').trim() === code;
};

/** 再要一条提示。要完了返回 null，界面据此改成「直接看答案」。 */
export function nextHint(charId) {
  const lock = lockOf(charId);
  if (!lock) return null;
  const list = lock.hints || [];
  const shown = Math.min(lock.shown || 0, list.length);
  if (shown >= list.length) return null;
  set(charId, { lock: { ...lock, shown: shown + 1 } });
  return list[shown];
}

/** 已经问出来的那几条。 */
export const shownHints = charId => {
  const lock = lockOf(charId);
  return lock ? (lock.hints || []).slice(0, lock.shown || 0) : [];
};

// 这一次打开应用期间，哪几台已经解开了。
//
// **不落库。** 存起来就等于「解过一次永远不用再解」，那这道锁只有第一次有用。
// 刷新页面重新锁上，进出各页之间不重复问。
const opened = new Set();
export const isOpen = charId => opened.has(charId);
export const open = charId => opened.add(charId);
export const relock = charId => opened.delete(charId);

// ---- 备忘录与浏览记录 ----
//
// 两样都存在 phones 那一行里，各是一个数组。**追加不覆盖**：
// 再生成一次是往后加，不是把上一次的抹掉 —— 抹掉的话「再来一次」
// 就成了「重掷一次」，上一次里合意的那几条也跟着没了。

const cap = (v, n) => String(v ?? '').trim().slice(0, n);

export const notesOf = charId => get(charId)?.notes || [];

export function addNotes(charId, rows) {
  const clean = (rows || [])
    .map(r => ({ title: cap(r?.title, 20), text: cap(r?.text, 400) }))
    .filter(r => r.title || r.text);
  if (!clean.length) return [];
  const next = [...notesOf(charId), ...clean];
  set(charId, { notes: next });
  return clean;
}

export const removeNote = (charId, i) => set(charId, {
  notes: notesOf(charId).filter((_, k) => k !== i),
});

export const visitsOf = charId => get(charId)?.visits || [];

export function addVisits(charId, rows) {
  const clean = (rows || [])
    .map(r => ({ query: cap(r?.query, 40), site: cap(r?.site, 30) }))
    .filter(r => r.query);
  if (!clean.length) return [];
  const next = [...clean, ...visitsOf(charId)];   // 新的在前，和真的浏览记录一样
  set(charId, { visits: next });
  return clean;
}

export const removeVisit = (charId, i) => set(charId, {
  visits: visitsOf(charId).filter((_, k) => k !== i),
});

// ---- 那台手机里的会话 ----
//
// 一条会话一行，消息内嵌。**分两步生成**：先生成「和谁在聊、最后一句是什么」
// 这份列表，点进某一条才生成那一段对话 —— 一次把十条会话的正文都要回来，
// 模型多半写到第三条就收尾了。

export const chatsOf = charId => phoneChats.byIndex(charId)
  .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));

export const chat = id => phoneChats.get(id);

export function addChat(charId, { npcId = '', name, preview = '', lastAt = Date.now() }) {
  const n = cap(name, 40);
  if (!n) return null;
  return phoneChats.create({
    charId, npcId: npcId || '', name: n, preview: cap(preview, 80),
    lines: [], lastAt, filled: false,
  });
}

/** 这台手机上已经有谁了。生成列表时发过去，让它别重复。 */
export const chatNames = charId => chatsOf(charId).map(c => c.name);

/**
 * 把一条会话的正文填上。「进去之后再生成」落在这儿。
 * from 只认两种：char 是这台手机的主人，other 是对面。
 */
export const fillChat = (id, lines) => phoneChats.update(id, {
  lines: (lines || []).map(l => ({
    from: l.from === 'char' ? 'char' : 'other',
    text: cap(l.text, 300),
  })).filter(l => l.text),
  filled: true,
});

export const removeChat = id => phoneChats.remove(id);

/** 这个角色那台手机整台清掉。 */
export function wipe(charId) {
  phoneChats.byIndex(charId).forEach(c => phoneChats.remove(c.id));
  const row = get(charId);
  if (row) phones.remove(row.id);
  opened.delete(charId);
}
