import { createStore } from './store.js';
import { chats, messages, settings } from './db/index.js';
import * as book from './book.js';
import * as watch from './watch.js';

// 一起读。和一起看同一个道理：角色那边没有第二本书，所以不做同步，
// 只把「读到哪一章、这一页写的是什么」摆到她面前。
//
// 和一起看的差别只有一处：**进度不按时间走，按翻页走。**
// 片子自己会往前跑，书不会 —— 人不翻页，这一页就一直停在那儿。
// 所以「她该不该开口」问的是翻过几页，不是过了几秒。

export const read = createStore({
  active: false,
  chatId: '', charId: '', bookId: '',
  at: 0, pages: 0, saidPage: -1, said: 0,
  awayAt: 0,
});

export const reading = () => read.get().active;
export const inChat = chatId => read.get().active && read.get().chatId === chatId;
export const current = () => (read.get().active ? book.get(read.get().bookId) : null);

const gap = () => Math.max(0, settings.get().readGap ?? 1);
const chars = () => Math.max(0, settings.get().readChars ?? 900);
const awayEnd = () => Math.max(0, settings.get().watchAwayEnd ?? 15);

export function start({ chatId, bookId }) {
  const chat = chats.get(chatId);
  const row = book.get(bookId);
  if (!chat || !row) throw new Error('这本书或这段会话已经不在了');
  // 一次只有一场。正看着片子就先收了那一场
  if (watch.playing()) watch.stop();
  read.set({
    active: true, chatId, charId: (chat.characterIds || [])[0] || '', bookId,
    at: row.at || 0, pages: 0, saidPage: -1, said: 0, awayAt: 0,
  });
  book.textOf(bookId);
  return read.get();
}

/** 翻到某处。翻页的人是用户，所以这里同时把书上的进度也记了。 */
export function setAt(at) {
  const s = read.get();
  if (!s.active) return;
  book.setAt(s.bookId, at);
  read.set({ at, pages: s.pages + 1 });
}

export function away() {
  if (read.get().active) read.set({ awayAt: Date.now() });
}
export function back() {
  if (read.get().active) read.set({ awayAt: 0 });
}

/** 离开太久就收场。不起定时器，谁来读谁顺手扫一眼。 */
export function sweep() {
  const s = read.get();
  if (!s.active || !s.awayAt) return false;
  const mins = awayEnd();
  if (!mins) return false;
  if (Date.now() - s.awayAt < mins * 60000) return false;
  stop();
  return true;
}

/** 该不该让她开口。距上次开口翻过的页数够了才算。 */
export function due() {
  const s = read.get();
  if (!s.active || s.awayAt) return false;
  if (s.saidPage < 0) return false;          // 刚开场，等翻过一页再说
  return s.pages - s.saidPage >= gap();
}

export function markSaid() {
  const s = read.get();
  if (!s.active) return;
  read.set({ saidPage: s.pages, said: s.said + 1 });
}

/** 开场那一下：记个起点，之后按翻页算 */
export function markStart() {
  if (read.get().active) read.set({ saidPage: read.get().pages });
}

export function context() {
  if (sweep()) return null;
  const s = read.get();
  if (!s.active) return null;
  const row = book.get(s.bookId);
  if (!row) return null;

  const text = book.peekText(s.bookId);
  const chapter = book.chapterAt(row, s.at);
  const n = chars();
  return {
    title: row.title,
    author: row.author || '',
    chapter: chapter?.title || '',
    percent: book.percentOf(row),
    away: !!s.awayAt,
    // 这一页的原文。给多少由用户定，填 0 就只给章节与进度
    page: n ? book.slice(text, s.at, n) : '',
    chars: n,
  };
}

export function stop() {
  const s = read.get();
  if (!s.active) {
    read.set({ active: false, chatId: '', charId: '', bookId: '', at: 0, pages: 0,
      saidPage: -1, said: 0, awayAt: 0 });
    return null;
  }
  const chat = chats.get(s.chatId);
  const row = book.get(s.bookId);
  let record = null;
  if (chat && row && s.pages > 0) {
    chats.update(chat.id, { lastMessageAt: Date.now() });
    const chapter = book.chapterAt(row, s.at);
    record = messages.create({
      chatId: chat.id, kind: 'read', role: 'user', authorId: 'me',
      bookId: s.bookId, at: s.at, pages: s.pages,
      content: `[一起读了 ${s.pages} 页]\n《${row.title}》　读到 ${book.percentOf(row)}%`
        + `${chapter ? `　${chapter.title}` : ''}`,
      status: 'done',
    });
  }
  read.set({ active: false, chatId: '', charId: '', bookId: '', at: 0, pages: 0,
    saidPage: -1, said: 0, awayAt: 0 });
  return record;
}

