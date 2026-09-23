import { chats, characters, messagesOf } from './db/index.js';
import * as accounts from './accounts.js';
import * as group from './group.js';
import { notify } from './notify.js';

/**
 * 那年今天。见 ARCHITECTURE 4.166
 *
 * 往年的同一天，这段对话里说过什么。全在本地翻，不调接口。
 *
 * 「同一天」按月日算。2 月 29 日只在闰年那一天对得上 —— 挪到 28 日的话，
 * 那一天会同时冒出两年的东西，而其中一年其实不是这一天。
 *
 * 只算你和角色都开过口的那一天：只有你一个人发了几句、或者只有角色的一条主动消息，
 * 翻出来没什么可看的，提醒一次反而打扰。
 */

const REMIND_KEY = 'phone.onthisday.reminded';

const md = d => `${d.getMonth()}-${d.getDate()}`;
const counted = m => m.role === 'user' || m.role === 'char';

/**
 * 这段对话在往年的「这一天」。at 是要看的那一天（默认今天）。
 * 回 [{ year, ago, msgs }]，近的在前。msgs 是那一天的全部消息，按时间排好
 */
export function ofChat(chatId, at = Date.now()) {
  const day = new Date(at);
  const key = md(day);
  const thisYear = day.getFullYear();
  const byYear = new Map();
  for (const m of messagesOf(chatId)) {
    if (!m.createdAt || !counted(m)) continue;
    const d = new Date(m.createdAt);
    if (d.getFullYear() >= thisYear || md(d) !== key) continue;
    const y = d.getFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(m);
  }
  const out = [];
  for (const [year, msgs] of byYear) {
    if (!msgs.some(m => m.role === 'user') || !msgs.some(m => m.role === 'char')) continue;
    msgs.sort((a, b) => a.createdAt - b.createdAt);
    out.push({ year, ago: thisYear - year, msgs });
  }
  return out.sort((a, b) => b.year - a.year);
}

/** 每天提醒一次。挂在会话上，默认开着（本地通知，不花钱） */
export const remindOn = chat => chat?.onThisDay !== false;
export const setRemind = (chatId, on) => chats.update(chatId, { onThisDay: !!on });

// 提醒的时刻。早上九点之后，免得半夜弹出来
const HOUR = 9;

function remindedMap() {
  try { return JSON.parse(localStorage.getItem(REMIND_KEY) || '{}') || {}; } catch { return {}; }
}

const nameOf = chat => (group.isGroup(chat) ? group.titleOf(chat)
  : characters.get((chat.characterIds || [])[0])?.name || '会话');

/** 挂在 proactive.tick 上。每段对话一天最多一条 */
export function tick(now = Date.now()) {
  if (new Date(now).getHours() < HOUR) return;
  const today = new Date(now).toDateString();
  const me = accounts.currentId();
  const done = remindedMap();
  let dirty = false;
  for (const chat of chats.all()) {
    if ((chat.personaId || me) !== me || !remindOn(chat) || done[chat.id] === today) continue;
    const years = ofChat(chat.id, now);
    done[chat.id] = today;
    dirty = true;
    if (!years.length) continue;
    const y = years[0];
    notify({
      title: '那年今天', icon: 'calendar', appId: 'chat', payload: { route: `/onthisday/${chat.id}` },
      body: `${y.ago} 年前的今天，与${nameOf(chat)}的对话共 ${y.msgs.length} 条`
        + (years.length > 1 ? `。共 ${years.length} 年的这一天有记录` : ''),
    });
  }
  if (dirty) {
    // 只留今天的，旧日子的记号没用
    for (const id of Object.keys(done)) if (done[id] !== today) delete done[id];
    try { localStorage.setItem(REMIND_KEY, JSON.stringify(done)); } catch { /* 隐私模式 */ }
  }
}
