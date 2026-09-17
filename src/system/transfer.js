import { messages, chats, characters } from './db/index.js';
import * as accounts from './accounts.js';

// 转账。两边都能发，收到的一方可以收下，也可以退回。
//
// 状态只有三个，存在消息自己身上：
//   pending  发出去了，对方还没处理
//   taken    对方收下了
//   returned 对方退回了
//
// 「谁处理」跟「谁发的」永远相反 —— 自己发的自己不能收，所以界面上
// 只有对方发来的那一张点得动。
export const PENDING = 'pending';
export const TAKEN = 'taken';
export const RETURNED = 'returned';

export const MAX = 1000000;

// 金额一律两位小数。输入框里随便写，落库前在这儿收口，
// 免得 0.1 + 0.2 那种东西跑到界面上。
export function money(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(v) ? v : 0;
}
export function format(n) { return money(n).toFixed(2); }

export function stateLabel(state) {
  return state === TAKEN ? '已收款' : state === RETURNED ? '已退回' : '待收款';
}

// 上下文里的写法。模型读到的和它自己该写的是同一套格式。
function contentOf(amount, note, state) {
  const head = `[转账：${format(amount)}${note ? ' ' + note : ''}]`;
  return state === TAKEN ? `${head}（已被收下）`
    : state === RETURNED ? `${head}（已被退回）` : head;
}

// 提示行里要写清楚谁收了谁的，所以两边的名字都得拿准。
// 不能拿消息自己的 authorId 去查角色 —— 用户那条转账的 authorId 是 'me'，
// 查出来永远是空的。角色一律从会话上取，用户一律从会话绑的那个身份上取。
export function namesOf(chat) {
  const persona = (chat && accounts.get(chat.personaId)) || accounts.current();
  const char = characters.get((chat?.characterIds || [])[0]);
  return { me: persona?.name || '我', char: char?.name || '角色' };
}

// 发一笔。role 决定是谁发的，其余字段（引用、turnId）由调用方带进来。
export function send({ chatId, role, authorId, amount, note = '', extra = {} }) {
  const v = money(amount);
  if (!(v > 0)) throw new Error('金额需大于 0');
  if (v > MAX) throw new Error(`金额不能超过 ${format(MAX)}`);
  const text = String(note || '').trim().slice(0, 40);
  const msg = messages.create({
    chatId, role, authorId, kind: 'transfer',
    amount: v, note: text, transfer: PENDING,
    content: contentOf(v, text, PENDING),
    status: 'done', ...extra,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

// 这段对话里，某一方发出的、还没处理的最近一笔。
// 角色写 [收款] 时要找的就是它。
export function pendingFrom(chatId, role) {
  const list = messages.byIndex(chatId)
    .filter(m => m.kind === 'transfer' && m.role === role && m.transfer === PENDING)
    .sort((a, b) => a.createdAt - b.createdAt);
  return list[list.length - 1] || null;
}

/**
 * 收下或退回。除了改那条转账的状态，还落一行提示 —— 转账那条可能早翻上去了，
 * 状态在原地变一下没人看得见；而且上下文里也得有这么一句，
 * 否则对面只能从括号里那三个字推断刚刚发生了什么。
 *
 * extra 用来带 turnId：角色是在自己那一轮里处理的，重新生成时这一行要跟着撤掉。
 */
export function settle(msgId, take, extra = {}) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'transfer' || m.transfer !== PENDING) return null;

  const state = take ? TAKEN : RETURNED;
  messages.update(msgId, { transfer: state, content: contentOf(m.amount, m.note, state) });

  // 处理的人是收到的那一方，和发的人相反
  const chat = chats.get(m.chatId);
  const { me, char } = namesOf(chat);
  const charId = (chat?.characterIds || [])[0] || m.authorId;
  const byUser = m.role !== 'user';
  const who = byUser ? me : char;
  const from = byUser ? char : me;
  const notice = messages.create({
    chatId: m.chatId,
    role: byUser ? 'user' : 'char',
    authorId: byUser ? 'me' : charId,
    kind: 'notice', settledId: msgId,
    content: `[${who}${take ? '收下了' : '退回了'}${from}的转账 ${format(m.amount)}]`,
    status: 'done', ...extra,
  });
  chats.update(m.chatId, { lastMessageAt: Date.now() });
  return notice;
}

// 提示行被删掉就当这次处理没发生过 —— 那一行本来就是这件事的记录。
// 重新生成角色那一轮时整轮会被清掉，转账也就回到待处理，可以重新来一次。
export function unsettle(noticeId) {
  const n = messages.get(noticeId);
  if (!n || n.kind !== 'notice' || !n.settledId) return false;
  const m = messages.get(n.settledId);
  if (!m || m.kind !== 'transfer') return false;
  messages.update(m.id, { transfer: PENDING, content: contentOf(m.amount, m.note, PENDING) });
  return true;
}
