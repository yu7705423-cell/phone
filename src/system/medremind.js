import { settings } from './db/index.js';
import { notify } from './notify.js';
import * as health from './health.js';

// 用药到点提醒。**纯本地**：读本机的记录，发本机的一条通知，
// 不调接口、不上传、也不说「该吃药了对身体好」之类的话 —— 只说哪一项到点了。
//
// 每分钟看一眼。同一项同一个时间点只提醒一次：提醒过就把
// 「日期 + 时刻」写回那一项上，刷新页面也不会再响一遍。

const TICK = 60000;
let timer = null;

const pad = n => String(n).padStart(2, '0');
const nowHM = at => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** 这一项现在该不该响：到点了、今天还没记、而且这个时刻还没提醒过。 */
export function dueSlot(med, date, hm, took) {
  if (med.active === false) return '';
  if (took.includes(med.id)) return '';
  const passed = (med.times || []).filter(t => t <= hm).sort();
  const slot = passed[passed.length - 1];
  if (!slot) return '';
  return med.lastNotified === `${date} ${slot}` ? '' : slot;
}

export function check(at = Date.now()) {
  if (settings.get().medRemind === false) return 0;
  const date = health.dateKey(at);
  const hm = nowHM(at);
  const took = health.today(health.ME).took || [];
  let n = 0;
  for (const med of health.listMeds()) {
    const slot = dueSlot(med, date, hm, took);
    if (!slot) continue;
    health.updateMed(med.id, { lastNotified: `${date} ${slot}` });
    notify({
      title: med.name,
      body: med.dose ? `${slot} · ${med.dose}` : slot,
      icon: 'bookmark',
      appId: 'health',
      payload: { route: '/meds' },
    });
    n += 1;
  }
  return n;
}

export function start() {
  stop();
  const loop = () => { try { check(); } catch { /* 提醒挂了不该拖垮别的 */ } timer = setTimeout(loop, TICK); };
  timer = setTimeout(loop, TICK);
  return stop;
}

export function stop() {
  clearTimeout(timer);
  timer = null;
}
