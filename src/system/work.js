import { works, chapters, beats, characters, chats, settings } from './db/index.js';
import * as accounts from './accounts.js';

// 「我们」。一部作品 + 一篇一篇的正文。见 ARCHITECTURE 4.117
//
// **正文那一套整个复用线下的**（`system/scene.js` 的 beats 那一半）：
// 分段、分版、续写、编辑、分张全是同一批函数，一行都没有再写一遍。
// 这边只管「作品是什么」「篇怎么排」「提示词怎么拼」。
//
// 两种体裁，差别只在三个字段上，不是两套代码：
//
// | | 长篇 | 番外 |
// |---|---|---|
// | 篇 | 一章一章，有编号 | 一则就是一篇 |
// | 身份 | 可以整套换掉 | 就是原来那两个人 |
// | 原来的记忆 | 自己选带不带 | 一直带（小剧场是「如果当时…」，要知道原来的事）|

export const SAGA = 'saga';      // 长篇
export const EXTRA = 'extra';    // 番外
export const KINDS = [
  { id: SAGA, label: '长篇', desc: '有主线，一章一章往下写。可以换一套身份重新开始' },
  { id: EXTRA, label: '番外', desc: '一则小剧场。沿用现在的身份与记忆，不进记忆，不影响主线' },
];
export const kindLabel = k => (KINDS.find(x => x.id === k) || KINDS[1]).label;

export const get = id => works.get(id);
export const all = () => works.all().sort(byTime);
const byTime = (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

export const ofChat = chatId => works.byIndex(chatId).slice().sort(byTime);

/**
 * 新建一部作品。
 *
 * `carry` 是「带不带原来的记忆」：番外一律带（小剧场要知道原来发生过什么），
 * 长篇由用户在新建时决定 —— 同一个角色，有人想要完全新开始，有人想要
 * 「还是我们俩，只是换了个世界」。两种都写得出来，所以不替他定（第 16 条）。
 *
 * `solo` 是「整篇它写」：开着时模型连「我」那个角色的言行一起写，读起来
 * 是小说；关着是轮流写，和线下一样。也由用户定。
 */
export function create({ chatId, kind = EXTRA, title = '', castIds = [],
  premise = '', charAs = null, meAs = null, carry = null, solo = false,
  opening = 'char', tone = '', toneText = '' }) {
  const chat = chats.get(chatId);
  const cast = castIds.length ? castIds : (chat?.characterIds || []).slice();
  const k = kind === SAGA ? SAGA : EXTRA;
  settings.set({ workToneLast: String(tone || '') });
  return works.create({
    chatId, kind: k,
    title: String(title || '').trim(),
    castIds: cast,
    premise: String(premise || '').trim(),
    charAs: asIdentity(charAs),
    meAs: asIdentity(meAs),
    // 番外不给这个开关：它就是这段关系的小剧场，不带原来的事就写不出来
    carry: k === EXTRA ? true : carry === true,
    solo: !!solo,
    // 新的一篇由谁开场。定在作品上而不是每一篇上 —— 一部作品里每一篇
    // 都是同一个写法，不该每开一篇再问一次
    opening: opening === 'me' ? 'me' : 'char',
    tone: String(tone || ''), toneText: String(toneText || ''),
    cover: null, state: 'writing',
    createdAt: Date.now(), updatedAt: Date.now(),
  });
}

const asIdentity = v => ({ name: String(v?.name || '').trim(), persona: String(v?.persona || '').trim() });

export function update(id, patch) {
  if (!works.has(id)) return null;
  const next = { ...patch };
  if ('charAs' in next) next.charAs = asIdentity(next.charAs);
  if ('meAs' in next) next.meAs = asIdentity(next.meAs);
  // 番外那个开关不存在，别让改别的字段时顺手把它关掉
  if (works.get(id)?.kind === EXTRA) delete next.carry;
  return works.update(id, { ...next, updatedAt: Date.now() });
}

/** 删一部作品，连着它的篇与每一篇的正文。漏一层就是一堆没人认领的行。 */
export function remove(id) {
  chaptersOf(id).forEach(c => removeChapter(c.id));
  works.remove(id);
}

export const castOf = work => (work?.castIds || []).map(cid => characters.get(cid)).filter(Boolean);

/** 这部作品里角色叫什么、是谁。换过身份就按新的来，没换就是本来那个。 */
export function charOf(work) {
  const base = characters.get((work?.castIds || [])[0]) || null;
  const as = work?.charAs || {};
  return {
    id: base?.id || '',
    base,
    name: as.name || base?.name || '对方',
    persona: as.persona || base?.persona || '',
    avatar: base?.avatar || null,
    renamed: !!as.name,
  };
}

/** 这部作品里「我」叫什么。 */
export function meOf(work) {
  const base = accounts.get(chats.get(work?.chatId)?.personaId) || accounts.current() || null;
  const as = work?.meAs || {};
  return {
    base,
    name: as.name || base?.name || '我',
    persona: as.persona || base?.description || '',
    avatar: base?.avatar || null,
    renamed: !!as.name,
  };
}

// ---- 篇 ----
//
// 长篇里叫「章」，番外里叫「则」。同一种行，只是列表上的叫法不同。

export const chaptersOf = workId => chapters.byIndex(workId)
  .slice()
  .sort((a, b) => (a.no || 0) - (b.no || 0) || (a.createdAt || 0) - (b.createdAt || 0));

export const getChapter = id => chapters.get(id);
export const workOfChapter = id => works.get(chapters.get(id)?.workId || '') || null;

export function addChapter(workId, { title = '', place = '', at = '', note = '' } = {}) {
  const w = works.get(workId);
  if (!w) return null;
  const no = chaptersOf(workId).reduce((n, c) => Math.max(n, c.no || 0), 0) + 1;
  const row = chapters.create({
    workId, no,
    title: String(title || '').trim(),
    place: String(place || '').trim(),
    at: String(at || '').trim(),
    note: String(note || '').trim(),
    opening: w.opening === 'me' ? 'me' : 'char',
    summary: '', endedAt: 0, stage: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  works.update(workId, { updatedAt: Date.now() });
  return row;
}

export function updateChapter(id, patch) {
  if (!chapters.has(id)) return null;
  const row = chapters.update(id, { ...patch, updatedAt: Date.now() });
  if (row) works.update(row.workId, { updatedAt: Date.now() });
  return row;
}

export function removeChapter(id) {
  const row = chapters.get(id);
  if (!row) return;
  beats.byIndex(id).slice().forEach(b => beats.remove(b.id));
  chapters.remove(id);
  works.update(row.workId, { updatedAt: Date.now() });
}

/** 往前挪一章或往后挪一章。编号跟着换，正文不动。 */
export function moveChapter(id, dir) {
  const row = chapters.get(id);
  if (!row) return false;
  const list = chaptersOf(row.workId);
  const at = list.findIndex(c => c.id === id);
  const to = at + (dir < 0 ? -1 : 1);
  if (at < 0 || to < 0 || to >= list.length) return false;
  const other = list[to];
  chapters.update(row.id, { no: other.no, updatedAt: Date.now() });
  chapters.update(other.id, { no: row.no, updatedAt: Date.now() });
  return true;
}

/** 这一篇写到哪儿了。摘要有就用摘要，没有就截正文的末尾。 */
export function digestOf(chapterId, chars = 400) {
  const row = chapters.get(chapterId);
  if (!row) return '';
  if (row.summary) return row.summary;
  const list = beats.byIndex(chapterId).slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .filter(b => b.role !== 'director' && String(b.text || '').trim());
  const last = list[list.length - 1];
  const t = String(last?.text || '').trim();
  const n = Math.max(0, Math.round(Number(chars) || 0));
  if (!t || !n) return t;
  return t.length <= n ? t : `…${t.slice(-n)}`;
}

/** 这一篇现在几点。最后一段写了时刻就用它，没有就退回这一篇填的那个。 */
export function timeOf(chapterId) {
  const list = beats.byIndex(chapterId).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (let i = list.length - 1; i >= 0; i--) if (list[i].at) return list[i].at;
  return chapters.get(chapterId)?.at || '';
}

/**
 * 一段的署名。和线下那个的差别只有一处：名字按这部作品里的身份来。
 * 头像仍然用本人的 —— 换身份换的是名字与人设，不是脸。
 */
export function signOf(beat, chapter, work) {
  if (!beat) return null;
  const mine = beat.role === 'me';
  const who = mine ? meOf(work) : charOf(work);
  return {
    place: beat.place || chapter?.place || '',
    time: beat.at || '',
    name: who.name,
    face: who.avatar || null,
    mine,
  };
}

/** 数一数：几篇、多少字。列表上要摆出来。 */
export function statsOf(workId) {
  const list = chaptersOf(workId);
  let chars = 0;
  list.forEach(c => beats.byIndex(c.id).forEach(b => {
    if (b.role !== 'director') chars += String(b.text || '').length;
  }));
  return { chapters: list.length, chars };
}
