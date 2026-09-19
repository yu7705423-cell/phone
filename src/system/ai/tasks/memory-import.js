import { memories, settings } from '../../db/index.js';
import { template, runJSONTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { listFor, CATEGORIES, RANKS } from '../context/memory.js';
import { touch as touchVec } from '../memvec.js';
import { uid } from '../../store.js';
import * as accounts from '../../accounts.js';

// 粘一大段文字进来，交给聊天模型拆成一条条结构化记忆。
// 注意：拆分靠的是聊天模型，不是向量接口 —— 向量接口只负责把文字变成向量。
// 存进去之后 touchVec 会自动排队补向量。

// 一次喂给模型的字数。切得越碎调用次数越多 —— 这是个默认值，不是上限：
// 在「设置 - 用量与上限」里可以改大，也可以填 0 表示不切，整段一次发完。
const CHUNK = 6000;

export const chunkSize = () => {
  const v = Number(settings.get().memoryImportChunk);
  if (v === 0) return Infinity;          // 不切
  return Number.isFinite(v) && v > 0 ? Math.round(v) : CHUNK;
};

/** 这一段会切成几块，也就是会调用几次接口。界面上要先把账摆出来。 */
export const callsFor = text => chunk(text).length;

// 按空行切段，再攒到接近 CHUNK 为止。不在句子中间硬切。
export function chunk(text, size = chunkSize()) {
  const paras = String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const out = [];
  let buf = '';
  for (const p of paras) {
    if (p.length >= size) {
      if (buf) { out.push(buf); buf = ''; }
      // 单段就超长，按句号切
      let rest = p;
      while (rest.length > size) {
        let cut = rest.lastIndexOf('。', size);
        if (cut < size * 0.5) cut = size;
        out.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
      }
      if (rest.trim()) buf = rest.trim();
      continue;
    }
    if ((buf + '\n\n' + p).length > size) { out.push(buf); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  if (buf) out.push(buf);
  return out;
}

const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

// 只做解析，不写库。先让人看一眼再决定存哪些。
export async function parse(raw, { charId = null, personaId = accounts.currentId(), onProgress, signal } = {}) {
  const parts = chunk(raw);
  if (!parts.length) throw new Error('没有可整理的内容');

  const known = listFor(charId, personaId);
  const existing = known.slice(0, 40).map(m => `- ${m.content}`).join('\n') || '(none)';
  const seen = new Set(known.map(m => norm(m.content)));
  const out = [];

  for (let i = 0; i < parts.length; i++) {
    if (signal?.aborted) break;
    onProgress && onProgress(i, parts.length);
    const system = fillTemplate(template('task.memory-import'), {
      existing, raw: parts[i],
    });
    const r = await runJSONTask('memory.import', {
      system, key: `mem-import:${i}:${Date.now()}`, maxTokens: 3000,
    });
    for (const row of (r?.memories || [])) {
      const content = String(row.content || '').trim();
      if (!content) continue;
      const key = norm(content);
      if (seen.has(key)) continue;        // 和已有的、以及前面几段出来的去重
      seen.add(key);
      out.push({
        content,
        category: CATEGORIES[row.category] ? row.category : 'fact',
        rank: RANKS.includes(row.rank) ? row.rank : 'B',
        keywords: Array.isArray(row.keywords) ? row.keywords.filter(Boolean).map(String) : [],
      });
    }
  }
  onProgress && onProgress(parts.length, parts.length);
  return { items: out, chunks: parts.length };
}

// 把挑好的条目真正写进记忆库，并排队补向量
export function commit(items, charId = null, personaId = accounts.currentId()) {
  const created = items.map(it => memories.create({
    id: uid('mem'), charId,
    content: it.content, category: it.category, rank: it.rank,
    keywords: it.keywords || [], source: 'import', personaId,
  }));
  created.forEach(m => touchVec(m.id));
  return created.length;
}
