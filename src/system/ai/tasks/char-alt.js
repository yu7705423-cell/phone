import { characters, chats, messages as messagesDb } from '../../db/index.js';
import { template, runJSONTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { listFor } from '../context/memory.js';
import * as accounts from '../../accounts.js';
import { scheduleIn } from '../proactive.js';

// 角色自己开小号。用户不能替她开 —— 这是她的主意，不是你的。
//
// 触发挂在主动消息的调度上：轮到她主动开口时，有一定概率她开的不是口，
// 而是一个新号。条件卡得比较死，免得刚认识就冒出一堆马甲。

export const DEFAULTS = {
  charAlt: false,        // 总开关，默认关
  charAltChance: 0.12,   // 轮到她主动时，有多大概率是开小号而不是发消息
};

const MIN_MESSAGES = 30;   // 聊得够久才会动这个念头
export const MAX_ALTS = 2;   // 一个角色最多同时挂两个马甲

export function configOf(char) {
  if (!char) return { ...DEFAULTS };
  return {
    charAlt: char.charAlt === true,
    charAltChance: typeof char.charAltChance === 'number'
      ? char.charAltChance : DEFAULTS.charAltChance,
  };
}

export const altsOf = charId => characters.where(c => c.parentId === charId);

// 她现在会不会想开一个号。返回 null 表示可以，否则是不行的原因。
export function blockedBy(charId, personaId = accounts.currentId()) {
  const char = characters.get(charId);
  if (!char) return '角色不在了';
  if (char.parentId) return '小号自己不会再开小号';
  if (!configOf(char).charAlt) return '开关关着';
  if (altsOf(charId).length >= MAX_ALTS) return `已经有 ${MAX_ALTS} 个了，她不会再开`;
  const chat = chats.all().find(c => (c.characterIds || []).length === 1
    && c.characterIds[0] === charId && c.personaId === personaId);
  const n = chat ? messagesDb.where(m => m.chatId === chat.id).length : 0;
  if (n < MIN_MESSAGES) return `还没聊够，攒到 ${MIN_MESSAGES} 条以上她才会动这个念头（现在 ${n} 条）`;
  return null;
}

export const eligible = (charId, personaId) => blockedBy(charId, personaId) === null;

function contextOf(char, personaId) {
  const mems = listFor(char.id, personaId)
    .filter(m => m.rank === 'S' || m.rank === 'A')
    .slice(0, 12).map(m => `- ${m.content}`).join('\n');
  return [char.persona, mems ? `你记得的事：\n${mems}` : ''].filter(Boolean).join('\n\n');
}

// 真的去开一个。返回新角色和它的会话
export async function openAlt(charId, personaId = accounts.currentId()) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const me = accounts.get(personaId);

  const system = fillTemplate(template('task.char-alt'), {
    charName: char.name, userName: me?.name || '对方',
  }) + `\n\n## 你的设定\n${contextOf(char, personaId)}`;

  const r = await runJSONTask('char.alt', {
    system, key: `char-alt:${charId}:${Date.now()}`, maxTokens: 900,
  });
  if (!r?.name || !r?.persona) throw new Error('模型没给出可用的小号');

  const alt = characters.create({
    name: String(r.name).trim(),
    signature: String(r.signature || '').trim(),
    persona: String(r.persona).trim(),
    parentId: charId,
    altReason: String(r.reason || '').trim(),
    altOpenedAt: Date.now(),
    // 马甲继承本体的能力开关，但不会自己再去开号
    canSendVoice: char.canSendVoice !== false,
    canSendImage: char.canSendImage !== false,
    voiceId: '', charAlt: false,
    // 马甲要主动来搭话，否则开了也没下文
    proactive: true,
    proactiveMinutes: 90,
    proactiveQuietFrom: char.proactiveQuietFrom ?? 0,
    proactiveQuietTo: char.proactiveQuietTo ?? 8,
  });

  const chat = chats.create({
    characterIds: [alt.id], personaId,
    title: '', lastMessageAt: Date.now(), unread: 0, summary: '',
  });
  // 开完号得有人来搭话，不然你根本不会发现。几分钟之内先来第一条。
  scheduleIn(alt.id, 60000 + Math.round(Math.random() * 240000));
  return { alt, chat };
}

// 给调度用：这一轮要不要改成开小号
export function rolls(charId) {
  const char = characters.get(charId);
  return Math.random() < configOf(char).charAltChance;
}
