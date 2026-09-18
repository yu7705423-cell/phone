import { days, characters } from './db/index.js';
import * as clock from './time.js';
import * as events from './events.js';
import * as food from './food.js';
import { uid } from './store.js';

// 角色的一天。
//
// 一条记录 = 一个角色的某一天，里面装三样东西：
//   **日程** 她自己安排的，由模型按人设生成，一天一次；
//   **随机事件** 撞上的，本地骰子从事件库里抽，绑在某个时段上；
//   **大运** 当天的走势，一个有惯性的慢变量，每天挪一小步。
//
// 注入分两层，这是整件事的要害：
//   **一整天的摘要**当天常驻 —— 她当然知道自己今天要干什么；
//   **具体到某个时段的事**，以及撞上的那件随机事件，
//   **只有时段到了才注入**。中午十二点就知道「今晚会停电」，那不叫过日子。
//
// 事项可以被聊天改写（「今天不去了」），但不能当没安排过 —— 提示语里
// 把这两件事都写明白：改可以，无视不行。

export const SLOTS = [
  { id: 'morning', label: '早上', from: 6, to: 11 },
  { id: 'noon', label: '中午', from: 11, to: 14 },
  { id: 'afternoon', label: '下午', from: 14, to: 18 },
  { id: 'evening', label: '晚上', from: 18, to: 23 },
  { id: 'night', label: '深夜', from: 23, to: 6 },
];

export const slotOf = id => SLOTS.find(s => s.id === id) || null;
export const slotIndex = id => SLOTS.findIndex(s => s.id === id);

// 状态。「进行中」不存 —— 它是「这一条落在当前时段」推出来的，
// 存一份就要有人负责在时间走过去的时候改它，那是一个永远会忘的活。
export const PLAN = 'plan';
export const DONE = 'done';
export const DROP = 'drop';
export const stateLabel = s => (s === DONE ? '已完成' : s === DROP ? '已取消' : '计划中');

const hourIn = (h, s) => (s.from < s.to ? (h >= s.from && h < s.to) : (h >= s.from || h < s.to));

/** 这个角色那边现在是哪个时段。按角色自己的时区算。 */
export function slotNow(char, at = clock.now()) {
  const p = clock.partsOf(at, clock.charZone(char));
  const h = Number(p.hour);
  return SLOTS.find(s => hourIn(h, s)) || SLOTS[0];
}

/** 角色那边今天是几号。深夜那一段算前一天 —— 凌晨两点说「今天」指的是昨天那一天。 */
export function dateKey(char, at = clock.now()) {
  const zone = clock.charZone(char);
  const p = clock.partsOf(at, zone);
  const h = Number(p.hour);
  let d = new Date(`${p.year}-${p.month}-${p.day}T00:00:00`);
  if (h < SLOTS[0].from) d = new Date(d.getTime() - 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function weekdayOf(char, at = clock.now()) {
  return clock.partsOf(at, clock.charZone(char)).weekday || '';
}

// ---- 取与存 ----

export function get(charId, date) {
  return days.byIndex(charId).find(d => d.date === date) || null;
}

export function today(charId) {
  const char = characters.get(charId);
  if (!char) return null;
  return get(charId, dateKey(char));
}

export function recent(charId, limit = 7) {
  const rows = days.byIndex(charId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export const isOn = char => !!(char && char.dayOn);
export function setOn(charId, on) { characters.update(charId, { dayOn: !!on }); }

/**
 * 落一天。items 是模型给的 [{ slot, text }]，这里补上 id 与状态。
 * 同一天再落一次就整条换掉 —— 「重新安排今天」走的就是这条路。
 */
export function save(charId, { date, items = [], event = null, luck = 0, meals = [] }) {
  const rows = items
    .map(it => ({
      id: it.id || uid('it'),
      slot: it.slot,
      text: String(it.text || '').trim().slice(0, 60),
      kind: it.kind || 'plan',
      state: it.state || PLAN,
    }))
    // 时段认不出来就整条丢掉。挪到一个默认时段等于凭空替她安排了一件事，
    // 而她自己从来没这么说过。
    .filter(it => it.text && slotOf(it.slot))
    .sort((a, b) => slotIndex(a.slot) - slotIndex(b.slot));

  const old = get(charId, date);
  const row = { charId, date, items: rows, event, luck, meals };
  return old ? days.update(old.id, row) : days.create(row);
}

export function setState(dayId, itemId, state) {
  const d = days.get(dayId);
  if (!d) return null;
  const items = (d.items || []).map(it => (it.id === itemId ? { ...it, state } : it));
  return days.update(dayId, { items });
}

/**
 * 模型写「事项完成」时给的是一小段原话，拿它回头去认领。
 * 认不出来就不动 —— 凭空标完一条别的事比不标更糟，和约定那边同一条规矩。
 */
export function findItem(day, text) {
  const q = String(text || '').replace(/\s+/g, '');
  const open = (day?.items || []).filter(it => it.state === PLAN);
  if (!open.length) return null;
  if (!q) return null;
  for (let i = open.length - 1; i >= 0; i--) {
    const t = String(open[i].text || '').replace(/\s+/g, '');
    if (t && (t.includes(q) || q.includes(t))) return open[i];
  }
  return null;
}

export function remove(id) { return days.remove(id); }

export function clearOf(charId) {
  days.byIndex(charId).forEach(d => days.remove(d.id));
}

// ---- 本地掷的那几样 ----

/**
 * 一天里本地要掷的东西，一次掷完：大运往前挪一步、看撞不撞得上一件事、
 * 三顿吃什么。全都不问模型 —— 撞上什么是运气，吃什么该有记性。
 *
 * 随机事件抽中之后**绑一个时段**。绑在哪儿也是掷出来的：
 * 它总得发生在某个具体的时候，否则「只在时段到了才注入」就无从谈起。
 */
export function rollLocal(charId, { rng = Math.random, date } = {}) {
  const char = characters.get(charId);
  if (!char) return { luck: 0, event: null, meals: [] };

  const luck = events.advanceLuck(charId, { rng });

  const last = recent(charId, 2).find(d => d.date !== date);
  const gap = last ? Math.max(1, Math.round((new Date(date) - new Date(last.date)) / 86400000)) : 1;
  const hit = events.rollEvent({
    charId, daysSince: gap, rng,
    recent: recent(charId, 30).map(d => d.event?.eventId).filter(Boolean),
  });
  // 深夜那一档不放事件：那个点她多半已经睡了，撞上什么也没人看见
  const pool = SLOTS.filter(s => s.id !== 'night');
  const event = hit ? {
    eventId: hit.id, text: hit.text, tone: hit.tone, domain: hit.domain,
    slot: pool[Math.floor(rng() * pool.length)].id,
  } : null;

  const meals = [];
  for (const m of food.MEALS) {
    const r = food.eat({ charId, meal: m.id, rng });
    if (r) meals.push({ meal: m.id, name: r.name, place: r.place, recipeId: r.recipeId });
  }

  return { luck, event, meals };
}

// ---- 注入 ----

const mealLine = m => {
  const label = food.mealOf(m.meal)?.label || '这一顿';
  return m.place ? `${label}吃了${m.name}（${m.place}）` : `${label}吃了${m.name}`;
};

/**
 * 给注入块用的那一份。**分两层**：
 *   summary 一整天的摘要，当天常驻；
 *   now     当前时段的具体事项、这一顿吃的、以及撞上的那件事。
 *
 * 还没到的时段一律只出现在摘要里，而且摘要只写「几点钟要做什么」，
 * 不写结果 —— 早上八点就知道晚上那顿饭好不好吃，那不叫过日子。
 */
export function brief(charId, at = clock.now()) {
  const char = characters.get(charId);
  if (!char || !isOn(char)) return null;
  const date = dateKey(char, at);
  const day = get(charId, date);
  if (!day) return null;

  const cur = slotNow(char, at);
  const curIdx = slotIndex(cur.id);
  const items = day.items || [];

  const summary = SLOTS.map(s => {
    const list = items.filter(it => it.slot === s.id && it.state !== DROP);
    if (!list.length) return '';
    return `${s.label}：${list.map(it => it.text + (it.state === DONE ? '（已完成）' : '')).join('；')}`;
  }).filter(Boolean);

  const nowItems = items.filter(it => it.slot === cur.id && it.state === PLAN);
  const meal = (day.meals || []).find(m => food.mealBySlot(cur.id)?.id === m.meal);

  // 事件只在它那个时段到了之后才出现。没到就一个字都不提。
  const ev = day.event;
  const evReady = ev && slotIndex(ev.slot) >= 0 && slotIndex(ev.slot) <= curIdx;

  return {
    date, slot: cur, summary,
    nowItems: nowItems.map(it => it.text),
    meal: meal ? mealLine(meal) : '',
    event: evReady ? ev : null,
    luck: day.luck || 0,
    done: items.filter(it => it.state === DONE).length,
    total: items.length,
  };
}
