import { ebooks, characters } from '../../db/index.js';
import * as book from '../../book.js';
import * as para from '../../paracomment.js';
import * as ahead from '../../readahead.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';

// 让角色先读一段，它自己挑哪几段值得开口。
//
// **一次注入 = 一次调用**，注入多少字都一样。字数由用户填，不设上限
// （第 13 条）；自动续读的次数另有上限，见 readahead.js。
//
// 批出来的话落成段评，作者是这个角色 —— 和多人共读、随机评论进同一个池子。

/** 这一次读到哪儿为止。0 表示一直读到书末。 */
export function endOf(text, from, want = ahead.chars()) {
  return want > 0 ? Math.min(text.length, from + want) : text.length;
}

export async function run({ bookId, charId, from, want }) {
  const row = ebooks.get(bookId);
  if (!row) throw new Error('这本书已经不在了');
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');

  const text = await book.textOf(bookId);
  const start = Math.max(0, Math.min(text.length, Math.round(from) || 0));
  if (start >= text.length) throw new Error('后面没有内容了');
  const to = endOf(text, start, want ?? ahead.chars());

  const list = book.paragraphsOf(text, start, to - start);
  if (!list.length) throw new Error('这一段没有正文');

  const out = await runJSONTask('read.ahead', {
    system: fillTemplate(template('task.read-ahead'), {
      charName: char.name || '该角色',
      title: row.title,
      charPersona: [char.persona, char.signature].filter(Boolean).join('\n\n')
        || '（角色卡里还没有写人设）',
      paragraphs: list.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n'),
    }),
    key: `read-ahead:${bookId}:${charId}:${start}`,
    maxTokens: 400 + Math.min(list.length, 60) * 90,
  });

  const rows = Array.isArray(out?.notes) ? out.notes : [];
  const seen = new Set();
  const kept = rows
    .map(n => ({ i: Math.round(Number(n?.para) || 0), text: String(n?.text || '').trim() }))
    .filter(n => {
      if (!n.text || n.i < 1 || n.i > list.length || seen.has(n.i)) return false;
      seen.add(n.i);
      return true;
    })
    .map(n => ({
      bookId, at: list[n.i - 1].at, text: n.text,
      kind: para.CHAR, authorId: charId, authorName: char.name,
    }));

  kept.forEach(r => para.add(r));
  return { added: kept.length, read: to - start, to, paragraphs: list.length,
    done: to >= text.length };
}
