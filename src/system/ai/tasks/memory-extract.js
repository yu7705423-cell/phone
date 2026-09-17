import { touch as touchVec } from '../memvec.js';
import { memories, chats, characters, messagesOf } from '../../db/index.js';
import { template, runJSONTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { listFor, CATEGORIES, RANKS } from '../context/memory.js';
import { uid } from '../../store.js';

// 未总结的对话 = memoryUpTo 之后的消息。
// 不另存一份缓冲区,避免与 messages 重复存储、日久漂移。
export function pendingOf(chatId) {
  const chat = chats.get(chatId);
  const all = messagesOf(chatId).filter(m => m.status !== 'error' && m.content);
  if (!chat?.memoryUpTo) return all;
  const idx = all.findIndex(m => m.id === chat.memoryUpTo);
  return idx < 0 ? all : all.slice(idx + 1);
}

export async function extract(chatId) {
  const chat = chats.get(chatId);
  if (!chat) throw new Error('会话不存在');
  const pending = pendingOf(chatId);
  if (pending.length < 2) throw new Error('对话太短，暂时不需要总结');

  const charId = (chat.characterIds || [])[0];
  const scope = charId ? `character:${charId}` : 'global';
  const existing = listFor(charId, chatId);

  const dialogue = pending.map(m => {
    const who = m.role === 'user' ? '用户' : (characters.get(m.authorId)?.name || '角色');
    return `${who}：${m.content}`;
  }).join('\n');

  const existingText = existing.length
    ? existing.map(m => `(id:${m.id}) [${m.rank}/${CATEGORIES[m.category] || m.category}] ${m.content}`).join('\n')
    : '（暂无已有记忆）';

  const system = fillTemplate(template('task.memory-extract'), {
    existing: existingText,
    dialogue,
  });

  const result = await runJSONTask('memory.extract', {
    system, key: `memory-extract:${chatId}`, maxTokens: 1600,
  });

  const rows = Array.isArray(result?.memories) ? result.memories : [];
  let added = 0, updated = 0;

  for (const r of rows) {
    if (!r || !r.content) continue;
    const category = CATEGORIES[r.category] ? r.category : 'fact';
    const rank = RANKS.includes(r.rank) ? r.rank : 'B';
    const keywords = Array.isArray(r.keywords) ? r.keywords.filter(Boolean).map(String) : [];

    if (r.updateId && memories.has(r.updateId)) {
      // 内容变了旧向量就作废，清掉再排队重算
      memories.update(r.updateId, { content: r.content, category, rank, keywords, vec: null, vecModel: '' });
      touchVec(r.updateId);
      updated++;
      continue;
    }
    const row = memories.create({
      id: uid('mem'), scope, content: r.content, category, rank, keywords,
      source: 'auto',
    });
    touchVec(row.id);
    added++;
  }

  const lastId = pending[pending.length - 1].id;
  chats.update(chatId, { memoryUpTo: lastId });
  return { added, updated, total: rows.length };
}

// 每累计 N 轮角色回复触发一次。0 为关闭。
export function shouldAutoExtract(chatId, interval) {
  if (!interval) return false;
  return pendingOf(chatId).filter(m => m.role === 'char').length >= interval;
}
