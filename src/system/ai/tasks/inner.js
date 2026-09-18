import { characters, chats } from '../../db/index.js';
import * as extras from '../../extras.js';
import { fillTemplate, template } from '../templates.js';
import { runTextTask } from '../engine.js';

// 心声，「单独生成」那一档。
//
// 整轮说完之后另起一次调用，只问一件事：刚才那几句话背后你在想什么。
// 隔了一次生成，写出来的东西才真的像背面那一层 —— 同一次里顺手带出来的
// 心声，多少会和台词互相迁就，说什么心里就想什么。
//
// 代价是每轮多一次调用。所以这一档默认不开，开的时候界面上写清楚。

export const innerKey = chatId => `inner:${chatId}`;

export async function generate(chatId, lines) {
  const chat = chats.get(chatId);
  const char = characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char) return '';
  const said = (lines || []).filter(Boolean).join('\n');
  if (!said) return '';

  const system = fillTemplate(template('task.inner'), {
    charName: char.name || '她',
    charPersona: char.persona || '（没写人设）',
  });

  const text = await runTextTask('inner.voice', {
    system, user: said, key: innerKey(chatId), maxTokens: 200,
  });
  return String(text || '').trim().slice(0, 300);
}

/**
 * 整轮渲染完之后补一段心声，挂在她最后说的那一条上。
 * 失败不抛：心声没生成出来不该影响这一轮已经发出去的话。
 */
export async function attach(chatId, created) {
  const chat = chats.get(chatId);
  if (extras.innerMode(chat) !== extras.INNER_APART) return null;
  const target = extras.innerTarget(created);
  if (!target) return null;
  try {
    const text = await generate(chatId, created.filter(m => m.kind === 'text').map(m => m.content));
    if (text) extras.setInnerText(target.id, text);
    return text;
  } catch (err) {
    console.warn('[inner] 心声没生成出来:', err.message || err);
    return null;
  }
}
