import { chats, messages } from './db/index.js';
import * as toneLib from './tone.js';

// 会话页上的线上 / 线下切换。见 ARCHITECTURE 4.269
//
// 用户的话：「直接在线上手机聊天的那个页面转为线下」「直接发短信但是变成我们俩在线下面对面」。
// 不另开页面、不另开会话、不写长文：还是这条消息流、还是气泡，只是切过去之后两个人在同一处，
// 每轮至少一行旁白写此刻看得见的。切回来接着发消息。
//
// 存法：会话上一个 `face` 对象记着现在是不是线下、在哪、几点、什么情境；切换那一刻落一条
// `kind: 'side'` 的消息当分隔线；之后发出和生成的每条消息记 `side: 'face'`。老消息没有这个字段，
// 一律视为线上。历史进提示词时按 side 的变化插「以下当面」「以下在手机上」两种标记（engine.buildHistory），
// 模型能看见此前哪段是发消息、哪段是见面 —— 这就是「不混在一起」的全部机制。
//
// 和「线下」app（长文、翻页，system/scene.js）互不影响：那边是另一条链路。

export const FACE = 'face';
export const PHONE = 'phone';

export const on = chat => chat?.face?.on === true;
export const infoOf = chat => (chat?.face && typeof chat.face === 'object' ? chat.face : null);
export const sideOf = m => (m?.side === FACE ? FACE : PHONE);

const clean = s => String(s || '').trim();

/** 分隔线上写的那几个字：地点 · 时刻 */
export function labelOf(info) {
  const t = [clean(info?.place), clean(info?.at)].filter(Boolean).join(' · ');
  return t ? `线下 · ${t}` : '线下';
}

/** 切到线下。落一条分隔线，之后的消息都算当面。已经在线下时只改这几项 */
export function enter(chatId, { place = '', at = '', note = '' } = {}) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  const info = { on: true, place: clean(place), at: clean(at), note: clean(note), since: Date.now() };
  if (on(chat)) { chats.update(chatId, { face: { ...chat.face, ...info, since: chat.face.since || info.since } }); return null; }
  chats.update(chatId, { face: info, lastMessageAt: Date.now() });
  return messages.create({
    chatId, role: 'user', authorId: 'me', kind: 'side', side: FACE, status: 'done',
    face: { place: info.place, at: info.at, note: info.note },
    content: `[${labelOf(info)}]`,
  });
}

/** 改这一场的地点、时刻、情境。分隔线上那条也跟着改，历史里读到的才是改后的 */
export function update(chatId, patch) {
  const chat = chats.get(chatId);
  if (!chat || !on(chat)) return;
  const info = { ...chat.face, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, clean(v)])) };
  chats.update(chatId, { face: info });
  const line = messages.where(m => m.chatId === chatId && m.kind === 'side' && m.side === FACE).pop();
  if (line) messages.update(line.id, { face: { place: info.place, at: info.at, note: info.note }, content: `[${labelOf(info)}]` });
}

/** 切回线上。落一条分隔线；地点那几项留在 chat.face 里当下次的预填 */
export function leave(chatId) {
  const chat = chats.get(chatId);
  if (!chat || !on(chat)) return null;
  chats.update(chatId, { face: { ...chat.face, on: false, since: 0 }, lastMessageAt: Date.now() });
  return messages.create({
    chatId, role: 'user', authorId: 'me', kind: 'side', side: PHONE, status: 'done', content: '[回到线上]',
  });
}

/** 分隔线那一条在历史里读成什么。抬头是协议（中文），说明那句在模板里 */
export const isMark = m => m?.kind === 'side';

// ---- 线下时的世界书与文风。都记在会话上，切换那张单子里改（第 5 条：开关放在它起作用的地方）----

export const offBooks = chat => (Array.isArray(chat?.faceOffBookIds) ? chat.faceOffBookIds : []);
export const extraBooks = chat => (Array.isArray(chat?.faceBookIds) ? chat.faceBookIds : []);
export const books = chat => ({ extra: extraBooks(chat), off: offBooks(chat) });
export function setBooks(chatId, { off, extra } = {}) {
  const patch = {};
  if (Array.isArray(off)) patch.faceOffBookIds = off.filter(Boolean);
  if (Array.isArray(extra)) patch.faceBookIds = extra.filter(Boolean);
  chats.update(chatId, patch);
}

/** 文风：和线下那一场同一份预设库、同样可以多选（4.267） */
export const tonesOf = chat => toneLib.asTones(chat?.faceTones || []);
export const toneText = chat => toneLib.forScene({ tones: tonesOf(chat), toneText: chat?.faceToneText || '' });
export function setTones(chatId, tones, text) {
  const patch = { faceTones: toneLib.asTones(tones) };
  if (text !== undefined) patch.faceToneText = String(text || '');
  chats.update(chatId, patch);
}

/**
 * 线下时给哪些能力。面对面，手机上的动作（转账、外卖、表情、图片、语音、打电话）九成不成立，
 * 留下的是当面也说得通的：旁白、心声、时刻、译文、引用、骰子、礼物、标识、衣帽间标记、备注、撤回
 */
export const CAPS = new Set(['narration', 'inner', 'time', 'translate', 'quote', 'dice', 'gift', 'award',
  'closetact', 'remark', 'recall', 'card', 'mcp']);
