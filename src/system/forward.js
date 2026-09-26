import { chats, characters, messages, personas } from './db/index.js';

// 转发聊天记录（ARCHITECTURE 4.260）。
//
// 会话里多选几条，转发给另一段会话（别的角色，或者群）。存的是**冻起来的副本**：谁说的、说了什么、
// 什么时候说的，连同图片的 id —— 以后原会话删了、消息撤了，这一条记录仍是转发那一刻的样子。
// 对模型只是一条普通的用户消息，正文就是那几行记录（content），不需要另加规则。
//
// 图片只记 id，不复制一份：`purge.usedImageIds` 认 forward.items 里的 id，原会话删掉时它仍有引用；
// 转发到的那段会话删掉时一并释放（purge.dropChat）。角色包也带上（charpack）。

export const KIND = 'forward';
const MAX_TEXT = 500;

const clip = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/** 这一段会话叫什么：群用群名，单聊用角色本名 */
export function titleOf(chat) {
  if (!chat) return '';
  const ids = chat.characterIds || [];
  if (ids.length > 1) return chat.title || '群聊';
  return characters.get(ids[0])?.name || chat.title || '对话';
}

/** 把选中的几条冻成副本。按时间排好；名字用本名，自己用当前身份的名字 */
export function snapshot(chat, list) {
  const me = personas.get(chat?.personaId)?.name || '我';
  return [...list].filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(m => ({
    who: m.role === 'user' ? me : (characters.get(m.authorId)?.name || '对方'),
    mine: m.role === 'user',
    kind: m.kind || 'text',
    text: clip(m.recalled ? '[已撤回]' : m.content),
    imageId: m.kind === 'image' && m.imageId ? m.imageId : undefined,
    at: m.createdAt || 0,
  }));
}

/** 给模型看的正文。标记是协议（CLAUDE.md 第 14 条），名字与内容是数据 */
export function textOf(fw) {
  const items = fw?.items || [];
  const head = `[转发的聊天记录：${fw?.title || '对话'}，共 ${items.length} 条]`;
  return [head, ...items.map(i => `${i.who}：${i.text}`)].join('\n');
}

/** 能转发到哪些会话：同一个账号名下的，除了自己这一段 */
/**
 * 能转发到哪几段。除了自己这一段，**说这几句话的角色所在的会话也不列**（4.280）：
 * 把角色的话转发给它自己没有意义，而同一个角色可能有别的会话（小号那边、它在的群）
 */
export function targets(fromChatId, personaId, authorIds = []) {
  const said = new Set((authorIds || []).filter(id => id && id !== 'me'));
  return chats.all().filter(c => c.id !== fromChatId
    && (!personaId || !c.personaId || c.personaId === personaId)
    && !(c.characterIds || []).some(id => said.has(id)))
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

/**
 * 转发。在目标会话里落一条自己发的记录消息，不触发回复（对方下一次回复时自然会读到它）。
 * 回那条新消息。
 */
export function send({ from, to, list }) {
  const src = chats.get(from);
  const dst = chats.get(to);
  if (!src || !dst) throw new Error('会话不存在');
  const items = snapshot(src, list);
  if (!items.length) throw new Error('没有可转发的消息');
  const fw = { title: `${titleOf(src)}的聊天记录`, from, count: items.length, items };
  const msg = messages.create({
    chatId: to, role: 'user', authorId: 'me', kind: KIND, status: 'done',
    content: textOf(fw), forward: fw,
  });
  chats.update(to, { lastMessageAt: msg.createdAt });
  return msg;
}
