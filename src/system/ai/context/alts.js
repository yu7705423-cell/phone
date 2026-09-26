import { characters, chats, messages } from '../../db/index.js';
import { rootIdOf } from '../../accounts.js';

// 角色的其他账号（ARCHITECTURE 4.259）。
//
// 本体与小号是同一个人：本体知道自己开了哪些号、那边最近聊了什么；小号知道本体那边最近聊了什么。
// 从前两边完全不通，本体对小号那边的对话一无所知（只在开新号那一刻才看一眼）。
// 本体上的「本体与小号互通」关掉就没有这一块；带几条由 altShareLines 定（0 表示不带近况，只通记忆）。
// 只陈述事实（第 16 条）：这些是你的账号、对方不知道、那边最近说了什么。

export const meta = { id: 'alts', label: '角色的其他账号', desc: '本体与小号互相知道对方那边最近的对话' };

const DEFAULT_LINES = 8;

const pairChat = (charId, personaId) => {
  const root = personaId ? rootIdOf(personaId) : null;
  return chats.all().find(c => (c.characterIds || []).length === 1 && c.characterIds[0] === charId
    && (!root || !c.personaId || rootIdOf(c.personaId) === root));
};

const clip = s => String(s || '').replace(/\s+/g, ' ').slice(0, 200);

function tail(chatId, n, charName, userName) {
  if (!chatId || n <= 0) return '';
  return messages.where(m => m.chatId === chatId && m.status !== 'error' && m.kind !== 'narration' && m.content)
    .sort((a, b) => a.createdAt - b.createdAt).slice(-n)
    .map(m => `${m.role === 'user' ? userName : charName}: ${clip(m.content)}`).join('\n');
}

export function build(ctx) {
  const { char, chat, persona } = ctx;
  if (!char || !chat) return '';
  const rootId = char.parentId || char.id;
  const root = characters.get(rootId);
  if (!root || root.altShare === false) return '';
  const alts = characters.where(c => c.parentId === rootId);
  if (!alts.length) return '';
  const n = typeof root.altShareLines === 'number' ? Math.max(0, root.altShareLines) : DEFAULT_LINES;
  const userName = persona?.name || 'the user';
  const personaId = chat.personaId || persona?.id || null;
  const rows = [];
  if (char.id === rootId) {
    for (const a of alts) {
      const t = tail(pairChat(a.id, personaId)?.id, n, a.name, userName);
      rows.push([`- ${a.name}${a.altReason ? ` (opened because: ${clip(a.altReason)})` : ''}`,
        t ? t.split('\n').map(x => `  ${x}`).join('\n') : (n > 0 ? '  (nothing said there yet)' : '')].filter(Boolean).join('\n'));
    }
    if (!rows.length) return '';
    return `\n\n[你的其他账号]\nYou also use the following accounts. ${userName} does not know they are you.${n > 0 ? ' Latest messages there:' : ''}\n${rows.join('\n')}`;
  }
  // 小号这边：本体那一段
  const t = tail(pairChat(rootId, personaId)?.id, n, root.name, userName);
  const others = alts.filter(a => a.id !== char.id);
  const lines = [`- ${root.name} (your main account)`, t ? t.split('\n').map(x => `  ${x}`).join('\n') : (n > 0 ? '  (nothing said there yet)' : '')].filter(Boolean);
  for (const a of others) {
    const ta = tail(pairChat(a.id, personaId)?.id, n, a.name, userName);
    lines.push(`- ${a.name}${a.altReason ? ` (opened because: ${clip(a.altReason)})` : ''}`);
    if (ta) lines.push(ta.split('\n').map(x => `  ${x}`).join('\n'));
    else if (n > 0) lines.push('  (nothing said there yet)');
  }
  return `\n\n[你的其他账号]\nThis account is one you opened yourself${char.altReason ? ` (because: ${clip(char.altReason)})` : ''}. ${userName} does not know it is you. Your other accounts and the latest messages there:\n${lines.join('\n')}`;
}
