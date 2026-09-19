import { readnotes } from './db/index.js';

// 预读批注「批到哪儿了」的记号。
//
// **批出来的话本身不在这里**，它们落成段评，归 paracomment.js 管
// （作者、段落起点、气泡上的条数都在那边）。这里只剩一件事：
// 记住某段对话在某本书上已经批到哪个位置，下次从那儿往后接，不重批同一段。
//
// 记号是一条 text 为空的记录，和评论共用一个域但永远不显示 ——
// 为它单开一个数据域不值得，空文本这一条判据两边都认。

const keyOf = (chatId, bookId) => `${chatId}:${bookId}`;

const marks = (chatId, bookId) => readnotes
  .where(n => n.key === keyOf(chatId, bookId))
  .sort((a, b) => a.at - b.at);

/** 已经批到哪儿了。没批过返回 -1。 */
export function coveredTo(chatId, bookId) {
  const list = marks(chatId, bookId);
  if (!list.length) return -1;
  const last = list[list.length - 1];
  return last.coverTo ?? last.at;
}

export function saveMany(chatId, bookId, rows, coverTo) {
  const key = keyOf(chatId, bookId);
  return rows.map(r => readnotes.create({
    key, chatId, bookId, at: Math.max(0, Math.round(r.at) || 0),
    text: String(r.text || '').trim(), coverTo, createdAt: Date.now(),
  }));
}

/** 书没了，它的记号和段评一起清掉。 */
export function dropBook(bookId) {
  readnotes.where(n => n.bookId === bookId).forEach(n => readnotes.remove(n.id));
}
