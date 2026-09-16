import { memories } from '../../db/index.js';
import { takeTopWithin } from '../tokens.js';

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

export function listFor(charId, chatId) {
  const scopes = new Set(scopesFor(charId, chatId));
  return memories.where(m => scopes.has(m.scope));
}

// S/A 全注入; B 在扫描窗口里命中关键词才进; C 只存档不注入
export function select(charId, chatId, scanText, budget) {
  const text = String(scanText || '').toLowerCase();
  const pool = listFor(charId, chatId).filter(m => {
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
  const { settings, char, chat, scanText, budgets } = ctx;
  if (!settings.memoryEnabled) return '';
  const { items } = select(char?.id, chat?.id, scanText, budgets.memory);
  if (!items.length) return '';
  const lines = items.map(m =>
    `[${m.rank}/${CATEGORIES[m.category] || m.category}] ${m.content}`);
  return '\n\n[对话记忆 — 基于历史对话的客观分析结果，请自然地运用这些信息]\n' + lines.join('\n');
}

export const meta = { id: 'memory', label: '对话记忆', desc: 'S/A 级全注入，B 级按关键词命中' };
