import { recipes, meals, characters, settings } from './db/index.js';
import { normalize } from './text.js';
import { pick } from './draw.js';
import * as clock from './time.js';

// 吃饭。
//
// 要解决的是一件很具体的事：**问十次「今天吃了什么」，十次都是同一样。**
// 那不是模型偷懒，是它没有记性 —— 每一轮它都在从零想象，想出来的自然
// 总是那几个最典型的。
//
// 所以这件事不归模型管：
//   **吃什么** 本地从食谱库里抽，抽的时候看一眼最近吃过什么（draw.js 的冷却）；
//   **吃过什么** 落一条记录，下次抽的时候它就是「最近」。
//
// 冷却是「压一压」不是「封杀」：喜欢的菜本来就该常吃，只是别连着三天都是它。
// 这正是 draw.js 存在的理由，见那个文件开头。
//
// 食谱库按**地区**分，地区留空的是哪儿都有的那些。角色在哪儿吃什么，
// 取的是角色卡上的「所在地区」；没填就只吃通用的那一批。

const trim = (v, n) => String(v || '').trim().slice(0, n);

// 一天里哪几顿。和 day.js 的时段表对得上，但不共用 —— 那边是「几点到几点」，
// 这边是「这一顿叫什么」，两件事。
export { normalize };

export const MEALS = [
  { id: 'breakfast', label: '早饭', slot: 'morning' },
  { id: 'lunch', label: '午饭', slot: 'noon' },
  { id: 'dinner', label: '晚饭', slot: 'evening' },
];
export const mealOf = id => MEALS.find(m => m.id === id) || null;
export const mealBySlot = slot => MEALS.find(m => m.slot === slot) || null;

export const regionOf = char => trim(char?.region, 20);


// ---- 食谱库 ----

export function regions() {
  const set = new Set(recipes.all().map(r => r.region || ''));
  return [...set].sort();
}

/**
 * 某个角色吃得到的那一批：它所在地区的，加上不分地区的通用条目。
 * 地区留空就只剩通用的 —— 不要把别的地区的菜端上来，
 * 「在东京的人今天吃了毛血旺」这种事一眼就假。
 */
export function poolFor(char, mealId = '') {
  const region = regionOf(char);
  const rows = region ? [...recipes.byIndex(region), ...recipes.byIndex('')] : recipes.byIndex('');
  return rows.filter(r => !r.off && (!mealId || !r.meal || r.meal === mealId));
}

export function list({ region = '', meal = '' } = {}) {
  return recipes.byIndex(region)
    .filter(r => !meal || !r.meal || r.meal === meal)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function counts() {
  const out = {};
  for (const r of recipes.all()) out[r.region || ''] = (out[r.region || ''] || 0) + 1;
  return out;
}

export function has(name, region = '') {
  const key = normalize(name);
  if (!key) return false;
  return recipes.byIndex(region).some(r => normalize(r.name) === key);
}

const price = v => Math.max(0, Math.round(Number(v) * 100) / 100) || 0;

export function add({ region = '', name, meal = '', note = '', place = '', price: p = 0 }) {
  const n = trim(name, 40);
  if (!n) throw new Error('请填写名称');
  return recipes.create({
    region: trim(region, 20), name: n,
    meal: mealOf(meal) ? meal : '',
    note: trim(note, 60), place: trim(place, 40),
    // 这一顿多少钱。为了记账那边能结算，由词库生成时一并写好 ——
    // 它不多花一次接口（见 CLAUDE.md 第 15 条），抽中就直接拿来用。
    price: price(p),
    off: false,
  });
}

export function update(id, patch) {
  const row = recipes.get(id);
  if (!row) return null;
  const next = {};
  if (patch.name !== undefined) next.name = trim(patch.name, 40);
  if (patch.note !== undefined) next.note = trim(patch.note, 60);
  if (patch.place !== undefined) next.place = trim(patch.place, 40);
  if (patch.meal !== undefined) next.meal = mealOf(patch.meal) ? patch.meal : '';
  if (patch.price !== undefined) next.price = price(patch.price);
  if (patch.region !== undefined) next.region = trim(patch.region, 20);
  if (patch.off !== undefined) next.off = !!patch.off;
  return recipes.update(id, next);
}

export function remove(id) { return recipes.remove(id); }

export function addMany(rows, region = '') {
  const seen = new Set(recipes.byIndex(region).map(r => normalize(r.name)));
  const made = [];
  for (const r of rows || []) {
    const key = normalize(r.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    made.push(add({ ...r, region }));
  }
  return made;
}

// ---- 吃饭记录 ----

/** 这个角色最近吃过什么，新的在前。用来做冷却，也用来回答「昨天吃的什么」。 */
export function history(charId, limit = 0) {
  // byIndex 给的是入库顺序（旧的在前），先倒过来，再按时间稳定排一次。
  // 只按 at 排是不够的：补录、导入、同一秒里落了好几条，时间戳就是一样的，
  // 顺序一乱，「最近吃过什么」这件事本身就不成立了。
  const rows = meals.byIndex(charId).reverse();
  rows.sort((a, b) => (b.at || 0) - (a.at || 0));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export function record({ charId, meal, recipeId = '', name, place = '', price: p = 0, at = 0 }) {
  const n = trim(name, 40);
  if (!charId || !n) return null;
  return meals.create({ charId, meal, recipeId, name: n, place: trim(place, 40),
    price: price(p), at: at || clock.now().getTime() });
}

export function clearHistory(charId) {
  meals.byIndex(charId).forEach(m => meals.remove(m.id));
}

/**
 * 这一顿吃什么。
 *
 * 从这个角色吃得到的那一批里抽，最近吃过的按远近打折 —— 打折不是封杀，
 * 所以爱吃的那几样还是会常出现，只是不会连着十次都是它。
 *
 * 库是空的就返回 null。**不编**：凭空造一道菜出来，下次问又是另一道，
 * 又回到了「每次都不一样但每次都对不上」的老问题。
 */
export function draw({ charId, meal = '', rng } = {}) {
  const char = characters.get(charId);
  const pool = poolFor(char, meal);
  if (!pool.length) return null;
  const s = settings.get();
  const recent = history(charId, 0).map(m => m.recipeId).filter(Boolean);
  return pick(pool, { weightOf: r => Number(r.weight) || 1, recent, cooldown: s.mealCooldown || 0, rng });
}

/** 抽一顿并记下来。返回记录，库是空的就返回 null。 */
export function eat({ charId, meal, at = 0, rng } = {}) {
  const r = draw({ charId, meal, rng });
  if (!r) return null;
  return record({ charId, meal, recipeId: r.id, name: r.name, place: r.place,
    price: r.price, at });
}

// 上下文里怎么念这一顿。有店名就带上店名 —— 那是「联网搜出来的」那一档
// 才会有的东西，也正是它值钱的地方。
export function mealText(row) {
  if (!row) return '';
  const m = mealOf(row.meal);
  const head = m ? m.label : 'This meal';
  return row.place ? `${head}: ${row.name}（${row.place}）` : `${head}: ${row.name}`;
}
