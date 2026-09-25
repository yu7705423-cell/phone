// 每天一次的自动任务：**当天试过就不再自动试，成功失败都算**（用户要求，ARCHITECTURE 4.241）。
//
// 失败了当天就在界面上写明失败；自动的那一次要等到第二天。用户自己点「重试」「重新安排」
// 「现在选一次」是手动的，不在这里拦。
//
// 为什么在角色身上的日期标记（healthAutoAt、closetDailyAt、日程那条记录）之外还要这一道：
//   · 那几个标记在内存里的那份数据上。同一个网址开着两个页面时，各有各的一份，
//     另一个页面在刷新之前看不见这边刚写的，会再试一次
//   · 从前开关关掉再打开会把标记清空，当天又自动来一次
// 这里记在 localStorage：同步读写、同一个网址的页面共用一份，写下去另一个页面立刻看得见。
// 读写不了（无痕模式之类）时退回内存里的这一份，仍然挡得住这个页面里的重复。
const KEY = 'phone.daily.tried';
const mem = {};

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return { ...mem }; }
}
function write(m) {
  Object.assign(mem, m);
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* 退回内存那一份 */ }
}

const slot = (task, id) => `${task}:${id}`;

/** 这件事今天（date，由各任务按自己的「今天」算）是不是已经自动试过 */
export function triedOn(task, id, date) {
  return read()[slot(task, id)] === date || mem[slot(task, id)] === date;
}

/**
 * 占住今天。占到了返回 true，今天已经被占过返回 false。**在发请求之前调**。
 * 顺手把不是今天的旧记号清掉，这张表不会越长越大
 */
export function claim(task, id, date) {
  if (triedOn(task, id, date)) return false;
  const m = read();
  for (const k of Object.keys(m)) if (m[k] !== date && k.startsWith(`${task}:`)) delete m[k];
  m[slot(task, id)] = date;
  write(m);
  return true;
}
