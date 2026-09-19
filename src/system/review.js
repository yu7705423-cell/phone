import { reviews, characters, videos, ebooks, settings } from './db/index.js';
import { template, runTextTask } from './ai/engine.js';
import { fillTemplate } from './ai/templates.js';
import * as video from './video.js';
import * as book from './book.js';
import * as subtitle from './subtitle.js';
import * as accounts from './accounts.js';

// 看完、读完之后角色写的那一篇。
//
// **每写一篇存一篇，不覆盖。** 同一部片子重看一遍本来就会有不一样的看法，
// 把上一篇冲掉等于假装没看过。列表按时间倒序，旧的留着。
//
// 多一次接口调用，所以：手动点才写；想让它在收场时自动写，得自己开，
// 那个开关登记在 ai/cost.js（第 15 条）。

export const VIDEO = 'video';
export const BOOK = 'book';

const subjectOf = (kind, id) => (kind === BOOK ? ebooks.get(id) : videos.get(id));

export const listFor = (kind, subjectId) => reviews
  .where(r => r.kind === kind && r.subjectId === subjectId)
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

export const listByChar = charId => reviews
  .where(r => r.charId === charId)
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

export const countFor = (kind, subjectId) => listFor(kind, subjectId).length;
export const remove = id => reviews.remove(id);

// 她看到 / 读到的那部分。没有这一段，写出来的只能是泛泛之谈
function seenOf(kind, row, at) {
  if (kind === BOOK) {
    const text = book.peekText(row.id);
    const upto = Math.min(text.length, at || row.chars || 0);
    if (!text) return 'You have no text from this book at hand.';
    const tail = text.slice(Math.max(0, upto - 2000), upto);
    return `You read up to ${book.percentOf({ ...row, at: upto })}% of the book.`
      + `\nThe last part you read:\n${tail}`;
  }
  const lines = video.linesOf(row);
  if (!lines.length) {
    return 'This film has no subtitles. You only know how far it played:'
      + ` ${subtitle.stamp(at || 0)}.`;
  }
  const said = lines.filter(l => l.at <= (at || 0)).slice(-60).map(l => l.text);
  const outline = video.outlineSoFar(row, at || 0).map(o => o.text);
  return [
    `You watched up to ${subtitle.stamp(at || 0)}.`,
    outline.length ? `\nWhat happened:\n${outline.join('\n')}` : '',
    said.length ? `\nThe last lines you heard:\n${said.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

/** 让某个角色为这一部写一篇。一次接口调用。 */
export async function write({ kind, subjectId, charId, at = 0 }) {
  const char = characters.get(charId);
  const row = subjectOf(kind, subjectId);
  if (!char) throw new Error('这个角色已经不在了');
  if (!row) throw new Error(kind === BOOK ? '这本书已经不在了' : '这部片子已经不在了');

  const system = fillTemplate(template('task.review'), {
    charName: char.name,
    userName: accounts.current()?.name || '对方',
    title: row.title,
    verb: kind === BOOK ? 'reading' : 'watching',
    seen: seenOf(kind, row, at),
  });
  const text = String(await runTextTask('review.write', {
    system, user: 'Write it now.', key: `review:${kind}:${subjectId}:${Date.now()}`,
    maxTokens: 900,
  }) || '').trim();
  if (!text) throw new Error('模型没有写出内容');

  return reviews.create({
    kind, subjectId, charId, at,
    title: row.title,
    text,
    createdAt: Date.now(),
  });
}

/** 收场时要不要自动写一篇。默认关着，见 ai/cost.js */
export const autoOn = () => settings.get().reviewAuto === true;

export function writeOnFinish({ kind, subjectId, charId, at }) {
  if (!autoOn() || !charId || !subjectId) return Promise.resolve(null);
  return write({ kind, subjectId, charId, at })
    .catch(err => { console.warn('[review] 没写成:', err.message || err); return null; });
}
