import { scenes, beats, characters, chats, settings } from './db/index.js';
import * as accounts from './accounts.js';

// 线下。一场戏 + 一段段正文。见 ARCHITECTURE 4.107
//
// 和线上共用底下的角色卡、世界书、记忆、人设、时刻 —— 那是同一段关系的两面，
// 所以一场戏挂在一段会话上。castIds 里可以再拉别的角色进来演群戏。

export { scenes, beats };

export const CHAR = 'char';
export const ME = 'me';
// 场外指示。作为指令进 prompt，**不占一张**，只在刊头留一个可以点开的标记。
// 内置提示词不替角色做判断（第 16 条），那些判断要有地方让用户自己下，
// 这就是那个地方。
export const DIRECTOR = 'director';

export const get = id => scenes.get(id);

export const ofChat = chatId => scenes.byIndex(chatId)
  .slice()
  .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

export function create({ chatId, title = '', place = '', at = '', castIds = [], note = '',
  opening = CHAR, tone = '', toneText = '' }) {
  const chat = chats.get(chatId);
  const cast = castIds.length ? castIds : (chat?.characterIds || []).slice();
  // 记住这一次挑的文风，下次新建时预填。这不是第二个开关，只是个默认值 ——
  // 开关仍然只有一个，在这一场自己身上（第 5 条）
  settings.set({ sceneToneLast: String(tone || '') });
  return scenes.create({
    chatId, title: String(title || '').trim(), place: String(place || '').trim(),
    at: String(at || '').trim(), castIds: cast, note: String(note || '').trim(),
    opening: opening === ME ? ME : CHAR,
    tone: String(tone || ''), toneText: String(toneText || ''),
    summary: '', stage: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
}

export function update(id, patch) {
  if (!scenes.has(id)) return null;
  return scenes.update(id, { ...patch, updatedAt: Date.now() });
}

/** 删一场戏，连着它的正文一起。漏掉正文的话那些行会永远留在库里。 */
export function remove(id) {
  beats.byIndex(id).slice().forEach(b => beats.remove(b.id));
  scenes.remove(id);
}

export const castOf = scene => (scene?.castIds || []).map(cid => characters.get(cid)).filter(Boolean);

// ---- 正文 ----

export const beatsOf = sceneId => beats.byIndex(sceneId)
  .slice()
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

export function addBeat({ sceneId, role, authorId = '', text = '', raw = '', think = '', at = '', swipes = null }) {
  const row = beats.create({
    sceneId, role, authorId, text: String(text || ''), raw: String(raw || ''),
    think: String(think || ''), at: String(at || ''),
    swipes: swipes || (raw ? [raw] : []), swipeIndex: 0, pinned: false,
    createdAt: Date.now(),
  });
  update(sceneId, {});
  return row;
}

export function updateBeat(id, patch) {
  if (!beats.has(id)) return null;
  const row = beats.update(id, patch);
  if (row) update(row.sceneId, {});
  return row;
}

export function dropBeat(id) {
  const row = beats.get(id);
  if (!row) return;
  beats.remove(id);
  update(row.sceneId, {});
}

/** 从这一段起往后全删。回到某一段重新分叉时用。 */
export function dropFrom(id) {
  const row = beats.get(id);
  if (!row) return 0;
  const list = beatsOf(row.sceneId);
  const at = list.findIndex(b => b.id === id);
  if (at < 0) return 0;
  const gone = list.slice(at);
  gone.forEach(b => beats.remove(b.id));
  update(row.sceneId, {});
  return gone.length;
}

export function togglePin(id) {
  const row = beats.get(id);
  if (!row) return false;
  updateBeat(id, { pinned: !row.pinned });
  return !row.pinned;
}

/** 这一场现在几点。最后一段写了时刻就用它，没有就退回开场填的那个。 */
export function timeOf(sceneId) {
  const list = beatsOf(sceneId);
  for (let i = list.length - 1; i >= 0; i--) if (list[i].at) return list[i].at;
  return get(sceneId)?.at || '';
}

// ---- 分张 ----
//
// 一段至少一张，超过 pageChars 就续张。**填 0 表示不切**，这一张里滚（第 13 条）。
// 几万字的长回复因此自动变成几十张，一张一张翻，比无限长的滚动条好读。

// 断在句末，不断在词中间。引号收口也算句末 —— 「……。」断在句号后面会把
// 收尾那个引号甩到下一张开头
const SENT_END = /(?<=[。！？!?…]["」』”’]?)/;

function cut(para, n) {
  if (para.length <= n) return [para];
  const out = [];
  let buf = '';
  for (const s of para.split(SENT_END)) {
    if (!s) continue;
    if (buf && buf.length + s.length > n) { out.push(buf); buf = ''; }
    if (s.length > n) {
      // 一整句就超过一张。硬切 —— 切句不成只好切字，总比一张塞不下强
      let rest = buf + s;
      buf = '';
      while (rest.length > n) { out.push(rest.slice(0, n)); rest = rest.slice(n); }
      buf = rest;
    } else buf += s;
  }
  if (buf) out.push(buf);
  return out;
}

export function paginate(text, chars) {
  const t = String(text || '').trim();
  const n = Math.max(0, Math.round(Number(chars) || 0));
  if (!t) return [''];
  if (!n || t.length <= n) return [t];

  const pages = [];
  let buf = '';
  const flush = () => { if (buf) { pages.push(buf); buf = ''; } };
  for (const para of t.split('\n').map(x => x.trim()).filter(Boolean)) {
    for (const piece of cut(para, n)) {
      if (buf && buf.length + 1 + piece.length > n) flush();
      buf = buf ? `${buf}\n${piece}` : piece;
    }
  }
  flush();
  return pages.length ? pages : [t];
}

/**
 * 整场摊平成一串张。
 *
 * 场外指示不占张，攒起来挂到它后面那一段的第一张上 —— 正文要干净，
 * 但用户得能回头看自己下过什么。
 */
export function pagesOf(sceneId, chars) {
  const out = [];
  let notes = [];
  let index = 0;
  for (const b of beatsOf(sceneId)) {
    if (b.role === DIRECTOR) { notes.push(b); continue; }
    const parts = paginate(b.text, chars);
    parts.forEach((text, j) => out.push({
      key: `${b.id}:${j}`, beat: b, beatIndex: index, page: j, pages: parts.length,
      text, first: j === 0, notes: j === 0 ? notes : [],
    }));
    notes = [];
    index += 1;
  }
  // 末尾还挂着的指示没有归宿，单独给一张收着，否则用户看不到自己刚写的那条
  if (notes.length) out.push({ key: `notes:${notes[notes.length - 1].id}`, beat: null, beatIndex: index, page: 0, pages: 1, text: '', first: true, notes });
  return out;
}

// ---- 署名 ----

/** 一段的署名要盖哪几样。空的那项不占位。 */
export function signOf(beat, scene) {
  if (!beat) return null;
  const mine = beat.role === ME;
  // 身份记在会话上，不在场次上 —— 换小号去找同一个角色开的是另一段会话
  const me = accounts.get(chats.get(scene?.chatId)?.personaId) || accounts.current();
  return {
    place: beat.place || scene?.place || '',
    time: beat.at || '',
    name: mine ? (me?.name || '我') : (characters.get(beat.authorId)?.name || ''),
    mine,
  };
}
