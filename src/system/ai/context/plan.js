import { settings } from '../../db/index.js';
import * as todo from '../../todo.js';
import * as when from '../../when.js';

// 用户自己记下的事。
//
// **待办一直存着，却从来没进过 prompt。** 用户在聊天里说「我 15 号要去上海」，
// 检测命中、点了计入、闹钟都排上了 —— 角色仍然一无所知，因为没有任何区块
// 读这一域。这是「说过的事记不住」里最硬的那一条：那件事其实**记下来了**，
// 只是没有人把它交给模型。
//
// 只给已经确认的（OPEN）。等确认的（PENDING）不给 —— 那还不算数。
// 做完的也不给，做完就不必再提。

export const meta = {
  id: 'plan',
  label: '你记着的事',
  desc: '「待办」里已经计入、还没做的那几条。条数在「用量与上限」里，填 0 为全给',
};

const limit = () => Math.max(0, Math.round(Number(settings.get().planCount) || 0));

export function build({ persona }) {
  const n = limit();
  const rows = todo.openOnes()
    .map(r => ({ ...r, at: Number(r.remindAt || r.dueAt) || 0 }))
    // 排好时间的按时间来，没排时间的垫在后面
    .sort((a, b) => (a.at ? 0 : 1) - (b.at ? 0 : 1) || a.at - b.at)
    .slice(0, n || Infinity);
  if (!rows.length) return '';

  const now = Date.now();
  const lines = rows.map(r => {
    const t = r.at ? when.show(r.at, now) : '';
    return t ? `${t}　${r.text}` : r.text;
  });
  const who = persona?.name || '对方';
  return `\n\n[你记着的事]\n${lines.join('\n')}\n`
    + `These are things ${who} has said they intend to do. `
    + 'They have not been done yet.\n';
}
