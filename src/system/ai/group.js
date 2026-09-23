import { settings, messagesOf } from '../db/index.js';
import * as accounts from '../accounts.js';
import { uid } from '../store.js';
import * as group from '../group.js';
import * as ban from '../ban.js';
import { streamGroupReply, streamReply, groupKey, replyKey } from './engine.js';
import { cancel, isRunning } from './queue.js';
import { renderGroupTurn, renderTurn } from './reply.js';

/**
 * 群聊一轮。会话页、「过一会儿才回」的后台那一路都走这里（见 ARCHITECTURE 4.162）。
 *
 * 两档：
 *
 *   一次调用写整轮（默认）  一次请求，模型按名字写出这一轮开口的几个人
 *   每个角色单独调用        「用量与上限」里的开关，默认关（第 15 条）。
 *                           每个开口的成员各一次请求，各自只看自己的角色卡
 *
 * 单独调用那一档谁开口：这一轮被 @ 的那几个；没 @ 人就全体按顺序说一遍。
 * 后说的看得见先说的（每次都重新读一遍消息）。
 */

export const perCharOn = () => settings.get().groupPerChar === true;

export const isBusy = chat => isRunning(groupKey(chat.id))
  || group.members(chat).some(c => isRunning(replyKey(chat.id, c.id)));

export function stop(chat) {
  cancel(groupKey(chat.id));
  group.members(chat).forEach(c => cancel(replyKey(chat.id, c.id)));
}

/** 单独调用那一档，这一轮谁开口 */
export function speakersOf(chat) {
  const members = group.members(chat);
  const called = group.pendingMentions(messagesOf(chat.id))
    .map(id => members.find(c => c.id === id)).filter(Boolean);
  return called.length ? called : members;
}

/**
 * 跑一轮。返回落下来的消息。
 * turnId / swipes 是「重新生成」时带进来的：整轮删掉重写，新原文追加进候选。
 */
export async function run(chat, { turnId: reuseTurn, swipes: prevSwipes, onDelta, notify = true } = {}) {
  const members = group.members(chat);
  if (members.length < 1) throw new Error('群里没有成员');

  if (perCharOn()) {
    const made = [];
    for (const char of speakersOf(chat)) {
      const raw = String(await streamReply({ chat, char }) || '').trim();
      if (!raw) continue;
      made.push(...await renderTurn({
        chat, char, raw, turnId: uid('turn'), swipes: [raw], swipeIndex: 0, notify,
      }));
    }
    return made;
  }

  // 命中禁写词就再要一次。默认一次都不重（第 15 条），和一对一同一个开关
  const tries = [];
  let clean = '';
  for (let i = 0; i <= ban.rerollMax(); i++) {
    const t = String(await streamGroupReply({ chat, onDelta }) || '').trim();
    if (!t) break;
    tries.push(t);
    clean = t;
    if (!ban.scan(t).length) break;
  }
  if (!clean) throw new Error('模型返回了空内容');
  const swipes = [...(prevSwipes || []), ...tries];
  return replay(chat, clean, { turnId: reuseTurn || uid('turn'), swipes, swipeIndex: swipes.length - 1, notify });
}

/** 按存下来的原文整轮落一遍。切换候选时不调接口，走的也是这里 */
export function replay(chat, raw, { turnId, swipes, swipeIndex, notify = false, instant = false }) {
  const me = accounts.get(chat.personaId) || accounts.current();
  return renderGroupTurn({
    chat, members: group.members(chat), raw, turnId, swipes, swipeIndex, notify, instant,
    userName: me?.name || '',
    fallback: group.pendingMentions(messagesOf(chat.id))[0] || '',
  });
}
