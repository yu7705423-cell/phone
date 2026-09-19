import { touch as touchVec } from '../memvec.js';
import { memories, chats, characters, settings, messagesOf } from '../../db/index.js';
import { template, runJSONTask, MAX_OUTPUT } from '../engine.js';
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

  // 发多少条已有记忆过去。它只用来去重和认 updateId，不必每次全发。
  // 0 为全部。裁的时候按等级留，S/A 先留住 —— 会被改写的多半是它们。
  const keepN = Math.max(0, Math.round(Number(settings.get().memoryDedupeList) || 0));
  const byRank = { S: 0, A: 1, B: 2, C: 3 };
  const sent = keepN
    ? existing.slice().sort((a, b) => (byRank[a.rank] ?? 9) - (byRank[b.rank] ?? 9)).slice(0, keepN)
    : existing;
  const existingText = sent.length
    ? sent.map(m => `(id:${m.id}) [${m.rank}/${m.category}] ${m.content}`).join('\n')
    : '(no existing memories)';

  const system = fillTemplate(template('task.memory-extract'), {
    existing: existingText,
    dialogue,
  });

  let result;
  try {
    // 从前这里写死 1600。对话一长、记忆一多，JSON 就在半路断掉，
    // parseJSON 拿不到东西，整次总结失败 —— 而那一次是照付的。
    const cap = Math.max(0, Math.round(Number(settings.get().memoryExtractMaxTokens) || 0));
    result = await runJSONTask('memory.extract', {
      system, key: `memory-extract:${chatId}`, maxTokens: cap || MAX_OUTPUT,
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

  // 顺带把聊到的花销也记下来。**不多调一次接口** —— 它搭在这一次总结上，
  // 见 CLAUDE.md 第 15 条。落成待确认，你点一下才进余额（见 ledger.pendingOf）。
  let spent = 0;
  try { spent = await catchSpending(chatId, result?.spending); }
  catch (err) { console.warn('[bill] 花销没记上:', err.message || err); }

  const lastId = pending[pending.length - 1].id;
  chats.update(chatId, { memoryUpTo: lastId, memoryTriedId: null });
  return { added, updated, total: rows.length, spent };
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

/**
 * 把总结里读出来的花销落成待确认的流水。
 *
 * **一律先挂着。** 模型认错金额、把玩笑当真账，都不该直接污染账本 ——
 * 尤其真实账本记的是你的实际生活。确认在记账 app 里点。
 */
async function catchSpending(chatId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const L = await import('../../ledger.js');
  const book = L.bookOfChat(chatId);
  if (!book) return 0;

  let n = 0;
  for (const r of rows) {
    const v = Number(r?.amount) || 0;
    if (!v) continue;
    const owner = r?.who === 'char' ? L.CHAR : L.ME;
    const acc = L.defaultFor(book.id, owner);
    if (!acc) continue;
    const at = /^\d{4}-\d{2}-\d{2}$/.test(String(r?.at || ''))
      ? new Date(`${r.at}T12:00:00`).getTime() : Date.now();
    L.add({
      bookId: book.id, accountId: acc.id, amount: v,
      category: v > 0 ? 'salary' : 'other',
      note: String(r?.note || '').trim().slice(0, 40),
      at: at || Date.now(), src: 'chat', pending: true,
    });
    n += 1;
  }
  return n;
}
