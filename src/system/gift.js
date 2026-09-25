import { messages, chats, characters, settings } from './db/index.js';
import * as accounts from './accounts.js';
import { keepGift, dropAutoGift } from './closet.js';

// 礼物。
//
// 和转账最大的不同是**拆之前不知道里面是什么**：封面写「限量款球鞋」，
// 拆开是一张纸条，这个反差就是礼物好玩的地方。所以这里有一条硬规矩：
//
//   **没拆开之前，里面装什么一个字都不进上下文。**
//
// 不是藏在界面里而已 —— 落进消息正文的那段字里根本没有它。模型读到的是
// `[礼物：限量款球鞋（未拆封）]`，它想猜也没得猜。拆开那一刻才改写正文，
// 把里面的东西补进去。
//
// 这条可以关（设置里的「拆开前保密」）。关掉之后收到礼物的同时就知道里面是
// 什么，反应更连贯，但也就没有惊喜了。
export const PENDING = 'pending';
export const OPENED = 'opened';
export const DECLINED = 'declined';

export function blind() { return settings.get().giftBlind !== false; }

export function stateLabel(state) {
  return state === OPENED ? '已拆开' : state === DECLINED ? '已拒收' : '待拆开';
}

// 正文。拆开前后是两段不同的话，这就是整件事的关键。
function contentOf({ cover, inner, state, hide }) {
  const same = !inner || inner === cover;
  if (state === OPENED) {
    return same ? `[礼物：${cover}]` : `[礼物：${cover}，拆开是 ${inner}]`;
  }
  if (state === DECLINED) return `[礼物：${cover}（已拒收）]`;
  // 待拆。hide 为假时把里面写出来 —— 那是用户自己关掉保密的结果
  if (hide || same) return `[礼物：${cover}（未拆封）]`;
  return `[礼物：${cover}（未拆封，里面是 ${inner}）]`;
}

// 模型写的那一行拆成两段：竖线前是封面，后面是里面。没竖线就是表里如一。
export function parse(body) {
  const t = String(body || '').trim();
  if (!t) return null;
  const i = t.search(/[|｜]/);
  if (i < 0) return { cover: t.slice(0, 40), inner: '' };
  return {
    cover: t.slice(0, i).trim().slice(0, 40),
    inner: t.slice(i + 1).trim().slice(0, 60),
  };
}

export function send({ chatId, role, authorId, cover, inner = '', extra = {} }) {
  const c = String(cover || '').trim().slice(0, 40);
  if (!c) throw new Error('请填写礼物名称');
  const n = String(inner || '').trim().slice(0, 60);
  // 两个方向都瞒。角色送的那件它自己写的时候当然知道里面是什么，
  // 但正文是会被**搜索**读到的（搜索结果显示的就是 content）——
  // 只要它在正文里，用户搜一下就提前看见了。一条规矩管两头最省心：
  // **没拆开，正文里就没有里面是什么。**
  const hide = blind();
  const msg = messages.create({
    chatId, role, authorId, kind: 'gift',
    cover: c, inner: n, gift: PENDING,
    content: contentOf({ cover: c, inner: n, state: PENDING, hide }),
    status: 'done', ...extra,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

// 这段对话里，某一方送出的、还没拆的最近一件
export function pendingFrom(chatId, role) {
  const list = messages.byIndex(chatId)
    .filter(m => m.kind === 'gift' && m.role === role && m.gift === PENDING)
    .sort((a, b) => a.createdAt - b.createdAt);
  return list[list.length - 1] || null;
}

function namesOf(chat) {
  const persona = (chat && accounts.get(chat.personaId)) || accounts.current();
  const char = characters.get((chat?.characterIds || [])[0]);
  return { me: persona?.name || '我', char: char?.name || '角色' };
}

/**
 * 拆开或拒收。和转账的 settle 同构：改状态 + 落一行提示。
 *
 * 拆开时**改写正文**，这时候里面装的东西才第一次出现在上下文里。
 */
export function settle(msgId, open, extra = {}) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'gift' || m.gift !== PENDING) return null;

  const state = open ? OPENED : DECLINED;
  messages.update(msgId, {
    gift: state,
    content: contentOf({ cover: m.cover, inner: m.inner, state, hide: false }),
  });

  const chat = chats.get(m.chatId);
  const { me, char } = namesOf(chat);
  const charId = (chat?.characterIds || [])[0] || m.authorId;
  const byUser = m.role !== 'user';
  const who = byUser ? me : char;
  const what = open && m.inner && m.inner !== m.cover
    ? `拆开了${byUser ? char : me}送的「${m.cover}」，里面是${m.inner}`
    : open ? `拆开了${byUser ? char : me}送的「${m.cover}」`
      : `拒收了${byUser ? char : me}送的「${m.cover}」`;

  const notice = messages.create({
    chatId: m.chatId,
    role: byUser ? 'user' : 'char',
    authorId: byUser ? 'me' : charId,
    kind: 'notice', settledId: msgId, settledKind: 'gift',
    content: `[${who}${what}]`,
    status: 'done', ...extra,
  });
  chats.update(m.chatId, { lastMessageAt: Date.now() });
  // 我送的，角色拆开了：是衣帽间里的东西就直接收进它的衣帽间（system/closet.js 的 keepGift）
  if (open && m.role === 'user') keepGift(messages.get(msgId));
  return notice;
}

// 提示行被删掉就当没拆过。整轮重新生成时走的也是这里。
export function unsettle(noticeId) {
  const n = messages.get(noticeId);
  if (!n || n.kind !== 'notice' || !n.settledId) return false;
  const m = messages.get(n.settledId);
  if (!m || m.kind !== 'gift') return false;
  messages.update(m.id, {
    gift: PENDING,
    content: contentOf({ cover: m.cover, inner: m.inner, state: PENDING, hide: blind() }),
  });
  dropAutoGift(m.id);
  return true;
}
