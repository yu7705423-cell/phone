import { messages, chats, characters } from './db/index.js';
import * as accounts from './accounts.js';
import * as currency from './currency.js';

// 点外卖。
//
// 和转账完全同构（见 4.675）：一条消息带着状态，收到的那一方表态，
// 表完态落一行提示，提示行被删就当没表过态。不同的只有一件事 ——
// **点外卖有两个方向，谁吃和谁付**：
//
//   自己点   给自己点，自己付。对方不必做什么，就是一条「我在吃什么」。
//   请客     给对方点，自己付。对方可以收下，也可以不要。
//   代付     给自己点，让对方付。对方可以付，也可以不付。
//
// 「给对方点还让对方付」没有意义 —— 那不叫点外卖，那叫叫他自己点，
// 所以这一档不存在。

export const SELF = 'self';    // 自己点自己吃自己付
export const TREAT = 'treat';  // 请客：给对方点，自己付
export const ASK = 'ask';      // 代付：自己吃，让对方付
export const KINDS = [SELF, TREAT, ASK];

export const PENDING = 'pending';
export const TAKEN = 'taken';
export const DECLINED = 'declined';

export const money = currency.round;
export const format = currency.format;

export function stateLabel(k, state) {
  if (k === SELF) return '';
  if (state === TAKEN) return k === TREAT ? '已收下' : '已付款';
  if (state === DECLINED) return k === TREAT ? '已谢绝' : '未代付';
  return k === TREAT ? '待收下' : '待代付';
}

// 上下文里的写法。模型读到的和它自己该写的是同一套格式。
function contentOf({ kind, item, amount, state, code }) {
  const money$ = format(amount, code);
  const head = kind === TREAT ? `[请客：${item} ${money$}]`
    : kind === ASK ? `[代付：${item} ${money$}]`
    : `[外卖：${item} ${money$}]`;
  if (kind === SELF || state === PENDING) return head;
  if (state === TAKEN) return `${head}（${kind === TREAT ? '已被收下' : '对方付了'}）`;
  return `${head}（${kind === TREAT ? '被谢绝了' : '对方没付'}）`;
}

// 模型写的那一行拆成两段：最后一个数是金额，前面全是吃的。
// 反过来按第一个空格切会切坏「香辣鸡腿堡 套餐 32」这种写法。
const TAIL = /^(.*?)[\s　]*(?:[¥￥$]\s*)?(\d+(?:\.\d{1,2})?)\s*(?:元|块)?$/;
export function parse(body) {
  const t = String(body || '').trim();
  if (!t) return null;
  const m = t.match(TAIL);
  if (!m) return { item: t.slice(0, 40), amount: 0 };
  return { item: m[1].trim().slice(0, 40), amount: Number(m[2]) };
}

export function namesOf(chat) {
  const persona = (chat && accounts.get(chat.personaId)) || accounts.current();
  const char = characters.get((chat?.characterIds || [])[0]);
  return { me: persona?.name || '我', char: char?.name || '角色' };
}

/**
 * 点一单。role 是谁点的，kind 是上面那三档。
 * 只有请客和代付需要对方表态，自己点自己吃的那一档一落库就完了。
 */
export function order({ chatId, role, authorId, kind = SELF, item, amount = 0, extra = {} }) {
  const it = String(item || '').trim().slice(0, 40);
  if (!it) throw new Error('请填写要点的东西');
  if (!KINDS.includes(kind)) throw new Error('不认识这种点法');
  const v = money(amount);
  if (v < 0) throw new Error('金额不能是负数');
  const code = currency.current().code;

  const msg = messages.create({
    chatId, role, authorId, kind: 'takeout',
    takeoutKind: kind, item: it, amount: v, currency: code,
    takeout: kind === SELF ? TAKEN : PENDING,
    content: contentOf({ kind, item: it, amount: v, state: PENDING, code }),
    status: 'done', ...extra,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

/** 这段对话里，某一方点的、还等着对方表态的最近一单。 */
export function pendingFrom(chatId, role) {
  const list = messages.byIndex(chatId)
    .filter(m => m.kind === 'takeout' && m.role === role && m.takeout === PENDING)
    .sort((a, b) => a.createdAt - b.createdAt);
  return list[list.length - 1] || null;
}

/**
 * 收下 / 付款，或者不要 / 不付。和转账的 settle 同构：
 * 改状态、改正文、再落一行提示 —— 那一行才是这件事发生过的凭据。
 */
export function settle(msgId, take, extra = {}) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'takeout' || m.takeout !== PENDING) return null;

  const state = take ? TAKEN : DECLINED;
  messages.update(msgId, {
    takeout: state,
    content: contentOf({ kind: m.takeoutKind, item: m.item, amount: m.amount, state, code: m.currency }),
  });

  const chat = chats.get(m.chatId);
  const { me, char } = namesOf(chat);
  const charId = (chat?.characterIds || [])[0] || m.authorId;
  const byUser = m.role !== 'user';          // 表态的人和点单的人相反
  const who = byUser ? me : char;
  const from = byUser ? char : me;
  const what = `${m.item} ${format(m.amount, m.currency)}`;
  const line = m.takeoutKind === TREAT
    ? `${who}${take ? '收下了' : '谢绝了'}${from}点的${what}`
    : `${who}${take ? '替' : '没有替'}${from}付了${what}`;

  const notice = messages.create({
    chatId: m.chatId,
    role: byUser ? 'user' : 'char',
    authorId: byUser ? 'me' : charId,
    kind: 'notice', settledId: msgId, settledKind: 'takeout',
    content: `[${line}]`, status: 'done', ...extra,
  });
  chats.update(m.chatId, { lastMessageAt: Date.now() });
  return notice;
}

// 提示行被删掉就当这次表态没发生过。和转账、礼物、约定同一条规矩。
export function unsettle(noticeId) {
  const n = messages.get(noticeId);
  const m = n && messages.get(n.settledId);
  if (!m || m.kind !== 'takeout') return false;
  messages.update(m.id, {
    takeout: PENDING,
    content: contentOf({ kind: m.takeoutKind, item: m.item, amount: m.amount, state: PENDING, code: m.currency }),
  });
  return true;
}
