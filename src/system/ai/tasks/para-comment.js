import { ebooks, characters, settings } from '../../db/index.js';
import * as book from '../../book.js';
import * as para from '../../paracomment.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask, runTextTask } from '../engine.js';

// 段评的三种来路。都走副用接口（第 15 条的路由表），都不是自动的 ——
// 按一下才调，按几下算几次。

const personaOf = c => [c.persona, c.signature].filter(Boolean).join('\n\n')
  || '（角色卡里还没有写人设）';

async function passageOf(bookId, at) {
  const row = ebooks.get(bookId);
  if (!row) throw new Error('这本书已经不在了');
  const text = await book.textOf(bookId);
  const body = book.paragraphAt(text, at);
  if (!body) throw new Error('这一段没有内容');
  return { row, body };
}

/** 一个角色评这一段。一次调用。 */
export async function one({ bookId, at, charId }) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const { row, body } = await passageOf(bookId, at);

  const text = String(await runTextTask('para.one', {
    system: fillTemplate(template('task.para-one'), {
      charName: char.name || '该角色', title: row.title,
      charPersona: personaOf(char), passage: body,
    }),
    key: `para-one:${bookId}:${at}:${charId}:${Date.now()}`, maxTokens: 300,
  }) || '').trim();
  if (!text) throw new Error('模型没有写出内容');
  return [{ authorId: charId, authorName: char.name, kind: para.CHAR, text }];
}

/** 一次调用几次请求：一人一次是 charIds.length 次，合写是 1 次。 */
export const callsForCrew = charIds =>
  (settings.get().crowdSeparate === true ? Math.max(1, charIds.length) : 1);

/**
 * 多人共读。默认一次调用写全部；`crowdSeparate` 打开之后一人一次 ——
 * 同一次调用里几个人容易写得像一个人，分开写声音不串，代价是几倍的调用。
 */
export async function crew({ bookId, at, charIds }) {
  const list = charIds.map(id => characters.get(id)).filter(Boolean);
  if (!list.length) throw new Error('共读名单是空的');
  const { row, body } = await passageOf(bookId, at);

  if (settings.get().crowdSeparate === true) {
    const out = [];
    for (const c of list) {
      const r = await one({ bookId, at, charId: c.id });
      out.push(...r);
    }
    return out;
  }

  const out = await runJSONTask('para.crew', {
    system: fillTemplate(template('task.para-crew'), {
      title: row.title, passage: body,
      crew: list.map(c => `- ${c.name}：${personaOf(c)}`).join('\n'),
    }),
    key: `para-crew:${bookId}:${at}:${Date.now()}`,
    maxTokens: 300 + list.length * 200,
  });

  const rows = Array.isArray(out?.comments) ? out.comments : [];
  const byName = new Map(list.map(c => [String(c.name).trim(), c]));
  return rows
    .map(r => ({ name: String(r?.name || '').trim(), text: String(r?.text || '').trim() }))
    .filter(r => r.text && byName.has(r.name))
    .map(r => ({ authorId: byName.get(r.name).id, authorName: r.name,
      kind: para.CHAR, text: r.text }));
}

export const crowdCount = () => {
  const v = Number(settings.get().crowdCount);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 6;
};

/**
 * 随机评论。临时编一批读者，**不入库** —— 只留名字和这一条评论，
 * 不会变成你的联系人。一次调用出一批。
 */
export async function readers({ bookId, at, count = crowdCount() }) {
  const n = Math.max(1, Math.round(count) || 1);
  const { row, body } = await passageOf(bookId, at);

  const out = await runJSONTask('para.readers', {
    system: fillTemplate(template('task.para-readers'), {
      title: row.title, passage: body, count: n,
    }),
    key: `para-readers:${bookId}:${at}:${Date.now()}`,
    maxTokens: 250 + n * 130,
  });

  const rows = Array.isArray(out?.comments) ? out.comments : [];
  const seen = new Set();
  return rows
    .map(r => ({ name: String(r?.name || '').trim().slice(0, 24),
      text: String(r?.text || '').trim() }))
    .filter(r => {
      if (!r.text || !r.name || seen.has(r.name)) return false;
      seen.add(r.name);
      return true;
    })
    .map(r => ({ authorId: '', authorName: r.name, kind: para.READER, text: r.text }));
}

/** 生成完写进库。挑好了再存，和批量生成那几处是同一个套路。 */
export const keep = (bookId, at, rows) =>
  para.addMany(rows.map(r => ({ ...r, bookId, at })));
