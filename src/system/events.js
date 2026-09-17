import { events, characters, settings } from './db/index.js';
import { pick, roll, overdue, drift } from './draw.js';

// 随机事件库。
//
// 「今天她遇上了什么」分成两半，各归各的：
//   **日程** 是她自己安排的，由模型按人设生成，一天一次（批 2b）；
//   **随机事件** 是撞上的，由本地骰子抽，**不花钱，也不问模型**。
//
// 分开的理由就是这一句：撞上什么是运气，运气该由随机数决定。
// 交给模型「随便想一件事」，它会一直想出同一类事 —— 那不是随机，
// 那是它的偏好。同理，点数、距离、金额也都不是模型的活。
//
// 库按两个轴分格：
//   **领域** 这件事落在哪一面 —— 环境、人际、运气；
//   **色彩** 是好事、坏事，还是谈不上好坏。
// 第三个轴是**分量**：平常（几乎每周都可能遇上）还是少见（一年碰不上几回）。
// 分量不参与分格，它只决定这一条的基础权重 —— 少见的事在同一个格子里
// 和平常的事一起待着，只是被抽中的机会小一个量级。
//
// 三个表都是表驱动的，加一行就多一档。库本身是全局的：
// 「路上堵车」不属于任何一个角色，它是可能落在任何人头上的一件事。

export const DOMAINS = [
  { id: 'env', label: '环境', hint: '天气、交通、住的地方、随身的东西、公共场所' },
  { id: 'social', label: '人际', hint: '家人、朋友、同事、同学、陌生人、网上' },
  { id: 'luck', label: '运气', hint: '捡到、丢了、抽中、错过、排队、巧合' },
];

export const TONES = [
  { id: 'good', label: '好事', hint: '让这一天变好一点的，不必是大喜事' },
  { id: 'bad', label: '坏事', hint: '添堵的、麻烦的，但不要写成灾难' },
  { id: 'plain', label: '不好不坏', hint: '只是发生了，谈不上好还是坏' },
];

// 分量决定基础权重。少见的事和平常的事差一个量级，这就是「小概率」。
export const RARITIES = [
  { id: 'common', label: '平常', weight: 10, hint: '几乎每周都可能遇上' },
  { id: 'rare', label: '少见', weight: 1, hint: '一年碰不上几回，但也不是天方夜谭' },
];

const byId = (list, id) => list.find(x => x.id === id) || null;
export const domainOf = id => byId(DOMAINS, id);
export const toneOf = id => byId(TONES, id);
export const rarityOf = id => byId(RARITIES, id) || RARITIES[0];

export const cellKey = (domain, tone) => `${domain}:${tone}`;
export const cells = () => DOMAINS.flatMap(d => TONES.map(t => ({ domain: d, tone: t })));

// 去重用的形。标点、空白、常见的语气尾巴都抹掉 ——
// 「今天下雨了」和「今天下雨了。」是同一条。
export function normalize(text) {
  return String(text || '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

// ---- 库 ----

export function all() { return events.all(); }

export function list({ domain = '', tone = '', rarity = '' } = {}) {
  const rows = domain && tone ? events.byIndex(cellKey(domain, tone)) : events.all();
  return rows
    .filter(e => (!domain || e.domain === domain)
      && (!tone || e.tone === tone)
      && (!rarity || e.rarity === rarity))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// 每一格里有多少条，界面上那张九宫格要用
export function counts() {
  const out = {};
  for (const e of events.all()) {
    const k = e.cell || cellKey(e.domain, e.tone);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export function has(text, { domain = '', tone = '' } = {}) {
  const key = normalize(text);
  if (!key) return false;
  return list({ domain, tone }).some(e => normalize(e.text) === key);
}

export function add({ domain, tone, rarity = 'common', text, weight = 1 }) {
  const t = String(text || '').trim().slice(0, 60);
  if (!t) throw new Error('请填写事件内容');
  if (!domainOf(domain)) throw new Error('请选择领域');
  if (!toneOf(tone)) throw new Error('请选择色彩');
  return events.create({
    domain, tone, rarity: rarityOf(rarity).id,
    cell: cellKey(domain, tone),
    text: t, weight: Math.max(0, Number(weight) || 0) || 1, off: false,
  });
}

export function update(id, patch) {
  const row = events.get(id);
  if (!row) return null;
  const next = {};
  if (patch.text !== undefined) next.text = String(patch.text).trim().slice(0, 60);
  if (patch.rarity !== undefined) next.rarity = rarityOf(patch.rarity).id;
  if (patch.weight !== undefined) next.weight = Math.max(0, Number(patch.weight) || 0) || 1;
  if (patch.off !== undefined) next.off = !!patch.off;
  if (patch.domain !== undefined || patch.tone !== undefined) {
    next.domain = patch.domain ?? row.domain;
    next.tone = patch.tone ?? row.tone;
    next.cell = cellKey(next.domain, next.tone);
  }
  return events.update(id, next);
}

export function remove(id) { return events.remove(id); }

// 一批一起落库。已经有的跳过 —— 去重在这儿做一次，
// 生成那边也做一次：模型会重复，用户手动加也会撞上。
export function addMany(rows) {
  const seen = new Set(events.all().map(e => normalize(e.text)));
  const made = [];
  for (const r of rows || []) {
    const key = normalize(r.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    made.push(add(r));
  }
  return made;
}

// ---- 大运 ----
//
// 一个有惯性的慢变量，存在角色身上。每天挪一小步，不是每天重掷 ——
// 今天大吉明天大凶那不叫运势，那叫噪声。
//
// 它同时影响两件事：**撞上事情的概率**（走背字的时候事更多），
// 和**抽中什么色彩**（顺的时候好事的权重高一些）。

export const luckOf = char => Number(char?.luck) || 0;

export function luckLabel(n) {
  const v = Number(n) || 0;
  if (v >= 1.2) return '顺';
  if (v >= 0.4) return '还行';
  if (v > -0.4) return '平';
  if (v > -1.2) return '不太顺';
  return '背';
}

export function advanceLuck(charId, { rng = Math.random } = {}) {
  const char = characters.get(charId);
  if (!char) return 0;
  const next = drift(luckOf(char), { rng });
  characters.update(charId, { luck: next, luckAt: Date.now() });
  return next;
}

// 大运偏向。顺的时候好事权重高，背的时候坏事权重高，
// 不好不坏的那一档谁也不偏 —— 它本来就是背景。
export function toneWeight(tone, luck) {
  const v = Math.max(-2, Math.min(2, Number(luck) || 0));
  if (tone === 'good') return Math.max(0.2, 1 + 0.3 * v);
  if (tone === 'bad') return Math.max(0.2, 1 - 0.3 * v);
  return 1;
}

// ---- 抽 ----

// 这一条本来多重：分量定量级，条目自己的权重微调，大运偏色彩。
export function weightOf(e, luck = 0) {
  if (!e || e.off) return 0;
  return rarityOf(e.rarity).weight * (Number(e.weight) || 1) * toneWeight(e.tone, luck);
}

/**
 * 抽一条。domain 留空就在全部领域里抽。
 * recent 是最近抽中过的 id（新的在前），cooldown 决定往回压多少条。
 */
export function draw({ domain = '', tone = '', luck = 0, recent = [], cooldown, rng } = {}) {
  const pool = list({ domain, tone }).filter(e => !e.off);
  const s = settings.get();
  const cd = cooldown === undefined ? (s.eventCooldown || 0) : cooldown;
  return pick(pool, { weightOf: e => weightOf(e, luck), recent, cooldown: cd, rng });
}

/**
 * 今天撞不撞得上一件事，撞上的是哪一条。
 *
 * 概率三样东西相乘：基础概率（设置里，用户自己填）、距上次过去了几天
 * （越久越该来一次）、大运（背的时候事更多一点）。掷的是本地随机数。
 *
 * 返回 null 表示今天什么都没发生 —— 那也是一种结果，大部分日子都该是它。
 */
export function rollEvent({ charId = '', daysSince = 1, recent = [], rng = Math.random } = {}) {
  const s = settings.get();
  const char = charId ? characters.get(charId) : null;
  if (char && char.eventsOn === false) return null;

  const luck = luckOf(char);
  const base = Number(s.eventChance) || 0;
  // 背字的时候事多一点。0.15 是个很小的斜率，别让运势变成开关。
  const chance = overdue(base * Math.max(0.4, 1 - 0.15 * luck), daysSince);
  if (!roll(chance, rng)) return null;

  return draw({ luck, recent, rng });
}
