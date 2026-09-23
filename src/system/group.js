import { chats, characters } from './db/index.js';
import * as accounts from './accounts.js';

/**
 * 群聊。见 ARCHITECTURE 4.162
 *
 * **群是一段会话，不是另一种东西。** `chats.characterIds` 从第一天起就是数组，
 * 群只是里面放了不止一个人，外加一个 `group: true`。消息、搜索、分页、美化、
 * 备份全是按会话算的，一行都不用改。
 *
 * 为什么还要一个 `group` 标记，而不是只看人数：全库有十几处「找这个角色的
 * 一对一会话」写的是 `characterIds.length === 1`。一个群删成只剩一人时，
 * 它就会被当成那个角色的私聊认出来 —— 于是那个角色有了两段私聊。
 * 所以群的成员不许少于两人，删角色删到只剩一人时整个群一起删（见 purge.js）。
 */

export const MIN = 2;

export const isGroup = chat => !!chat && (chat.group === true || (chat.characterIds || []).length > 1);

/** 群里还在的成员。角色被删了的那几个跳过 */
export const members = chat => (chat?.characterIds || []).map(id => characters.get(id)).filter(Boolean);

/** 群名。没起名就用成员名字拼一个 */
export function titleOf(chat) {
  const t = String(chat?.title || '').trim();
  if (t) return t;
  return members(chat).map(c => c.name).join('、') || '群聊';
}

/**
 * 群里的事私聊时记不记得（这个群自己的开关，见 CLAUDE.md 第 5 条）。
 * 默认记得：群里说过的话，私聊时提起来是自然的事。
 * 关掉以后，这个群里提取出来的记忆只在这个群里生效。
 */
export const memShared = chat => chat?.groupMemory !== 'group';

/** 建一个群。成员少于两人不建 */
export function create({ ids, title = '', personaId = accounts.currentId() }) {
  const list = [...new Set((ids || []).filter(id => characters.get(id)))];
  if (list.length < MIN) throw new Error(`群聊至少需要 ${MIN} 名成员`);
  return chats.create({
    group: true, characterIds: list, personaId,
    title: String(title || '').trim(), lastMessageAt: Date.now(), unread: 0, summary: '',
  });
}

export function rename(chatId, title) {
  chats.update(chatId, { title: String(title || '').trim() });
}

export function addMembers(chatId, ids) {
  const chat = chats.get(chatId);
  if (!chat) return;
  const next = [...new Set([...(chat.characterIds || []), ...(ids || [])])]
    .filter(id => characters.get(id));
  chats.update(chatId, { characterIds: next, group: true });
}

/** 移出一名成员。移完少于两人就不移，交给界面说明 */
export function removeMember(chatId, charId) {
  const chat = chats.get(chatId);
  if (!chat) return false;
  const next = (chat.characterIds || []).filter(id => id !== charId);
  if (next.length < MIN) return false;
  chats.update(chatId, { characterIds: next });
  return true;
}

// ---- @ ----
//
// 存的是 id，不是名字：改了名以后，从前那句「@小林」照样知道点的是谁。
// 认名字只在发出去的那一下认一次。

/** 这句话里点了谁。长名字先认，免得「小林」把「小林子」吃掉一半 */
export function mentionsIn(text, chat) {
  const s = String(text || '');
  if (!s.includes('@')) return [];
  const list = members(chat).slice().sort((a, b) => (b.name || '').length - (a.name || '').length);
  const out = [];
  let rest = s;
  for (const c of list) {
    const name = String(c.name || '').trim();
    if (!name) continue;
    const tag = `@${name}`;
    if (rest.includes(tag)) {
      out.push(c.id);
      rest = rest.split(tag).join(' ');
    }
  }
  return out;
}

/** 最近这一轮用户点了谁（只看角色还没接话之前的那几条） */
export function pendingMentions(msgs) {
  const ids = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') break;
    (m.mentions || []).forEach(id => { if (!ids.includes(id)) ids.unshift(id); });
  }
  return ids;
}
