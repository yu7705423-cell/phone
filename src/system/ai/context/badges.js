import { chats, messagesOf } from '../../db/index.js';
import * as badges from '../../badges.js';

// 互动标识：连续互发了几天、今天互发了没有、刚解锁了什么。
//
// **这段对话自己的开关**（`chat.badgeAware`，默认关），在标识页里。
// 关着的时候一个字都不给 —— 标识是给人看的，角色知不知道由用户决定。
//
// 只给事实（第 16 条）：数字、状态、名字。要不要提、怎么提，由角色卡决定。

export const meta = {
  id: 'badges',
  label: '互动标识',
  desc: '连续互发的天数、今天的状态、刚解锁的标识。需在该对话的标识页开启「让角色知道」',
};

export function build({ chat }) {
  const cur = chat?.id ? chats.get(chat.id) : null;
  if (!cur || !badges.aware(cur) || !cur.stats) return '';
  const lines = [];
  const s = badges.streakOf(cur);
  if (s.state === 'lit') lines.push(`Days in a row on which both sides have messaged: ${s.n}. Today counts.`);
  else if (s.state === 'risk') lines.push(`Days in a row on which both sides have messaged: ${s.n}. Today does not count yet; the run ends at midnight unless both sides message today.`);
  else if (s.state === 'ember') lines.push(`A run of ${s.n} days ended yesterday. It resumes if the character opens today's conversation and both sides message.`);
  else if (s.best) lines.push(`The longest run of days on which both sides messaged was ${s.best}.`);

  const lv = badges.levelOf(cur);
  lines.push(`Level: ${lv.name} (${lv.level} of ${lv.max}).`);

  // 上一次角色开口之后才解锁的，算「刚刚」
  const msgs = messagesOf(cur.id);
  let since = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'char' && msgs[i].status !== 'error') { since = msgs[i].createdAt; break; }
  }
  const fresh = Object.entries({ ...(cur.unlocked || {}), ...(cur.limited || {}) })
    .filter(([, at]) => at > since)
    .map(([id]) => badges.labelOf(id))
    .filter(Boolean);
  if (fresh.length) lines.push(`Unlocked just now: ${fresh.join('; ')}.`);

  return `\n\n[互动标识]\n${lines.join('\n')}`;
}
