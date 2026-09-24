import { characters } from '../../db/index.js';
import * as healthStore from '../../health.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';
import { listFor } from '../context/memory.js';

// 按人设生成角色今天的身体状态。
//
// **这一份仍然是「设定」，不是「测量」。** 和手填那一份同一个性质，
// 只是不用一格一格点了 —— 用户的原话是「不要帮角色填写，要一键生成」。
//
// 用户按一下才跑，不是每轮都跑，所以不在 EXTRA_CALLS 里（那张表管的是
// 「发一条消息会不会变成两次请求」）。按第 15 条走副用接口。

/**
 * 模型给什么都不能直接落库。
 *
 * 那几个字段都是**有限集**：精力三档、心情四档、症状九种、形态七种。
 * 模型会自己发明 id（'tired'、'anxious'、'b8'），照单收下的话界面上那一格
 * 什么都不显示，而库里躺着一个谁也认不出的值 —— 查起来要一路查到这里。
 * 所以逐项对着表收，对不上就丢。
 */
const pickId = (v, list) => (list.some(x => x.id === v) ? v : '');

const pickIds = (v, list) => (Array.isArray(v) ? v : [])
  .map(x => pickId(String(x || ''), list))
  .filter(Boolean)
  .filter((x, i, a) => a.indexOf(x) === i);

// 「07:30」这种。认不出就空着 —— 空的时间界面上本来就允许
const pickTime = v => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || '').trim())
  ? String(v).trim() : '');

const pickPoops = v => (Array.isArray(v) ? v : []).slice(0, 5).map(x => ({
  at: pickTime(x?.at),
  form: pickId(String(x?.form || ''), healthStore.POOP_FORMS),
}));

/** 睡了多久。按分钟，钳在一天之内 —— 模型偶尔会把小时当分钟填。 */
const pickSleep = v => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(24 * 60, n);
};

function charContext(char) {
  const mems = listFor(char.id)
    .filter(m => m.rank === 'S' || m.rank === 'A')
    .slice(0, 8)
    .map(m => `- ${m.content}`).join('\n');
  return [char.persona, mems ? `What you remember lately:\n${mems}` : ''].filter(Boolean).join('\n\n');
}

// 星期几。日程那边也要这个，但它算的是「世界时间」下的星期；
// 这里算的是这一天本身，两回事，不共用
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 这几个有限集要原样交给模型，否则它只能猜 id。 */
const listOf = arr => arr.map(x => `${x.id} = ${x.label}`).join('\n');

/**
 * 生成一份，**直接落库并回那一行**。
 *
 * 落库前不问「要不要覆盖」—— 那是界面的事，它知道原来那一格有没有东西。
 */
export async function generateDay(charId, date = healthStore.dateKey()) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');

  const system = fillTemplate(template('task.health-day'), {
    charName: char.name || '',
    date,
    weekday: WEEK[new Date(`${date}T12:00:00`).getDay()] || '',
    energyList: listOf(healthStore.ENERGY),
    moodList: listOf(healthStore.MOODS),
    symptomList: listOf(healthStore.SYMPTOMS),
    poopList: listOf(healthStore.POOP_FORMS),
  }) + `\n\n## Their own settings\n${charContext(char)}`;

  const r = await runJSONTask('health.day', { system, key: `health-day:${charId}:${date}`, maxTokens: 500 });
  if (!r) throw new Error('模型没有返回内容');

  const patch = {
    energy: pickId(String(r.energy || ''), healthStore.ENERGY),
    mood: pickId(String(r.mood || ''), healthStore.MOODS),
    symptoms: pickIds(r.symptoms, healthStore.SYMPTOMS),
    sleepMin: pickSleep(r.sleepMin),
    poops: pickPoops(r.poops),
    note: String(r.note || '').trim().slice(0, 200),
    // 标出来这一份是生成的，不是手填的。健康那边本来就分 manual / import
    source: 'ai',
  };
  return healthStore.set(charId, date, patch);
}

// ---- 每天自动生成 ----
//
// 开关挂在角色身上（char.healthAuto，健康 app 里那个角色的页面上，第 5 条）。
// 每天一次模型调用，默认关，登记在 cost.js（第 15 条）。
//
// 两个入口：和这个角色聊天之前（这一轮就读得到今天的身体状态），以及全局那个
// 定时器（不聊天也每天填上，健康 app 里看得到）。
//
// **一天只试一次，失败也算试过**（healthAutoAt 记着日期）—— 和当日日程同一个教训：
// 不记的话，失败之后每发一条消息、每二十秒都再试一次，账单一直涨，界面上一个字都没有。
// 失败了在那个角色的页面上手动点「按人设生成今天」。
//
// **已经有内容的那一天不碰**：手填的那一份是一格一格点出来的，不能被自动的盖掉。

const inFlight = new Set();

const filled = d => !!(d && (d.energy || d.mood || (d.symptoms || []).length
  || d.sleepMin || (d.poops || []).length || d.note));

export const isAuto = char => !!(char && char.healthAuto === true);

export async function ensureToday(charId) {
  const char = characters.get(charId);
  if (!isAuto(char) || inFlight.has(charId)) return null;
  const date = healthStore.dateKey();
  if (char.healthAutoAt === date) return null;
  if (filled(healthStore.dayOf(charId, date))) return null;
  inFlight.add(charId);
  characters.update(charId, { healthAutoAt: date, healthAutoError: '' });
  try {
    return await generateDay(charId, date);
  } catch (err) {
    characters.update(charId, { healthAutoError: String(err.message || err) });
    console.warn('[health] 今天没自动生成:', err.message || err);
    return null;
  } finally {
    inFlight.delete(charId);
  }
}
