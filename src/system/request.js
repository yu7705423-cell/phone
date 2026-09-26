import { messages, chats, characters } from './db/index.js';
import * as accounts from './accounts.js';
import * as currency from './currency.js';
// 和 ledger 互相引用：ledger 读这里的常量，这里批准之后要往账本上建账户。
// 两边都只在函数里用对方，模块求值时谁先谁后都行
import * as L from './ledger.js';

// 申请。
//
// 三件事共用这一套：开设情侣账户、动用情侣账户的钱、发亲属卡。
// 它们是同一个形状 —— **A 提出，B 通过或驳回**。
// 第四件「存入情侣账户」也走这张消息，只是发出即落定（4.278）：往两个人的账户里放钱，不必对方点头。
//
// 这个形状在本仓库已经是第四次出现（转账、礼物、外卖，见 takeout.js 顶上
// 那句「和转账完全同构」）。所以照抄，不发明新的：一条消息带着状态，
// 收到的那一方表态，表完态落一行提示，提示行被删就当没表过态。
//
// **钱怎么动不在这里。** 这里只负责「这件事批没批」，批过之后钱怎么算，
// 由 ledger 去读这条消息的状态现折（见 ledger.moveOf）。
// 两边各记一份的话，重新生成那一轮时就要有人负责把流水也撤掉。

export const PENDING = 'pending';
export const APPROVED = 'approved';
export const REJECTED = 'rejected';

// 开设情侣账户 / 动用情侣账户 / 发一张亲属卡 / 存入情侣账户
export const JOINT = 'joint';
export const SPEND = 'spend';
export const CARD = 'card';
export const DEPOSIT = 'deposit';
export const KINDS = [JOINT, SPEND, CARD, DEPOSIT];

export const money = currency.round;
export const format = currency.format;
export const display = currency.display;

export function stateLabel(state, kind = '') {
  if (kind === DEPOSIT) return '已存入';
  return state === APPROVED ? '已通过' : state === REJECTED ? '已驳回' : '待处理';
}

// 上下文里的写法。模型读到的和它自己该写的是同一套格式。
function contentOf({ kind, amount, note, state, code }) {
  const v = amount ? format(amount, code) : '';
  const head = kind === JOINT ? '[开设情侣账户]'
    : kind === CARD ? `[亲属卡：额度 ${v}]`
    : kind === DEPOSIT ? `[存入情侣账户：${v}]`
    : `[申请：${note || '动用情侣账户'} ${v}]`;
  if (kind === DEPOSIT) return head;
  return state === APPROVED ? `${head}（已通过）`
    : state === REJECTED ? `${head}（已驳回）` : head;
}

export function namesOf(chat) {
  const persona = (chat && accounts.get(chat.personaId)) || accounts.current();
  const char = characters.get((chat?.characterIds || [])[0]);
  return { me: persona?.name || '我', char: char?.name || '角色' };
}

/** 发一条申请。role 决定是谁提的。 */
export function send({ chatId, role, authorId, kind = SPEND, amount = 0, note = '', extra = {} }) {
  if (!KINDS.includes(kind)) throw new Error('不认识这种申请');
  const code = currency.current().code;
  const v = money(amount, code);
  if (kind !== JOINT && !(v > 0)) throw new Error('金额需大于 0');
  const text = String(note || '').trim().slice(0, 40);
  // 存入不用等对方点头：发出即落定。钱怎么动由 ledger.moveOf 现折
  const state = kind === DEPOSIT ? APPROVED : PENDING;
  const msg = messages.create({
    chatId, role, authorId, kind: 'request',
    requestKind: kind, amount: v, note: text,
    request: state, currency: code,
    content: contentOf({ kind, amount: v, note: text, state, code }),
    status: 'done', ...extra,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

/** 这段对话里，某一方提的、还没处理的最近一条。角色写 [批准] 时找的就是它。 */
export function pendingFrom(chatId, role) {
  const list = messages.byIndex(chatId)
    .filter(m => m.kind === 'request' && m.role === role && m.request === PENDING)
    .sort((a, b) => a.createdAt - b.createdAt);
  return list[list.length - 1] || null;
}

/**
 * 批准或驳回。和转账的 settle 同构：改状态、改正文、再落一行提示 ——
 * 那一行才是这件事发生过的凭据，而且上下文里也得有这么一句。
 *
 * 开通共同账户批准之后要真的建出那个账户来。账户是结构不是钱，
 * 所以它存着，不随消息撤销 —— 撤掉一条消息不该把一个账户连同它的
 * 余额一起抹掉。钱那一侧照旧由 ledger 现折。
 */
export function settle(msgId, ok, extra = {}) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'request' || m.request !== PENDING) return null;

  const state = ok ? APPROVED : REJECTED;
  messages.update(msgId, {
    request: state,
    content: contentOf({ kind: m.requestKind, amount: m.amount, note: m.note, state, code: m.currency }),
  });

  const chat = chats.get(m.chatId);
  const { me, char } = namesOf(chat);
  const charId = (chat?.characterIds || [])[0] || m.authorId;
  const byUser = m.role !== 'user';
  const who = byUser ? me : char;
  const from = byUser ? char : me;

  if (ok) apply(m, byUser);

  const what = m.requestKind === JOINT ? '开设情侣账户的申请'
    : m.requestKind === CARD ? `开出的亲属卡（额度 ${format(m.amount, m.currency)}）`
    : `动用情侣账户 ${format(m.amount, m.currency)} 的申请`;
  const notice = messages.create({
    chatId: m.chatId,
    role: byUser ? 'user' : 'char',
    authorId: byUser ? 'me' : charId,
    kind: 'notice', settledId: msgId, settledKind: 'request',
    content: `[${who}${ok ? '通过了' : '驳回了'}${from}${what}]`,
    status: 'done', ...extra,
  });
  chats.update(m.chatId, { lastMessageAt: Date.now() });
  return notice;
}

// 批准之后要落在账本上的那部分结构。金额不在这里动。
// **同步落**：从前是 import() 之后再落，批准那一轮画完账户还没建出来，紧接着的存入就无处可去
function apply(m, byUser) {
  const owner = m.role === 'user' ? 'me' : 'char';
  try {
    const book = L.bookOfChat(m.chatId);
    if (!book) return byUser;
    if (m.requestKind === JOINT) L.ensureJoint(book.id);
    if (m.requestKind === CARD) {
      // 发卡的是提出的那一方，收卡的是表态的那一方
      L.addCard(book.id, { from: owner, to: owner === 'me' ? 'char' : 'me', limit: m.amount });
    }
  } catch (err) { console.warn('[request] 落到账本上失败:', err.message || err); }
  return byUser;
}

/** 提示行被删就当没表过态。重新生成角色那一轮时整轮清掉，走的也是这里。 */
export function unsettle(noticeId) {
  const n = messages.get(noticeId);
  if (!n || n.kind !== 'notice' || !n.settledId) return false;
  const m = messages.get(n.settledId);
  if (!m || m.kind !== 'request') return false;
  messages.update(m.id, {
    request: PENDING,
    content: contentOf({ kind: m.requestKind, amount: m.amount, note: m.note, state: PENDING, code: m.currency }),
  });
  return true;
}
