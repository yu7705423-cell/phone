// 本地文本相似度。**不调接口，不花钱。**
//
// 为什么要有它：召回的默认档从前只有「字面命中关键词」这一条路 ——
// 一条记忆的关键词写着「胃病」，用户说「我今天有点不舒服」，命不中，
// 那条记忆就当不存在。而恋爱里的触发几乎都是绕着说的。
//
// 向量接口能解决，但它要配、要钱、每轮多一次请求（第 15 条），所以默认关着。
// 这里补上一条**零成本的中间档**：按字符二元组算相似度。中文不分词也能用，
// 「不舒服」与「胃不舒服」共享「不舒」「舒服」两个二元组，分就上来了。
//
// 它不是向量检索的替代品，配了向量仍然以向量为准（见 context/memory.js
// 那个 cue 取三路最大）。它是「一分钱不花时也该有的那一档」。

const CJK = /[一-鿿぀-ヿ가-힯]/;

/**
 * 切成词 / 二元组 / 单字。中日韩按字切，其余按词切。
 *
 * **单字也要收。** 只收二元组的话，「胃病」和「胃不舒服」一个二元组都不共享
 * —— 前者是「胃病」，后者是「胃不」「不舒」「舒服」，而人一眼就看出它们
 * 说的是一回事。单字把这条路接上；单字太泛，所以只按三成算（见 ONE），
 * 再加上逆文档频率压一道，常见字自己就沉下去了。
 */
export function grams(text) {
  const s = String(text || '').toLowerCase().trim();
  if (!s) return new Set();
  const out = new Set();
  // 拉丁与数字按词
  for (const w of s.match(/[a-z0-9][a-z0-9'’-]*/g) || []) if (w.length > 1) out.add(w);
  // 中日韩：相邻两字，以及单字
  const han = s.replace(/[^一-鿿぀-ヿ가-힯]/g, ' ');
  for (const run of han.split(/\s+/)) {
    for (let i = 0; i < run.length; i++) {
      out.add(run[i]);
      if (i + 1 < run.length) out.add(run.slice(i, i + 2));
    }
  }
  return out;
}

// 单字算三成。它是接得上「胃病 / 胃不舒服」这类的那一条路，
// 但单独一个字的证据本来就弱，给满分会把不相干的也拉进来。
const ONE = 0.35;
const weigh = (g, idf) => (idf ? (idf.get(g) ?? 1) : 1) * (g.length === 1 ? ONE : 1);

// 二元组算一次就存着。记忆的正文不常变，每轮重切几千条是白做的。
// 按内容本身做键：内容一改，键就变了，自然算的是新的。
const cache = new Map();
const MAX_CACHE = 4000;
export function gramsOf(text) {
  const key = String(text || '');
  const hit = cache.get(key);
  if (hit) return hit;
  const g = grams(key);
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, g);
  return g;
}

/**
 * 逆文档频率。**到处都出现的那几个二元组不该算数** ——
 * 「的」「了」「今天」在每条记忆里都有，不加权的话它们能把真正的线索淹掉。
 */
export function idfOf(docs) {
  const n = Math.max(1, docs.length);
  const df = new Map();
  for (const d of docs) {
    for (const g of gramsOf(d)) df.set(g, (df.get(g) || 0) + 1);
  }
  const idf = new Map();
  for (const [g, c] of df) idf.set(g, Math.log((n + 1) / (c + 0.5)));
  return idf;
}

/**
 * 两段文字有多像，0 到 1。
 *
 * 分母只取**较短那一边**的权重和：一条十个字的记忆与一整屏对话比，
 * 按并集算永远是零点零几。要问的是「这条记忆有多少落在那段话里」，
 * 不是「两边有多大重合」。
 */
export function sim(a, b, idf = null) {
  const A = a instanceof Set ? a : gramsOf(a);
  const B = b instanceof Set ? b : gramsOf(b);
  if (!A.size || !B.size) return 0;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  return covers(small, big, idf);
}

/**
 * doc 有多少落在 query 里，0 到 1。
 *
 * 分母固定是 **doc 那一边**。召回要问的是「这条记忆有多少出现在刚才那段话
 * 里」，而不是两边有多大重合 —— 用户只回一句「在吗」的时候，按较短那边算
 * 会让任何蹭到一个字的记忆都得高分。
 *
 * 这个数天生偏小（一条十个字的记忆里对上两个字就算有关系了），所以它是
 * **用来排序的**，不是用来卡阈值的。见 context/memory.js 里那个本地档的门槛。
 */
export function covers(doc, query, idf = null) {
  const D = doc instanceof Set ? doc : gramsOf(doc);
  const Q = query instanceof Set ? query : gramsOf(query);
  if (!D.size || !Q.size) return 0;
  let hit = 0, all = 0;
  for (const g of D) {
    const x = weigh(g, idf);
    all += x;
    if (Q.has(g)) hit += x;
  }
  return all > 0 ? hit / all : 0;
}

