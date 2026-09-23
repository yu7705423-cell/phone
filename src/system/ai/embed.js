import { embedConfig, embedReady } from './services.js';
import { enqueue } from './queue.js';
import { note } from './usage.js';

// 向量（嵌入）。走 OpenAI 兼容的 /v1/embeddings，
// OpenAI 本体、大多数中转站、本地的 Ollama 都是这个形状。

export { embedReady };

function endpoint() {
  const base = (embedConfig().baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
  return /\/embeddings$/.test(base) ? base
    : /\/v1$/.test(base) ? `${base}/embeddings`
      : `${base}/v1/embeddings`;
}

// 一次可以喂一批，接口本来就收数组，逐条发纯属浪费
export async function embedMany(texts, { signal } = {}) {
  const cfg = embedConfig();
  if (!embedReady()) throw new Error('还没配向量接口');
  const input = texts.map(t => String(t || '').slice(0, 8000));
  if (!input.length) return [];

  note('embed');
  const res = await fetch(endpoint(), {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`向量接口 ${res.status}${text ? '：' + text.slice(0, 200) : ''}`);
  }
  const json = await res.json();
  const rows = json?.data;
  if (!Array.isArray(rows) || rows.length !== input.length) {
    throw new Error('向量接口返回的条数对不上');
  }
  // 按 index 排一遍，不要指望接口保证顺序
  return rows.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(r => normalize(Float32Array.from(r.embedding || [])));
}

export function embedOne(text, opts) {
  return embedMany([text], opts).then(v => v[0]);
}

// 存之前先归一化，检索时余弦相似度就退化成点积，省一半计算
export function normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const len = Math.sqrt(sum);
  if (!len) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / len;
  return out;
}

// 两个都归一化过，点积就是余弦
export function dot(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// 查询向量按文本缓存。同一个扫描窗口连着发几轮，不该每轮都去算一次
const queryCache = new Map();
const QUERY_CACHE_MAX = 30;

export async function embedQuery(text) {
  const key = `${embedConfig().model}::${text}`;
  if (queryCache.has(key)) return queryCache.get(key);
  const vec = await enqueue(`embed-q:${key.slice(0, 80)}`,
    signal => embedOne(text, { signal }), { replace: true });
  queryCache.set(key, vec);
  if (queryCache.size > QUERY_CACHE_MAX) {
    queryCache.delete(queryCache.keys().next().value);
  }
  return vec;
}

export function clearQueryCache() { queryCache.clear(); }

export async function probe() {
  const v = await embedOne('测试一下这个向量接口通不通');
  return { dims: v.length };
}
