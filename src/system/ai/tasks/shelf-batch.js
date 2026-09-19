import { characters } from '../../db/index.js';
import * as shelf from '../../shelf.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';

// 按角色设定生成这个角色读过的书。
//
// 生成的是**书目**，不是书：书名、作者、一句备注。放上书架之后仍然是占位，
// 你自己导入同名的书才接得上。模型手里本来也没有那些书的正文。
//
// 一次调用生成一批，和聊天无关，也不占对话的上下文。
// 结果先列出来看一眼再决定存不存 —— 第 6 条里那个例外。

export const REAL = 'real';
export const ANY = 'any';

export const KINDS = [
  { id: REAL, label: '现实中存在的书',
    line: 'Only books that actually exist. Do not invent titles.' },
  { id: ANY, label: '不限',
    line: 'Books that exist and books that exist only in this character\'s '
      + 'world both qualify. Take which is appropriate from the settings above.' },
];

const kindOf = id => KINDS.find(k => k.id === id) || KINDS[0];

const str = v => String(v ?? '').trim();

/** 生成一批。count 由用户填，不设上限（第 13 条）。 */
export async function generate(charId, { count = 8, kind = REAL } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const n = Math.max(1, Math.round(count) || 0);

  const have = shelf.listOf(charId);
  const vars = {
    charName: char.name || '该角色',
    charPersona: [char.persona, char.signature].filter(Boolean).join('\n\n')
      || '（角色卡里还没有写人设）',
    count: n,
    kindLine: kindOf(kind).line,
    existing: have.map(it => `- ${it.title}`).join('\n') || '（书架还是空的）',
  };

  const out = await runJSONTask('shelf.batch', {
    system: fillTemplate(template('task.shelf-batch'), vars),
    key: `shelf-batch:${charId}:${Date.now()}`,
    maxTokens: 300 + n * 60,
  });

  const rows = Array.isArray(out?.books) ? out.books : [];
  const seen = new Set();
  return rows
    .map(x => (typeof x === 'string'
      ? { title: str(x), author: '', note: '' }
      : { title: str(x?.title), author: str(x?.author), note: str(x?.note) }))
    .filter(b => {
      const key = shelf.normalize(b.title);
      if (!key || seen.has(key)) return false;
      if (shelf.has(charId, b.title)) return false;
      seen.add(key);
      return true;
    })
    .map(b => ({ ...b, title: b.title.slice(0, 80), author: b.author.slice(0, 40),
      note: b.note.slice(0, 200) }));
}

/** 勾选之后一并放上书架。返回真正放上去的几本。 */
export function keep(charId, rows) {
  const made = [];
  for (const b of rows) {
    try { made.push(shelf.add(charId, b)); } catch { /* 重名的跳过 */ }
  }
  return made;
}
