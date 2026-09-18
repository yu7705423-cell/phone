import { touch as touchVec } from '../memvec.js';
import { memories, chats, characters, settings, messagesOf } from '../../db/index.js';
import { template, runJSONTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { listFor, CATEGORIES, RANKS } from '../context/memory.js';
import { uid } from '../../store.js';
import * as accounts from '../../accounts.js';

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
  const existing = listFor(charId, chat.personaId);

  const dialogue = pending.map(m => {
    const who = m.role === 'user' ? 'User' : (characters.get(m.authorId)?.name || 'Character');
    return `${who}：${m.content}`;
  }).join('\n');

  const existingText = existing.length
    ? existing.map(m => `(id:${m.id}) [${m.rank}/${m.category}] ${m.content}`).join('\n')
    : '(no existing memories)';

  const system = fillTemplate(template('task.memory-extract'), {
    existing: existingText,
    dialogue,
  });

  let result;
  try {
    result = await runJSONTask('memory.extract', {
      system, key: `memory-extract:${chatId}`, maxTokens: 1600,
    });
  } catch (err) {
    // 记下这次试到哪儿了。不记的话，提取一旦失败，之后**每发一条消息**
    // 都会再提取一次 —— 未总结的消息只增不减，门槛永远是过的。
    // 一条回复两次请求，而且永远不会自己停。记下之后要再攒够一个间隔才重试。
    chats.update(chatId, { memoryTriedId: pending[pending.length - 1].id });
    throw err;
  }

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
      id: uid('mem'), charId, content: r.content, category, rank, keywords,
      source: 'auto',
      // 这条记忆是和哪个身份聊出来的。换账号之后互相看不见
      personaId: chats.get(chatId)?.personaId || accounts.currentId(),
    });
    touchVec(row.id);
    added++;
  }

  const lastId = pending[pending.length - 1].id;
  chats.update(chatId, { memoryUpTo: lastId, memoryTriedId: null });
  return { added, updated, total: rows.length };
}

// 每累计 N 轮角色回复触发一次。0 为关闭。
//
// 记忆整个关掉时不该还在后台提取 —— 提出来也不注入，白烧接口。
// 「立即总结」不受这条限制：那是明确的手动动作，
// 有人会先把记忆攒起来，回头再打开注入。
export function shouldAutoExtract(chatId, interval) {
  if (!settings.get().memoryEnabled) return false;
  if (!interval) return false;
  // 上次提取失败之后，要在那个位置之后再攒够一个间隔才重试。
  // 手动的「立即总结」不走这里，随时都能再试一次。
  const all = pendingOf(chatId);
  const tried = chats.get(chatId)?.memoryTriedId;
  const at = tried ? all.findIndex(m => m.id === tried) : -1;
  const since = at >= 0 ? all.slice(at + 1) : all;
  return since.filter(m => m.role === 'char').length >= interval;
}
