import { touch as touchVec } from '../memvec.js';
import { memories, chats, characters, settings, messagesOf } from '../../db/index.js';
import { template, runJSONTask, MAX_OUTPUT } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { listFor, CATEGORIES, RANKS, dayOf } from '../context/memory.js';
import { uid } from '../../store.js';
import * as memcheck from '../../memcheck.js';
import * as accounts from '../../accounts.js';
import * as sceneStore from '../../scene.js';
import * as group from '../../group.js';

// 线下那些段落，摆成消息的样子。
//
// 线下发生的事同样要进记忆 —— 不然见了一整场面，回到线上什么都不记得。
// 场外指示不算，那是写给模型的指令，不是发生过的事。
const beatsAsTurns = chatId => sceneStore.ofChat(chatId)
  .flatMap(sc => sceneStore.beatsOf(sc.id))
  .filter(b => b.role !== sceneStore.DIRECTOR && String(b.text || '').trim())
  .map(b => ({
    id: b.id, role: b.role === sceneStore.ME ? 'user' : 'char',
    authorId: b.authorId, content: b.text, createdAt: b.createdAt, beat: true,
  }));

const after = (list, mark) => {
  if (!mark) return list;
  const i = list.findIndex(x => x.id === mark);
  return i < 0 ? list : list.slice(i + 1);
};

// 未总结的 = 两条水位线之后的东西，按时间并成一条。
//
// **两条水位线，不是一条**：消息和正文各是一个域，各自的 id 在对方那条
// 线上找不到，共用一条的话 findIndex 会落空，于是每次都从头再吃一遍。
// 不另存缓冲区，避免与原数据重复存储、日久漂移。
export function pendingOf(chatId) {
  const chat = chats.get(chatId);
  const msgs = after(
    messagesOf(chatId).filter(m => m.status !== 'error' && m.content),
    chat?.memoryUpTo,
  );
  const beats = after(beatsAsTurns(chatId), chat?.memoryUpToBeat);
  if (!beats.length) return msgs;
  return [...msgs, ...beats].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** 这一批里最后一条消息、最后一段正文各是哪个。两条水位线各推各的。 */
function marksOf(batch) {
  const patch = {};
  for (let i = batch.length - 1; i >= 0; i--) {
    if (!batch[i].beat && !patch.memoryUpTo) patch.memoryUpTo = batch[i].id;
    if (batch[i].beat && !patch.memoryUpToBeat) patch.memoryUpToBeat = batch[i].id;
    if (patch.memoryUpTo && patch.memoryUpToBeat) break;
  }
  return patch;
}

/**
 * 一次总结吃掉最早的多少条。0 表示一次全吃（第 13 条：这是默认值不是上限）。
 *
 * 为什么要有这个闸：从别处迁进来六万条消息的话，memoryUpTo 是空的，
 * 未总结就是全部六万条 —— 它们会被当成**一轮对话**拼进一次请求里。
 * 那一次要么直接超上下文报错，要么真发出去，烧掉几百万 token。
 */
export const batchSize = () =>
  Math.max(0, Math.round(Number(settings.get().memoryBatch) || 0));

/** 按现在这个批量，追平积压还要按几次。0 表示没什么可总结的。 */
export function runsFor(chatId) {
  const n = pendingOf(chatId).length;
  if (n < 2) return 0;
  const b = batchSize();
  return b ? Math.ceil(n / b) : 1;
}

/**
 * 不调接口，直接把积压的标成「已总结」。
 *
 * 迁进来一大堆历史、又不想为它们付钱的时候用这个。回来的是划掉了多少条。
 */
export function markCaughtUp(chatId) {
  const all = pendingOf(chatId);
  if (!all.length) return 0;
  chats.update(chatId, { ...marksOf(all), memoryTriedId: null });
  return all.length;
}

export async function extract(chatId) {
  const chat = chats.get(chatId);
  if (!chat) throw new Error('会话不存在');
  const all = pendingOf(chatId);
  if (all.length < 2) throw new Error('对话太短，暂时不需要总结');
  // 只吃最早的一批。吃完 memoryUpTo 往前挪，下一次接着吃
  const cap = batchSize();
  const pending = cap ? all.slice(0, cap) : all;

  // 群聊：记下来的事每个成员各存一份（他们都在场），同一件事的几份共用一个
  // twin，改一份就一起改。群自己的开关关着时，这几份只在这个群里生效
  //（scopeChat，见 context/memory.js 的 listFor 与 ARCHITECTURE 4.162）
  const inGroup = group.isGroup(chat);
  const owners = inGroup
    ? group.members(chat).map(c => c.id)
    : [(chat.characterIds || [])[0]];
  const scopeChat = inGroup && !group.memShared(chat) ? chat.id : '';
  const seenTwin = new Set();
  const existing = [];
  for (const id of owners) {
    for (const m of listFor(id, chat.personaId, chat.id)) {
      const k = m.twin || m.id;
      if (seenTwin.has(k)) continue;
      seenTwin.add(k);
      existing.push(m);
    }
  }

  const dialogue = pending.map(m => {
    // 线上 / 线下的分界照原样给（4.269）：模板里说了哪段是当面、哪段是手机上
    if (m.kind === 'side') return m.side === 'face' ? '[以下当面]' : '[以下在手机上]';
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
    ? sent.map(m => {
      // 带上日期：一条三个月前的和昨天的长得一样，模型判不出该改写哪条
      const day = dayOf(m);
      return `(id:${m.id}) [${m.rank}/${m.category}${day ? ' ' + day : ''}] ${m.content}`;
    }).join('\n')
    : '(no existing memories)';

  const system = fillTemplate(template('task.memory-extract'), {
    existing: existingText,
    dialogue,
  });

  // 自动总结的门槛从哪儿开始数：**这次动手时最新的那一条**，成功失败都记。
  //
  // 从前失败时记的是这一批的最后一条、成功时清空。设了「每次总结条数」又有积压时，
  // 两种都会出事：失败了，这一批之后的积压全算「没试过」，下一条消息接着再试；
  // 成功了，剩下的积压立刻又够一个间隔，于是每发一条消息都多总结一次，直到追平。
  // 现在自动那一档每攒够一个间隔最多动一次；要一口气追平，用「立即总结」或调大批量
  const tried = all[all.length - 1].id;

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
    chats.update(chatId, { memoryTriedId: tried });
    throw err;
  }

  const rows = Array.isArray(result?.memories) ? result.memories : [];
  let added = 0, updated = 0, gone = 0;
  // 这一批最后一条消息的时间，就当这批记忆发生的时间
  const at = Number(pending[pending.length - 1]?.createdAt) || Date.now();

  for (const r of rows) {
    if (!r || !r.content) continue;
    const category = CATEGORIES[r.category] ? r.category : 'fact';
    const rank = RANKS.includes(r.rank) ? r.rank : 'B';
    const keywords = Array.isArray(r.keywords) ? r.keywords.filter(Boolean).map(String) : [];

    if (r.updateId && memories.has(r.updateId)) {
      // 内容变了旧向量就作废，清掉再排队重算。群里记的那几份一起改
      const twin = memories.get(r.updateId).twin;
      const ids = twin ? memories.where(m => m.twin === twin).map(m => m.id) : [r.updateId];
      for (const id of ids) {
        memories.update(id, { content: r.content, category, rank, keywords, vec: null, vecModel: '' });
        touchVec(id);
      }
      updated++;
      continue;
    }
    const twin = owners.length > 1 ? uid('twin') : '';
    for (const charId of owners) {
    const row = memories.create({
      id: uid('mem'), charId, content: r.content, category, rank, keywords,
      ...(twin ? { twin } : {}),
      ...(scopeChat ? { scopeChat } : {}),
      // 天生只该有一个值的那几样（职业、常住地……）。同一个槽位来了新的，
      // 旧的自动让位 —— 把矛盾在结构上消灭掉，比事后打捞省事
      slot: memcheck.SLOTS[r.slot] ? r.slot : '',
      // 这件事当时的情绪强度。它是内容的客观属性（当时双方反应有多大），
      // 不是替角色判断该有多在意 —— 后者是第 16 条禁的那种
      weight: Math.min(2, Math.max(0, Number(r.weight) || 0)),
      // 这条是关于谁的。角色记得**你**的事才是最动人的那一下，
      // 所以召回时给「关于你的」留一个保底名额（见 context/memory.js 的配额）
      about: ['user', 'char', 'both'].includes(r.about) ? r.about : '',
      // 待办上挂的日子。过了就不再当成「还没了结」，改为等人复查 ——
      // 不然三个月后它还在问面试准备得怎么样
      dueAt: /^\d{4}-\d{2}-\d{2}$/.test(String(r.dueAt || '')) ? r.dueAt : '',
      source: 'auto',
      // 记的时间是**这批消息**发生的时间，不是总结的时间。
      // 迁进来一堆半年前的历史，今天补总结，全戳成今天就不对了 ——
      // 召回时那个日期是要给模型看的。
      createdAt: at, updatedAt: at,
      // 这条记忆是和哪个身份聊出来的。换账号之后互相看不见
      personaId: chats.get(chatId)?.personaId || accounts.currentId(),
    });
    touchVec(row.id);
    // 模型没认出「这条取代那条」时，本地再兜一道。取代不是删除：
    // 旧那条留在库里，只是不再参与召回（见 system/memcheck.js）
    gone += memcheck.settleNew(row).length;
    }
    added++;
  }

  // 顺带把聊到的花销也记下来。**不多调一次接口** —— 它搭在这一次总结上，
  // 见 CLAUDE.md 第 15 条。落成待确认，你点一下才进余额（见 ledger.pendingOf）。
  let spent = 0;
  try { spent = await catchSpending(chatId, result?.spending); }
  catch (err) { console.warn('[bill] 花销没记上:', err.message || err); }

  chats.update(chatId, { ...marksOf(pending), memoryTriedId: tried });
  return { added, updated, gone, total: rows.length, spent };
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
