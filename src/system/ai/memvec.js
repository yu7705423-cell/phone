import { memories, settings } from '../db/index.js';
import { embedMany, embedReady } from './embed.js';
import { embedConfig } from './services.js';

// 给记忆条目建向量索引。向量存在记忆记录自己身上（Float32Array，
// IndexedDB 的结构化克隆原生支持，比存 JSON 数字数组小一半还多）。

const BATCH = 32;

export const textOf = m => String(m?.content || '').trim();

// 换了模型，旧向量就没法和新查询比了，得重算
export function isStale(m) {
  const cfg = embedConfig();
  if (!m.vec || !m.vec.length) return true;
  return m.vecModel !== cfg.model;
}

export function pending() {
  return memories.all().filter(m => textOf(m) && isStale(m));
}

export function indexedCount() {
  const cfg = embedConfig();
  return memories.all().filter(m => m.vec?.length && m.vecModel === cfg.model).length;
}

let running = false;

// 补齐所有缺向量的条目。onProgress(已完成, 总数)
export async function backfill({ onProgress, signal } = {}) {
  if (running) throw new Error('已经在补了');
  if (!embedReady()) throw new Error('还没配向量接口');
  const todo = pending();
  if (!todo.length) return { done: 0, total: 0 };

  running = true;
  const cfg = embedConfig();
  let done = 0;
  try {
    for (let i = 0; i < todo.length; i += BATCH) {
      if (signal?.aborted) break;
      const slice = todo.slice(i, i + BATCH);
      const vecs = await embedMany(slice.map(textOf), { signal });
      slice.forEach((m, k) => {
        if (!vecs[k]) return;
        memories.update(m.id, { vec: vecs[k], vecModel: cfg.model, vecAt: Date.now() });
      });
      done += slice.length;
      onProgress && onProgress(done, todo.length);
    }
  } finally { running = false; }
  return { done, total: todo.length };
}

export const isRunning = () => running;

// 新写入或改过内容的单条，后台补一下，不挡界面
const queued = new Set();
let timer = null;

export function touch(id) {
  if (!embedReady() || !(settings.get().memoryVector !== false)) return;
  queued.add(id);
  clearTimeout(timer);
  timer = setTimeout(flush, 1200);
}

async function flush() {
  const ids = [...queued];
  queued.clear();
  const rows = ids.map(id => memories.get(id)).filter(m => m && textOf(m) && isStale(m));
  if (!rows.length) return;
  try {
    const cfg = embedConfig();
    const vecs = await embedMany(rows.map(textOf));
    rows.forEach((m, i) => {
      if (vecs[i]) memories.update(m.id, { vec: vecs[i], vecModel: cfg.model, vecAt: Date.now() });
    });
  } catch (err) {
    console.warn('[memvec] 补向量失败:', err.message || err);
  }
}

// 换了模型之后把旧向量清掉，省得占地方又永远对不上
export function dropAll() {
  memories.all().forEach(m => {
    if (m.vec) memories.update(m.id, { vec: null, vecModel: '', vecAt: 0 });
  });
}
