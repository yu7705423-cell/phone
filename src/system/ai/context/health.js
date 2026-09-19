import { settings } from '../../db/index.js';
import * as health from '../../health.js';
import * as accounts from '../../accounts.js';

// 「身体」那一段。
//
// 和 bill.js、geo.js 同一个道理：**这几个数字不能让模型编。** 问它「我昨晚睡了多久」，
// 它会给一个听起来很像的数。所以睡了几小时、走了多少步，一律本地读出来写进去。
//
// **只写事实，不写判断。** 不写「所以你该早点睡」，也不写「她今天状态不好，
// 你要哄她」—— 那是判断，不是事实（第 16 条）。知道了怎么反应，由角色按人设决定。
//
// 两道门：用户那一份要总开关开着（默认关，这是身体数据，不默认递出去）；
// 经期还要再单独开一道。角色自己那一份跟着它角色卡上的开关走，和用户那份无关。

export const meta = {
  id: 'health',
  label: '身体状况',
  desc: '当天的睡眠、步数、体重、饮水、心情与不适。需在「健康 - 设置」中开启；经期与排便另有各自的开关',
};

const listOf = ids => ids.map(x => health.symptomOf(x)?.label).filter(Boolean).join('、');

function mine() {
  if (settings.get().healthInject !== true) return [];
  const d = health.today(health.ME);
  const me = accounts.get();
  const who = me?.name || 'They';
  const out = [];

  if (d.sleepMin) {
    out.push(`Slept ${health.fmtSleep(d.sleepMin)}`
      + (d.sleepAt ? `, went to bed at ${d.sleepAt}.` : '.'));
  }
  if (d.steps) out.push(`Walked ${d.steps.toLocaleString()} steps.`);
  if (d.weight) out.push(`Weight ${health.toDisplay(d.weight)} ${health.unit()}.`);
  if (d.water) out.push(`Drank ${d.water} glasses of water.`);
  if (d.mood) out.push(`Mood: ${health.moodOf(d.mood)?.label}.`);
  if (d.energy) out.push(`Energy: ${health.energyOf(d.energy)?.label}.`);
  if ((d.symptoms || []).length) out.push(`Unwell: ${listOf(d.symptoms)}.`);
  if (d.note) out.push(`Also noted: ${d.note}`);

  // 排便单独一道开关。写的也只是次数与形态这两个记下来的事实，
  // 形态那一档的原话照抄，不翻译也不改写成结论（第 14、16 条）
  if (settings.get().healthPoopInject === true && d.poop) {
    const form = health.poopFormOf(d.poopForm);
    out.push(`Bowel movements: ${d.poop} today`
      + (form ? `, recorded form: ${form.label}.` : '.'));
  }

  if (settings.get().healthCycleInject === true) {
    const open = health.openCycle();
    if (open) {
      out.push(`Currently on day ${health.daysBetween(open.start, health.dateKey()) + 1} of their period.`);
    } else {
      const p = health.predictCycle();
      if (p) out.push(`Next period estimated around ${p.next}, from their own records.`);
    }
  }

  return out.length ? [`## ${who} today`, ...out] : [];
}

function theirs(char) {
  if (!char || !health.charOn(char.id)) return [];
  const d = health.dayOf(char.id);
  const out = [];
  if (d.energy) out.push(`Energy: ${health.energyOf(d.energy)?.label}.`);
  if (d.mood) out.push(`Mood: ${health.moodOf(d.mood)?.label}.`);
  if ((d.symptoms || []).length) out.push(`Unwell: ${listOf(d.symptoms)}.`);
  if (d.sleepMin) out.push(`Slept ${health.fmtSleep(d.sleepMin)}.`);
  if (d.note) out.push(`Also: ${d.note}`);
  return out.length ? ['## Your own body today', ...out] : [];
}

export function build({ char } = {}) {
  const a = mine();
  const b = theirs(char);
  if (!a.length && !b.length) return '';
  const tail = 'These are recorded figures. Do not invent them and do not change them.';
  return [...a, ...b, tail].join('\n');
}
