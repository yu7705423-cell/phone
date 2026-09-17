import { memories, personas } from '../../db/index.js';
import { takeTopWithin } from '../tokens.js';
import { dot, embedReady } from '../embed.js';
import { rootIdOf } from '../../accounts.js';

export const CATEGORIES = {
  fact: '事实', emotion: '情绪', pending: '待办',
  pattern: '模式', relation: '关系', profile: '画像',
};
export const RANKS = ['S', 'A', 'B', 'C'];

export function scopesFor(charId, chatId) {
  const s = ['global'];
  if (charId) s.push(`character:${charId}`);
  if (chatId) s.push(`chat:${chatId}`);
  return s;
}

// personaId 决定一条记忆属于谁。规则：
//  - 不同根账号之间完全隔离，一条都不给
//  - 同一个根下面，大号的记忆对小号也可见（角色还是同一个角色，它记得那些事），
//    但会被标成「关于某某」，而不是「关于你现在在聊的这个人」
export function listFor(charId, chatId, personaId) {
  const scopes = new Set(scopesFor(charId, chatId));
  const root = personaId ? rootIdOf(personaId) : null;
  return memories.where(m => {
    if (!scopes.has(m.scope)) return false;
    if (!root) return true;                       // 没给身份就不过滤，给调用方兜底
    if (!m.personaId) return true;                // 迁移前的老记忆，当作大号的
    return rootIdOf(m.personaId) === root;
  });
}

// 这条记忆是不是关于「现在这个人」。不是的话要标出来是关于谁的。
export function aboutOther(m, personaId) {
  if (!personaId || !m.personaId) return null;
  if (m.personaId === personaId) return null;
  return personas.get(m.personaId)?.name || null;
}

// 向量检索：S 级照旧钉死（身份级的事实，不该由相似度决定进不进），
// 剩下的预算交给语义相似度挑。关键词命中的直接算满分并进。
// queryVec 由 build() 提前算好传进来 —— 这一层是同步的，不能在这里发请求。
export function selectByVector(charId, chatId, scanText, budget, queryVec, opts = {}) {
  const personaId = opts.personaId || null;
  const topK = opts.topK || 12;
  const floor = typeof opts.threshold === 'number' ? opts.threshold : 0.22;
  const text = String(scanText || '').toLowerCase();

  const all = listFor(charId, chatId, personaId);
  const pinned = all.filter(m => m.rank === 'S');
  const rest = all.filter(m => m.rank !== 'S');

  const scored = rest.map(m => {
    const kws = (m.keywords || []).filter(Boolean);
    const hit = kws.length > 0 && kws.some(k => text.includes(String(k).toLowerCase()));
    const sim = m.vec?.length ? dot(queryVec, m.vec) : -1;
    // 关键词命中是明确信号，不要被相似度压下去
    return { m, score: hit ? Math.max(1, sim) : sim, hit };
  }).filter(x => x.hit || x.score >= floor);

  scored.sort((a, b) => b.score - a.score);

  const pool = [
    ...pinned.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    ...scored.slice(0, topK).map(x => x.m),
  ];
  return takeTopWithin(pool, budget, m => m.content || '');
}

// S/A 全注入; B 在扫描窗口里命中关键词才进; C 只存档不注入
export function select(charId, chatId, scanText, budget, personaId) {
  const text = String(scanText || '').toLowerCase();
  const pool = listFor(charId, chatId, personaId).filter(m => {
    if (m.rank === 'S' || m.rank === 'A') return true;
    if (m.rank !== 'B') return false;
    const kws = (m.keywords || []).filter(Boolean);
    return kws.length > 0 && kws.some(k => text.includes(String(k).toLowerCase()));
  });

  const weight = { S: 0, A: 1, B: 2 };
  pool.sort((a, b) =>
    (weight[a.rank] ?? 3) - (weight[b.rank] ?? 3)
    || (b.updatedAt || 0) - (a.updatedAt || 0));

  return takeTopWithin(pool, budget, m => m.content || '');
}

export function build(ctx) {
  const { settings, char, chat, scanText, budgets, queryVec, persona } = ctx;
  const personaId = persona?.id || null;
  if (!settings.memoryEnabled) return '';
  // 拿得到查询向量就走语义检索，否则退回关键词那一套。
  // 接口没配、还没补向量、这一轮取向量失败，都会落到后面这条路上。
  const useVec = settings.memoryVector !== false && embedReady() && queryVec?.length;
  const { items } = useVec
    ? selectByVector(char?.id, chat?.id, scanText, budgets.memory, queryVec, {
      personaId,
      topK: settings.memoryTopK || 12,
      threshold: typeof settings.memoryThreshold === 'number' ? settings.memoryThreshold : 0.22,
    })
    : select(char?.id, chat?.id, scanText, budgets.memory, personaId);
  if (!items.length) return '';
  // 关于别的身份的记忆要点名是关于谁的，否则模型会把它当成现在这个人的事
  const lines = items.map(m => {
    const who = aboutOther(m, personaId);
    const tag = `[${m.rank}/${CATEGORIES[m.category] || m.category}]`;
    return who ? `${tag}（关于${who}）${m.content}` : `${tag} ${m.content}`;
  });
  return '\n\n[对话记忆 — 基于历史对话的客观分析结果，请自然地运用这些信息]\n' + lines.join('\n');
}

export const meta = { id: 'memory', label: '对话记忆', desc: '配了向量就按语义检索，否则 S/A 全注入、B 按关键词命中' };
