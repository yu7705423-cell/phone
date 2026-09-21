import { messages, messagesOf, settings } from './db/index.js';

// 消息上的时刻与已读回执。见 ARCHITECTURE 4.112
//
// **「已读」= 角色开始生成回复的那一瞬。** 不另外存一份状态，也不去猜：
// 她动笔了，就是看见了。她一直没回，就一直是未读 —— 那恰好是想看到的意思。
//
// 只给自己发的消息打。角色发的那些不存在「我读没读」这回事：
// 你正看着这一屏，屏幕上的都读过了。
//
// **绝大多数已读不存在库里，是推出来的。** 后面已经有角色说过话了，
// 前面那些当然被看过 —— 这种不必逐条写一遍 `readAt`。真要存的只有
// 「最后一条角色消息之后发的那几条」，也就是此刻正悬着的那几条。
// 这样开着这个开关之前的几万条历史一条都不用回填，显示出来也是对的。

export const on = () => settings.get().msgRead === true;

export const STAMPS = [
  { id: 'off', label: '不显示' },
  { id: 'side', label: '气泡旁边' },
  { id: 'below', label: '气泡下方' },
];

export const stampMode = () => {
  const v = settings.get().msgStamp;
  return STAMPS.some(x => x.id === v) ? v : 'off';
};

/** 时刻怎么写。当天只写时分，隔天带上日期 —— 隔天还只写时分会看错。 */
export function stampOf(ts, now = Date.now()) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (t >= today.getTime()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 这段会话里最后一条角色消息的时刻。在它之前发出去的，都已经被看过了。 */
export function readUpTo(chatId) {
  if (!chatId) return 0;
  let t = 0;
  messagesOf(chatId).forEach(m => {
    if (m.role === 'char' && m.createdAt > t) t = m.createdAt;
  });
  return t;
}

/**
 * 把此刻还悬着的那几条标成已读。角色动笔之前调一次。
 *
 * 只标最后一条角色消息之后发的 —— 更早的那些靠 readUpTo 推得出来，
 * 逐条写一遍只会在第一次调用时把整段历史全改一遍。
 *
 * 已经标过的不再动：时刻要停在**第一次**被看见那一下，重标会让它往后跑。
 * 回来的是标了几条。
 */
export function markRead(chatId, at = Date.now()) {
  if (!chatId) return 0;
  const line = readUpTo(chatId);
  let n = 0;
  messagesOf(chatId).forEach(m => {
    if (m.role !== 'user' || m.readAt || m.createdAt <= line) return;
    messages.update(m.id, { readAt: at });
    n += 1;
  });
  return n;
}

/**
 * 这一条该显示什么。不是自己发的、或者回执关着，回来空字符串。
 * `upTo` 是这段会话的 readUpTo，由调用方算一次传进来 —— 每条气泡各算一遍
 * 要把整段消息扫上几百遍。
 */
export function textOf(msg, upTo = 0) {
  if (!on() || !msg || msg.role !== 'user') return '';
  return (msg.readAt || msg.createdAt <= upTo) ? '已读' : '未读';
}
