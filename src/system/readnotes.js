import { readnotes } from './db/index.js';
import * as book from './book.js';

// 预读批注。一次把后面好几页交给角色，它把想说的话按页标出来；
// 你读到那一页时正文下面多出一行浅浅的标记，点开才是它的话。
//
// **这样比一页一调省得多**：从前每翻一页给它一次开口的机会，就是一页一次；
// 现在几页合成一次。省下来的是调用次数，不是内容。
//
// 一条批注属于「哪段会话 + 哪本书 + 哪一页」。页按字数起点算，和阅读器同一套。

const keyOf = (chatId, bookId) => `${chatId}:${bookId}`;

export const listFor = (chatId, bookId) => readnotes
  .where(n => n.key === keyOf(chatId, bookId))
  .sort((a, b) => a.at - b.at);

/** 落在这一页里的那几条。at 是这一页的起点。 */
export const inPage = (chatId, bookId, at, span = book.PAGE) =>
  listFor(chatId, bookId).filter(n => n.at >= at && n.at < at + span);

/** 已经批到哪儿了。再生成时从这里往后接，不重复批同一段。 */
export function coveredTo(chatId, bookId) {
  const list = listFor(chatId, bookId);
  return list.length ? list[list.length - 1].coverTo || list[list.length - 1].at : -1;
}

export function saveMany(chatId, bookId, rows, coverTo) {
  const key = keyOf(chatId, bookId);
  return rows.map(r => readnotes.create({
    key, chatId, bookId, at: Math.max(0, Math.round(r.at) || 0),
    text: String(r.text || '').trim().slice(0, 600),
    coverTo, seen: false, createdAt: Date.now(),
  }));
}

export const markSeen = id => readnotes.update(id, { seen: true });

export function clear(chatId, bookId) {
  const list = listFor(chatId, bookId);
  list.forEach(n => readnotes.remove(n.id));
  return list.length;
}

export const countFor = (chatId, bookId) => listFor(chatId, bookId).length;

/** 一本书被删掉，跟着它的批注也留不住。 */
export function dropBook(bookId) {
  readnotes.where(n => n.bookId === bookId).forEach(n => readnotes.remove(n.id));
}
