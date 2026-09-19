import { characters } from '../../db/index.js';
import * as shelf from '../../shelf.js';
import { fillTemplate, template } from '../templates.js';
import { runTextTask } from '../engine.js';

// 书架上某一本的读后感。角色在遇到你之前就读过它，这是它留下的印象。
//
// 和「书评」不是一回事：书评是你们一起读完之后写的，有原文在上下文里；
// 这里那本书多半只是个占位，模型手里没有正文，所以只写印象，不复述内容。
//
// 一本一次调用，按一下调一次，和聊天无关。

export async function generate(charId, entryId) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const item = shelf.listOf(charId).find(x => x.id === entryId);
  if (!item) throw new Error('这一本已经不在书架上了');

  const system = fillTemplate(template('task.impression'), {
    charName: char.name || '该角色',
    title: item.title,
    authorLine: item.author ? `（${item.author}）` : '',
    charPersona: [char.persona, char.signature].filter(Boolean).join('\n\n')
      || '（角色卡里还没有写人设）',
  });

  const text = String(await runTextTask('shelf.impression', {
    system, key: `impression:${charId}:${entryId}:${Date.now()}`, maxTokens: 400,
  }) || '').trim();
  if (!text) throw new Error('模型没有写出内容');
  return text;
}

export function save(charId, entryId, text) {
  shelf.setEntry(charId, entryId, {
    impression: String(text || '').trim().slice(0, 1200),
    impressionAt: Date.now(),
  });
}

export const clear = (charId, entryId) =>
  shelf.setEntry(charId, entryId, { impression: '', impressionAt: 0 });
