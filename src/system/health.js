import { health, cycles, meds, settings, characters } from './db/index.js';
import * as clock from './time.js';

// 健康。**这是一本记录，不是一个会看病的东西。**
//
// 全程不调接口：没有评估、没有建议、没有「你这样不健康」。数字是你自己填的，
// 角色看到之后怎么反应由它的人设决定 —— 那是角色在关心，不是 app 在下结论。
// 上下文块同理，只写事实（第 16 条）。
//
// 两边都记：
//   who = 'me'      你自己填的，是真的
//   who = <角色 id> 角色的身体状态，和「角色的一天」一样是设定出来的
//
// 每人每天一行。`source` 留着给以后用：打包成 app 之后从系统健康里导进来的
// 那些标 'import'，和手填的分得开，也才知道哪些不该被覆盖。

export const ME = 'me';

export const MOODS = [
  { id: 'good', label: '不错' },
  { id: 'flat', label: '一般' },
  { id: 'low', label: '低落' },
  { id: 'tense', label: '烦躁' },
];

export const ENERGY = [
  { id: 'high', label: '精神' },
  { id: 'mid', label: '还行' },
  { id: 'low', label: '疲惫' },
];

// 常见的几样，点一下就记上。写不下的填「其他」那一栏
export const SYMPTOMS = [
  { id: 'headache', label: '头痛' },
  { id: 'stomach', label: '胃不舒服' },
  { id: 'cold', label: '感冒' },
  { id: 'fever', label: '发热' },
  { id: 'throat', label: '嗓子疼' },
  { id: 'cramp', label: '腹痛' },
  { id: 'back', label: '腰背酸' },
  { id: 'sleepy', label: '困倦' },
  { id: 'dizzy', label: '头晕' },
];

// 排便。记两样：**次数**和**形态**。
//
// 形态按布里斯托分型那七档写，从硬到稀。**七档只描述外观，不下结论** ——
// 这里不写「便秘」「腹泻」，那是判断，这个 app 不做判断（第 16 条）。
// 看见「一颗颗硬球」之后想到什么，是你自己的事，也是角色按人设自己的事。
export const POOP_FORMS = [
  { id: 'b1', label: '一颗颗硬球' },
  { id: 'b2', label: '块状凹凸' },
  { id: 'b3', label: '表面有裂痕' },
  { id: 'b4', label: '表面光滑' },
  { id: 'b5', label: '软块' },
  { id: 'b6', label: '糊状' },
  { id: 'b7', label: '水样' },
];

export const moodOf = id => MOODS.find(m => m.id === id) || null;
export const energyOf = id => ENERGY.find(e => e.id === id) || null;
export const symptomOf = id => SYMPTOMS.find(s => s.id === id) || null;
export const poopFormOf = id => POOP_FORMS.find(p => p.id === id) || null;

const pad = n => String(n).padStart(2, '0');

/** 本地日期。跟着「时间」那一套走，角色有自己的时区时也对得上。 */
export function dateKey(at = clock.now()) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const shiftDate = (key, days) => {
  const [y, m, d] = String(key).split('-').map(Number);
  const t = new Date(y, (m || 1) - 1, d || 1);
  t.setDate(t.getDate() + days);
  return dateKey(t.getTime());
};

/** 两个日期差几天。周期那边算长度用它。 */
export function daysBetween(a, b) {
  const p = k => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  return Math.round((p(b) - p(a)) / 86400000);
}

const blank = (who, date) => ({
  who, date, sleepMin: 0, sleepAt: '', steps: 0, weight: 0, water: 0,
  poop: 0, poopForm: '',
  mood: '', energy: '', symptoms: [], note: '', took: [], source: 'manual',
});

/** 某人某天那一行。没有就给一张空的，不落库。 */
export function dayOf(who, date = dateKey()) {
  return health.byIndex(who).find(r => r.date === date) || blank(who, date);
}

export const today = (who = ME) => dayOf(who, dateKey());

export function set(who, date, patch) {
  const old = health.byIndex(who).find(r => r.date === date);
  if (old) return health.update(old.id, patch);
  return health.create({ ...blank(who, date), ...patch });
}

/** 最近 n 天，新的在前。空着的那几天不补，翻历史看的是记过的那些。 */
export const recent = (who = ME, n = 30) => health.byIndex(who)
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  .slice(0, n);

/** 喝水点一下加一杯。**不设上限**（第 13 条），想喝多少是你的事。 */
export const addWater = (who = ME, n = 1) => {
  const d = today(who);
  return set(who, d.date, { water: Math.max(0, (d.water || 0) + n) });
};

export function toggleSymptom(who, date, id) {
  const d = dayOf(who, date);
  const has = (d.symptoms || []).includes(id);
  return set(who, date, {
    symptoms: has ? d.symptoms.filter(x => x !== id) : [...(d.symptoms || []), id],
  });
}

export const wipe = who => health.byIndex(who).forEach(r => health.remove(r.id));

// ---- 体重单位 ----
//
// 一律按公斤存，显示时换算。存两套单位迟早会有一处忘了换。

export const unit = () => (settings.get().weightUnit === 'lb' ? 'lb' : 'kg');
export const toDisplay = kg => (unit() === 'lb' ? +(kg * 2.2046226).toFixed(1) : +Number(kg).toFixed(1));
export const fromDisplay = v => (unit() === 'lb' ? +(Number(v) / 2.2046226).toFixed(2) : Number(v));

// ---- 睡眠 ----

export const fmtSleep = min => {
  const m = Math.max(0, Math.round(min) || 0);
  if (!m) return '';
  return m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分钟`;
};

// ---- 经期 ----
//
// 只做一件事：把你自己记的那几次算个平均，推下一次大概什么时候。
// **这是对你自己记录的算术，不是医学判断**，界面上也这么写。

export const listCycles = () => cycles.all()
  .sort((a, b) => (b.start || '').localeCompare(a.start || ''));

export const startCycle = (date = dateKey()) => cycles.create({ start: date, end: '', note: '' });
export const endCycle = (id, date = dateKey()) => cycles.update(id, { end: date });
export const removeCycle = id => cycles.remove(id);

/** 正在进行的那一次（记了开始、还没记结束）。 */
export const openCycle = () => listCycles().find(c => c.start && !c.end) || null;

/**
 * 按已有记录推下一次。至少要两次才有间隔可算，不够就不给数。
 * 只取最近六次算平均 —— 再往前的对现在没什么参考价值。
 */
export function predictCycle() {
  const list = listCycles().filter(c => c.start);
  if (list.length < 2) return null;
  const gaps = [];
  for (let i = 0; i < list.length - 1 && gaps.length < 6; i++) {
    const g = daysBetween(list[i + 1].start, list[i].start);
    if (g > 10 && g < 90) gaps.push(g);      // 离谱的那几个不参与平均
  }
  if (!gaps.length) return null;
  const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  const last = list[0].start;
  return { avg, samples: gaps.length, next: shiftDate(last, avg), from: last };
}

// ---- 用药 ----
//
// 只记「吃了什么、什么时候吃」，到点提醒一下。**不给任何用药建议**，
// 剂量写什么是你自己的事，这里一个字都不评。

export const listMeds = () => meds.all().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
export const activeMeds = () => listMeds().filter(m => m.active !== false);

export const addMed = ({ name, dose = '', times = [], note = '' }) => {
  const n = String(name || '').trim();
  if (!n) throw new Error('请填写名称');
  return meds.create({ name: n.slice(0, 40), dose: String(dose).slice(0, 40),
    times: [...new Set(times)].sort(), note: String(note).slice(0, 200), active: true });
};

export const updateMed = (id, patch) => meds.update(id, patch);
export const removeMed = id => meds.remove(id);

/** 今天吃过哪几样。记在当天那一行上，不另开一张表。 */
export function takeMed(medId, date = dateKey()) {
  const d = today(ME);
  const took = d.took || [];
  return set(ME, date, {
    took: took.includes(medId) ? took.filter(x => x !== medId) : [...took, medId],
  });
}

/** 今天还没吃、而且时间已经到了的那几样。提醒按它发。 */
export function dueMeds(at = clock.now()) {
  const now = new Date(at);
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const took = today(ME).took || [];
  return activeMeds().filter(m => !took.includes(m.id)
    && (m.times || []).some(t => t <= hhmm));
}

// ---- 角色那一份 ----
//
// 和「角色的一天」一样是设定出来的，不是测出来的。开关在角色卡上。

export const charOn = charId => characters.get(charId)?.healthOn === true;
export const setCharOn = (charId, v) => characters.update(charId, { healthOn: v === true });
export const charsWithHealth = () => characters.all().filter(c => !c.isNpc && !c.parentId && c.healthOn);
