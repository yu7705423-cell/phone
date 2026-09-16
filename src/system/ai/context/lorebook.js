import { lorebooks } from '../../db/index.js';
import { takeTopWithin } from '../tokens.js';

// 世界书激活。见 ARCHITECTURE 4.4
// 扫描窗口与 B 级记忆共用,不是只看最后一条消息。
export function activate(char, scanText, budget) {
  const text = String(scanText || '');
  const lower = text.toLowerCase();
  const attached = new Set(char?.lorebookIds || []);

  const entries = [];
  for (const book of lorebooks.all()) {
    if (!book.global && !attached.has(book.id)) continue;
    for (const e of book.entries || []) {
      if (!e.enabled) continue;
      entries.push({ ...e, bookName: book.name });
    }
  }

  const hit = entries.filter(e => {
    if (e.constant) return true;
    const keys = (e.keys || []).filter(Boolean);
    if (!keys.length) return false;
    const match = k => (e.caseSensitive ? text : lower).includes(e.caseSensitive ? k : k.toLowerCase());
    if (!keys.some(match)) return false;
    const sec = (e.secondaryKeys || []).filter(Boolean);
    if (sec.length && !sec.some(match)) return false;
    if (e.probability != null && e.probability < 100) {
      if (Math.random() * 100 >= e.probability) return false;
    }
    return true;
  });

  const POS_ORDER = { system: 0, beforeChat: 1, afterChat: 2 };
  hit.sort((a, b) =>
    (POS_ORDER[a.position] ?? 0) - (POS_ORDER[b.position] ?? 0)
    || (b.priority ?? 100) - (a.priority ?? 100)
    || (a.order ?? 0) - (b.order ?? 0));

  return takeTopWithin(hit, budget, e => e.content || '');
}

export function build(ctx) {
  const { char, scanText, budgets } = ctx;
  if (!char) return '';
  const { items } = activate(char, scanText, budgets.lorebook);
  if (!items.length) return '';
  return '\n\n[世界设定]\n' + items.map(e => e.content.trim()).join('\n');
}

export const meta = { id: 'lorebook', label: '世界书', desc: '常驻条目加关键词命中的条目' };
