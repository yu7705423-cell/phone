import { scenes, beats, characters, chats, settings } from './db/index.js';
import * as accounts from './accounts.js';
import * as story from './closet-story.js';
import * as toneLib from './tone.js';

const asIds = v => [...new Set((Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(Boolean))];

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
  opening = CHAR, tone = '', tones = null, toneText = '', inline = false, offBookIds = [], bookIds = [] }) {
  const chat = chats.get(chatId);
  const cast = castIds.length ? castIds : (chat?.characterIds || []).slice();
  // 文风可以多选（4.267）。老调用方还传单个 tone，一并收
  const picked = toneLib.asTones(tones ?? tone);
  // 记住这一次挑的文风、关掉的书，下次新建时预填。这不是第二个开关，只是个默认值 ——
  // 开关仍然只有一个，在这一场自己身上（第 5 条）
  settings.set({ sceneToneLast: picked, sceneBooksOffLast: asIds(offBookIds), sceneBooksOnLast: asIds(bookIds) });
  return scenes.create({
    chatId, title: String(title || '').trim(), place: String(place || '').trim(),
    at: String(at || '').trim(), castIds: cast, note: String(note || '').trim(),
    opening: opening === ME ? ME : CHAR,
    tones: picked, toneText: String(toneText || ''),
    // 这一场关掉哪几本世界书、额外挂上哪几本（4.268）
    offBookIds: asIds(offBookIds), bookIds: asIds(bookIds),
    // 在聊天里直接演的那种。和单开一页只差「画在哪儿」，规则、
    // 提示词、数据全是同一套（见 ARCHITECTURE 4.110）
    inline: !!inline, endedAt: 0,
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

/**
 * 这段会话里正开着的那一场（在聊天里演的那种）。
 *
 * 只认没收场的。收了场的留在原处照样看得见，只是输入框回到线上。
 */
export const openInline = chatId => ofChat(chatId)
  .find(r => r.inline && !r.endedAt) || null;

/** 收场。不删，只是把输入框还给线上。 */
export function endScene(id) {
  if (!scenes.has(id)) return null;
  return update(id, { endedAt: Date.now() });
}

export const castOf = scene => (scene?.castIds || []).map(cid => characters.get(cid)).filter(Boolean);

// ---- 正文 ----

export const beatsOf = sceneId => beats.byIndex(sceneId)
  .slice()
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

// ---- 衣帽间的标记（ARCHITECTURE 4.217） ----
//
// 角色写的那一段里的 [换上：…] [借走：…] [塞进包里：…] 这几个，从正文里摘掉、照做，
// 做了什么记在那一版上（acts）。换一版、删掉那一段时照着撤回，再按新的那一版做一遍。
// 只认这一场存在的（「我们」那边的章节也走 addBeat，但那不是一场戏）

const marks = (sceneId, role, authorId, text) => (role === CHAR && scenes.has(sceneId)
  ? story.takeMarks(text, { sceneId, charId: authorId }) : { text: String(text || ''), done: [] });

const curOf = row => {
  const list = versionsOf(row);
  return list[Math.max(0, Math.min(list.length - 1, Number(row?.swipeIndex) || 0))] || null;
};

/** 这一段当前这一版做了的几件事（给界面提示用） */
export const actsOf = row => (curOf(row)?.acts || []).filter(a => a.text || a.slipId);

// 换到另一版：旧的那一版做过的撤回，新的那一版按它的原文再做一遍
function redo(row, from, to) {
  if (from?.acts?.length) story.undoAll(from.acts, row.sceneId);
  if (!to || row.role !== CHAR) return to;
  return { ...to, acts: marks(row.sceneId, row.role, row.authorId, to.marked || to.raw || to.text).done };
}

export function addBeat({ sceneId, role, authorId = '', text = '', raw = '', think = '', at = '' }) {
  const m = marks(sceneId, role, authorId, text);
  // 摘掉标记之前的原文也留着（marked）：换回这一版时要按它再做一遍，而 raw 不一定有
  const one = { text: m.text, raw: String(raw || ''), think: String(think || ''), at: String(at || ''),
    ...(m.done.length ? { acts: m.done, marked: String(text || '') } : {}) };
  const row = beats.create({
    sceneId, role, authorId, ...one,
    swipes: [one], swipeIndex: 0, pinned: false,
    createdAt: Date.now(),
  });
  update(sceneId, {});
  return row;
}

// ---- 一段的几个版本 ----
//
// 重写**不删旧的**，往后添一版，自己翻着挑。老的行里 swipes 存的是裸字符串，
// 这里统一收成对象 —— 不收的话翻到那一版正文会变成 undefined。

const asVersion = v => (typeof v === 'string'
  ? { text: v, raw: v, think: '', at: '' }
  : { text: '', raw: '', think: '', at: '', ...(v || {}) });

export const versionsOf = beat => (Array.isArray(beat?.swipes) ? beat.swipes : []).map(asVersion);

const face = v => ({ text: v.text, raw: v.raw, think: v.think, at: v.at });

/** 添一版，并且切到它。 */
export function addSwipe(id, v) {
  const row = beats.get(id);
  if (!row) return null;
  const cur = curOf(row);
  if (cur?.acts?.length) story.undoAll(cur.acts, row.sceneId);
  const m = marks(row.sceneId, row.role, row.authorId, asVersion(v).text);
  const one = { ...asVersion(v), text: m.text, ...(m.done.length ? { acts: m.done, marked: asVersion(v).text } : {}) };
  const list = [...versionsOf(row), one];
  return updateBeat(id, { swipes: list, swipeIndex: list.length - 1, ...face(one) });
}

/** 翻到第几版。 */
export function pickSwipe(id, i) {
  const row = beats.get(id);
  const list = versionsOf(row);
  const n = Math.max(0, Math.min(list.length - 1, Math.round(Number(i) || 0)));
  if (!list.length) return null;
  const at = Math.max(0, Math.min(list.length - 1, Number(row.swipeIndex) || 0));
  if (at !== n) list[n] = redo(row, list[at], list[n]);
  return updateBeat(id, { swipes: list, swipeIndex: n, ...face(list[n]) });
}

/** 删掉当前这一版。只剩一版时不动 —— 那等于删掉整段，走删除那一项。 */
export function dropSwipe(id) {
  const row = beats.get(id);
  const list = versionsOf(row);
  if (list.length < 2) return null;
  const at = Math.max(0, Math.min(list.length - 1, Number(row.swipeIndex) || 0));
  const left = list.filter((_, i) => i !== at);
  const n = Math.min(at, left.length - 1);
  left[n] = redo(row, list[at], left[n]);
  return updateBeat(id, { swipes: left, swipeIndex: n, ...face(left[n]) });
}

/** 接着这一段往下写。续的是当前这一版，不另开一版。 */
export function appendBeat(id, { text = '', raw = '', at = '' }) {
  const row = beats.get(id);
  if (!row) return null;
  const m = marks(row.sceneId, row.role, row.authorId, text);
  const add = m.text.trim();
  if (!add && !m.done.length) return row;
  const merged = {
    text: `${row.text}\n${add}`.trim(),
    raw: `${row.raw || ''}\n${raw || ''}`.trim(),
    think: row.think || '',
    at: row.at || String(at || ''),
  };
  const list = versionsOf(row);
  const i = Math.max(0, Math.min(list.length - 1, Number(row.swipeIndex) || 0));
  if (list.length) list[i] = { ...list[i], ...merged, acts: [...(list[i].acts || []), ...m.done],
    ...(m.done.length ? { marked: `${list[i].marked || list[i].text}\n${String(text || '')}`.trim() } : {}) };
  return updateBeat(id, { ...merged, swipes: list.length ? list : [{ ...merged, acts: m.done }] });
}

/** 改写这一段的正文。改的是当前这一版。 */
export function editBeat(id, text) {
  const row = beats.get(id);
  if (!row) return null;
  const body = String(text || '').trim();
  const list = versionsOf(row);
  const i = Math.max(0, Math.min(list.length - 1, Number(row.swipeIndex) || 0));
  if (list.length) list[i] = { ...list[i], text: body };
  return updateBeat(id, { text: body, swipes: list.length ? list : [{ text: body, raw: '', think: '', at: row.at || '' }] });
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
  story.undoAll(curOf(row)?.acts, row.sceneId);
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
  gone.forEach(b => { story.undoAll(curOf(b)?.acts, b.sceneId); beats.remove(b.id); });
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
  const who = mine ? me : characters.get(beat.authorId);
  return {
    place: beat.place || scene?.place || '',
    time: beat.at || '',
    name: who?.name || (mine ? '我' : ''),
    // 图片 id，不是解析好的地址 —— 解析要用 useImage，那是 hook，只能在组件里调
    face: who?.avatar || null,
    mine,
  };
}
