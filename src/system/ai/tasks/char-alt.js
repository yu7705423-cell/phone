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
// 从前一个角色最多同时挂两个马甲。那是替用户封顶（CLAUDE.md 第 13 条），用户要求去掉：
// 开多少个由角色自己、由那个概率决定，总开关与概率都在角色卡上

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
  if (!char) return '该角色已被删除';
  if (char.parentId) return '小号不会再开设小号';
  if (!configOf(char).charAlt) return '该开关未开启';
  const chat = chats.all().find(c => (c.characterIds || []).length === 1
    && c.characterIds[0] === charId && c.personaId === personaId);
  const n = chat ? messagesDb.where(m => m.chatId === chat.id).length : 0;
  if (n < MIN_MESSAGES) return `对话不足 ${MIN_MESSAGES} 条，达到后才可能出现（当前 ${n} 条）`;
  return null;
}

export const eligible = (charId, personaId) => blockedBy(charId, personaId) === null;

function contextOf(char, personaId) {
  const mems = listFor(char.id, personaId)
    .filter(m => m.rank === 'S' || m.rank === 'A')
    .slice(0, 12).map(m => `- ${m.content}`).join('\n');
  return [char.persona, mems ? `What you remember:\n${mems}` : ''].filter(Boolean).join('\n\n');
}

// ---- 开号的由头从哪儿来 ----
//
// 从前只给人设和几条重要记忆：没有最近聊了什么，也没有之前开过哪些号。
// 于是每次想出来的由头都一样 —— 同一份人设、同一批记忆，推出来的当然是同一个理由。
// 现在把这两样作为**数据**给进去：最近这段对话，和已经开过的每一个号（名字、签名、
// 当时为什么开、什么时候开的、那边最近聊到哪儿）。怎么用由它自己定（CLAUDE.md 第 16 条）。

const RECENT = 40;       // 本体那段对话最近多少条
const ALT_TAIL = 6;      // 每个小号那边最近多少条

const pairChat = (charId, personaId) => chats.all().find(c => (c.characterIds || []).length === 1
  && c.characterIds[0] === charId && (c.personaId || personaId) === personaId);

function lines(chatId, n, charName, userName) {
  if (!chatId) return '';
  return messagesDb.where(m => m.chatId === chatId && m.status !== 'error' && m.kind !== 'narration')
    .sort((a, b) => a.createdAt - b.createdAt).slice(-n)
    .map(m => `${m.role === 'user' ? userName : charName}：${String(m.content || '').replace(/\s+/g, ' ').slice(0, 200)}`)
    .join('\n');
}

const day = t => (t ? new Date(t).toISOString().slice(0, 10) : '');

function recentOf(char, personaId, userName) {
  return lines(pairChat(char.id, personaId)?.id, RECENT, char.name, userName);
}

function altsBlock(char, personaId, userName) {
  const list = altsOf(char.id).sort((a, b) => (a.altOpenedAt || 0) - (b.altOpenedAt || 0));
  const rows = list.map(a => {
    const tail = lines(pairChat(a.id, personaId)?.id, ALT_TAIL, a.name, userName);
    return [
      `- ${a.name}${a.altOpenedAt ? ` (opened ${day(a.altOpenedAt)})` : ''}`,
      a.signature ? `  signature: ${a.signature}` : '',
      a.altReason ? `  why it was opened: ${a.altReason}` : '',
      tail ? `  latest messages there:\n${tail.split('\n').map(x => `    ${x}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  });
  // 开过又删掉的：本体上留着一份记录（altHistory），名字与原因还在
  const gone = (char.altHistory || []).filter(h => !list.some(a => a.id === h.id))
    .map(h => [`- ${h.name}${h.at ? ` (opened ${day(h.at)}, since deleted)` : ' (since deleted)'}`,
      h.reason ? `  why it was opened: ${h.reason}` : ''].filter(Boolean).join('\n'));
  return [...gone, ...rows].join('\n');
}

// 真的去开一个。返回新角色和它的会话
export async function openAlt(charId, personaId = accounts.currentId()) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const me = accounts.get(personaId);

  const userName = me?.name || '对方';
  const recent = recentOf(char, personaId, userName);
  const alts = altsBlock(char, personaId, userName);
  const system = fillTemplate(template('task.char-alt'), {
    charName: char.name, userName,
  }) + `\n\n## Your own settings\n${contextOf(char, personaId)}`
    + (recent ? `\n\n## Recent conversation with ${userName}, under your own account\n${recent}` : '')
    + (alts ? `\n\n## Accounts you have already opened\n${alts}` : '');

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

  // 在本体上记一笔：以后这个号删了，下一次开号时它仍然知道开过、为什么开
  characters.update(charId, { altHistory: [...(char.altHistory || []),
    { id: alt.id, name: alt.name, reason: alt.altReason, at: alt.altOpenedAt }] });

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
