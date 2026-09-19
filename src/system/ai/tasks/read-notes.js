import { chats, characters, ebooks, settings } from '../../db/index.js';
import * as book from '../../book.js';
import * as notes from '../../readnotes.js';
import * as accounts from '../../accounts.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';

// 预读批注。一次把后面几页交给角色，它按页标出想说的话。
//
// 这是省调用的那条路：从前一页一次开口就是一页一次调用，
// 现在几页合成一次。页数由用户填，不设上限（第 13 条）。

/** 一次批几页。0 表示一直批到书末。 */
export function pagesOf() {
  const v = Number(settings.get().readNotesPages);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 6;
}

/** 从哪儿开始批。已经批过的往后接，不重复批同一段。 */
export function startFrom(chatId, bookId, at) {
  const done = notes.coveredTo(chatId, bookId);
  return Math.max(at, done + 1);
}

export async function generate({ chatId, bookId, at }) {
  const chat = chats.get(chatId);
  const row = ebooks.get(bookId);
  if (!chat || !row) throw new Error('这本书或这段会话已经不在了');
  const char = characters.get((chat.characterIds || [])[0]);
  if (!char) throw new Error('角色不存在');

  const text = await book.textOf(bookId);
  const from = startFrom(chatId, bookId, at);
  if (from >= text.length) throw new Error('后面没有内容了');

  const want = pagesOf();
  const starts = [];
  for (let p = from; p < text.length; p += book.PAGE) {
    starts.push(p);
    if (want && starts.length >= want) break;
  }

  const pages = starts
    .map((st, i) => `### Page ${i + 1}\n${book.slice(text, st, book.PAGE)}`)
    .join('\n\n');

  const me = accounts.get(chat.personaId);
  const out = await runJSONTask('read.notes', {
    system: fillTemplate(template('task.read-notes'), {
      charName: char.name || '该角色',
      userName: me?.name || '对方',
      title: row.title,
      charPersona: [char.persona, char.signature].filter(Boolean).join('\n\n')
        || '（角色卡里还没有写人设）',
      pages,
    }),
    key: `read-notes:${chatId}:${bookId}:${from}`,
    maxTokens: 400 + starts.length * 160,
  });

  const rows = Array.isArray(out?.notes) ? out.notes : [];
  const coverTo = starts[starts.length - 1] + book.PAGE - 1;
  const kept = rows
    .map(n => ({ page: Math.round(Number(n?.page) || 0), text: String(n?.text || '').trim() }))
    .filter(n => n.text && n.page >= 1 && n.page <= starts.length)
    .map(n => ({ at: starts[n.page - 1], text: n.text }));

  // 一条都没有也要记下批到哪儿了，否则下次又从同一段重批一遍
  const saved = notes.saveMany(chatId, bookId, kept.length ? kept : [], coverTo);
  if (!kept.length) markCovered(chatId, bookId, coverTo);
  return { added: saved.length, pages: starts.length, coverTo };
}

// 一条批注都没出的时候，用一条空的占住位置，只为记住批到哪儿
function markCovered(chatId, bookId, coverTo) {
  notes.saveMany(chatId, bookId, [{ at: coverTo, text: '' }], coverTo);
}
