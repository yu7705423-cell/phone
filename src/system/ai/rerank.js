import { rerankConfig, rerankReady } from './services.js';
import { enqueue } from './queue.js';
import { note } from './usage.js';

// 重排。向量检索先粗筛出一批候选，再让重排模型按「和这句话有多相关」重新排一遍。
//
// 为什么值得单独一步：向量比的是两段话在嵌入空间里的距离，
// 它对「谁跟谁」「是不是同一件事」这类区别并不敏感 —— 一段关于吃饭的记忆
// 和另一段关于吃饭的记忆，余弦上难分高下。重排模型是把查询和候选**一起**
// 读一遍再打分，分得开这种。
//
// 代价是**每一轮多一次请求**，所以默认关着，开关在「设置 - 用量与上限」，
// 登记在 ai/cost.js 的 EXTRA_CALLS 里（见 CLAUDE.md 第 15 条）。
//
// 接口形状按 Cohere 那一套（SiliconFlow、Jina、Voyage 都照它做）：
//   POST /v1/rerank  { model, query, documents: [...], top_n }
//   -> { results: [{ index, relevance_score }, ...] }
// 回来的东西各家字段名略有出入，下面都认。

export { rerankReady };

function endpoint() {
  const base = (rerankConfig().baseUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  if (/\/rerank$/.test(base)) return base;
  return /\/v1$/.test(base) ? `${base}/rerank` : `${base}/v1/rerank`;
}

// 各家把名次放在不同的键上。认得出来的都收，认不出来就当这次没排成。
function readResults(json, count) {
  const rows = json?.results || json?.data || json?.output?.results;
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const r of rows) {
    const index = Number(r?.index ?? r?.document?.index ?? r?.corpus_id);
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const score = Number(r?.relevance_score ?? r?.score ?? r?.relevanceScore ?? 0);
    out.push({ index, score });
  }
  if (!out.length) return null;
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * 排一批。回来的是 [{ index, score }]，按分数从高到低，index 指回 documents。
 *
 * 只送正文，不送人设、记忆以外的任何东西 —— 和翻译那套接口一个规矩。
 */
export async function rank(query, documents, { topN, signal, scores = false } = {}) {
  const cfg = rerankConfig();
  const url = endpoint();
  if (!rerankReady() || !url) throw new Error('还没配重排接口');
  const docs = (documents || []).map(d => String(d || ''));
  // 只有一条时没什么可排的，不调接口。要真分数（给缓存用）时照调
  if (!docs.length || (docs.length < 2 && !scores)) {
    return docs.map((_, i) => ({ index: i, score: 0 }));
  }

  const body = {
    model: cfg.model,
    query: String(query || '').slice(0, 8000),
    documents: docs,
    return_documents: false,
  };
  const n = Math.max(0, Math.round(Number(topN) || 0));
  if (n > 0) body.top_n = Math.min(n, docs.length);

  note('rerank');
  const res = await fetch(url, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`重排接口 ${res.status}${text ? '：' + text.slice(0, 200) : ''}`);
  }
  const got = readResults(await res.json(), docs.length);
  if (!got) throw new Error('重排接口返回的结果读不出名次');
  return got;
}

/** 配完按一下，确认这套接口通不通。 */
export async function probe() {
  const docs = ['今天中午吃了拉面。', '这台电脑的显卡是上个月换的。'];
  const got = await rank('午饭吃的什么', docs);
  return { ok: true, top: got[0]?.index ?? -1, count: got.length };
}

// 排过的分数按「模型 + 查询」缓存，每一条候选一个分数。
//
// 重新生成、命中禁写词重掷、失败重试，送过去的查询和上一次一字不差 ——
// 从前每一次都再付一次重排的钱，排出来的名次却一模一样。
// 向量那边的查询早就这么缓存了（embed.js 的 queryCache），这里补上。
//
// 按「每条候选的分数」存，不按整份列表存：回复完之后召回过的那几条会疲劳，
// 本地打分变了，重新生成时送来的候选**大半相同、顺序变了、进出几条**。
// 分数是这一条和这句查询的相关度，和同批还有谁无关，所以：
//   已经打过分的不再送，只送没见过的那几条，合起来排
// 为此不再向接口要 top_n：top_n 只缩短回来的列表，不省钱（按送进去的字数计），
// 却会让排在后面的那些没有分数，下次换一批就排不出来。
const cache = new Map();
const CACHE_MAX = 30;

/** 排队跑。和别的接口共用同一条队列，取消与去重都归它管。 */
export async function rankQueued(key, query, documents, opts = {}) {
  const docs = (documents || []).map(d => String(d || ''));
  const k = `${rerankConfig().model}\u0001${query}`;
  const topN = Math.max(0, Math.round(Number(opts.topN) || 0));
  const entry = cache.get(k) || new Map();

  const unknown = [...new Set(docs.filter(d => !entry.has(d)))];
  if (unknown.length) {
    const got = await enqueue(`rerank:${key}`,
      signal => rank(query, unknown, { signal, scores: true }), { replace: true, retries: 1 });
    unknown.forEach(d => entry.set(d, -Infinity));   // 接口没给分的算排在最后
    got.forEach(r => entry.set(unknown[r.index], r.score));
  }
  cache.delete(k);
  cache.set(k, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);

  const out = docs.map((d, index) => ({ index, score: entry.get(d) }))
    .sort((a, b) => b.score - a.score);
  return topN > 0 ? out.slice(0, topN) : out;
}
