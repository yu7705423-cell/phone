import { lorebooks, toolRuns } from './db/index.js';
import * as lorefile from './lorefile.js';
import { WORLD_MODULES } from './ai/tasks/tools.js';

// 世界观生成器的一份世界观变成一本世界书（ARCHITECTURE 4.265）。
//
// 「用它开一部长篇」和长篇向导里的「从世界观生成器导入」都走这里：每个模块一个条目，常驻、对话用。
// 同一份世界观只建一本：建过的记在那次运行上（run.bookId），书还在就直接用它，不重复建。
// 存为世界书那条路（确认页上逐本定设置）照旧，两者不冲突。

const titleOf = id => WORLD_MODULES.find(m => m.id === id)?.title || id;
const ORDER = WORLD_MODULES.map(m => m.id);

export function textOf(name, modules) {
  const body = ORDER.filter(id => String(modules?.[id] || '').trim())
    .map(id => `## ${titleOf(id)}\n${String(modules[id]).trim()}`).join('\n\n');
  return name ? `# ${name}\n\n${body}` : body;
}

/** 有内容的那次运行 */
export const usable = run => !!run && Object.values(run.output?.modules || {}).some(t => String(t || '').trim());

/**
 * 建（或找回）这份世界观的书，回书的 id。
 * 传 runId 时记在那次运行上；没有 runId（正在生成器里、还没存过）就只建书
 */
export function bookFromWorld({ name = '', modules = {}, runId = '' } = {}) {
  const run = runId ? toolRuns.get(runId) : null;
  if (run?.bookId && lorebooks.has(run.bookId)) return run.bookId;
  const text = textOf(name || '未命名世界观', modules);
  if (!text.trim()) throw new Error('这份世界观还没有内容');
  const draft = lorefile.draftFromText(text, name || '未命名世界观', '世界观生成器');
  const book = lorefile.save(draft, { constant: true, enabled: true, part: 'before', depth: 0, purpose: 'chat' });
  if (run) toolRuns.update(run.id, { bookId: book.id });
  return book.id;
}
