import { chats, characters, messages, messagesOf, spaceItems } from './db/index.js';
import * as accounts from './accounts.js';
import * as clock from './time.js';

// 情侣空间。
//
// **一段单人会话就是一个空间。** 关系本来就长在会话上，人设不同会话也不同，
// 所以「每个人设各有一个空间」是白来的，不必再拿 人设 × 角色 拼一张表。
//
// 空间里的大部分内容**不另存一份**：礼物墙就是这段会话里 kind 为 gift 的消息，
// 去过的地方是 location，一起听是 listen，通话是 call，约定是 pact，
// 寄出的信是 letter。这样做的好处是它们天生就在上下文里、天生跟着会话一起
// 删除、也天生不会和聊天记录对不上。
//
// 真正需要自己存的只有两样，存在 spaceItems 里：
//   **纪念日** 会话里没有对应的消息，它就是一条纯粹的设定；
//   **还没寄出的信** 寄出之后它就变成一条消息了，在那之前只有自己看得见。

export const DAY = 'day';
export const DRAFT = 'draft';

export const PACT_OPEN = 'open';
export const PACT_DONE = 'done';

const DAY_MS = 86400000;
const trim = (v, n) => String(v || '').trim().slice(0, n);

// ---- 空间本身 ----

// 单人会话才算一段关系。群聊里没有「我们俩」这回事。
const isPair = c => (c.characterIds || []).length === 1;

export function spacesOf(personaId = accounts.currentId()) {
  return chats.all()
    .filter(c => isPair(c) && (c.personaId || personaId) === personaId)
    .map(c => ({ chat: c, char: characters.get(c.characterIds[0]) }))
    .filter(x => !!x.char)
    .sort((a, b) => (b.chat.lastMessageAt || 0) - (a.chat.lastMessageAt || 0));
}

export function spaceOf(chatId) {
  const chat = chats.get(chatId);
  if (!chat || !isPair(chat)) return null;
  const char = characters.get(chat.characterIds[0]);
  if (!char) return null;
  return { chat, char, persona: accounts.get(chat.personaId) || accounts.current() };
}

// 在一起多少天。没设起始日就是 null —— 不要拿会话创建时间顶替，
// 那是「什么时候装的这个 app」，不是「什么时候在一起的」。
export function togetherDays(chat) {
  if (!chat || !chat.loveStartAt) return null;
  const from = new Date(chat.loveStartAt);
  from.setHours(0, 0, 0, 0);
  const today = new Date(clock.now());
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - from) / DAY_MS)) + 1;
}

export function setStart(chatId, ts) {
  chats.update(chatId, { loveStartAt: ts || 0 });
}

// 上下文里要不要提这些。默认关 —— 它每轮都占一段，得用户自己点开。
export function injectOn(chat) { return !!(chat && chat.spaceInject); }
export function setInject(chatId, on) { chats.update(chatId, { spaceInject: !!on }); }

// ---- 记录：会话里那几种消息的视图 ----

const KINDS = ['gift', 'location', 'listen', 'call', 'pact', 'letter'];

export function recordsOf(chatId, kind) {
  if (!KINDS.includes(kind)) return [];
  return messagesOf(chatId).filter(m => m.kind === kind);
}

export function stats(chatId) {
  const list = messagesOf(chatId);
  const chat = chats.get(chatId);
  // 一趟扫完。空间列表每行都要算一次，聊了几万条的会话五趟 reduce 就是几万×五
  const n = { gift: 0, location: 0, call: 0, letter: 0, open: 0, done: 0 };
  for (const m of list) {
    if (m.kind === 'pact') { if (m.pact === PACT_OPEN) n.open++; else if (m.pact === PACT_DONE) n.done++; }
    else if (m.kind in n) n[m.kind]++;
  }
  return {
    days: togetherDays(chat),
    gifts: n.gift, places: n.location, calls: n.call, letters: n.letter,
    // 一起听的累积数落在会话上，一场一场结算时累加，不因为结束而清零
    listenSeconds: chat?.listenSeconds || 0,
    listenCount: chat?.listenCount || 0,
    pactsOpen: n.open, pactsDone: n.done,
    drafts: items(chatId, DRAFT).length,
  };
}

// ---- 纪念日 ----

function items(chatId, type) {
  return spaceItems.byIndex(chatId)
    .filter(x => x.type === type)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function days(chatId) { return items(chatId, DAY); }

export function addDay({ chatId, title, date, yearly = true }) {
  const t = trim(title, 20);
  if (!t) throw new Error('请填写纪念日名称');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('请选择日期');
  return spaceItems.create({ chatId, type: DAY, title: t, date, yearly: !!yearly });
}

export function updateDay(id, patch) {
  const row = spaceItems.get(id);
  if (!row || row.type !== DAY) return null;
  const next = {};
  if (patch.title !== undefined) next.title = trim(patch.title, 20);
  if (patch.date !== undefined) next.date = patch.date;
  if (patch.yearly !== undefined) next.yearly = !!patch.yearly;
  return spaceItems.update(id, next);
}

export function removeDay(id) { return spaceItems.remove(id); }

// 这个纪念日下一次是什么时候。每年一次的就滚到今年或明年，
// 只过一次的过了就是过了，返回的 left 会是负数，界面自己决定还显不显示。
export function nextAt(item, from = clock.now()) {
  const [y, m, d] = String(item.date || '').split('-').map(Number);
  if (!y || !m || !d) return 0;
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  if (!item.yearly) return new Date(y, m - 1, d).getTime();
  let at = new Date(today.getFullYear(), m - 1, d);
  if (at < today) at = new Date(today.getFullYear() + 1, m - 1, d);
  return at.getTime();
}

export function leftDays(item, from = clock.now()) {
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  return Math.round((nextAt(item, from) - today.getTime()) / DAY_MS);
}

// 按「还有几天」排好。已经过去的只出现在不重复的那一档里，排在最后。
export function upcoming(chatId, limit = 0) {
  const list = days(chatId)
    .map(it => ({ item: it, at: nextAt(it), left: leftDays(it) }))
    .sort((a, b) => (a.left < 0) - (b.left < 0) || a.left - b.left);
  return limit > 0 ? list.slice(0, limit) : list;
}

// ---- 约定 ----

const pactContent = (title, done) => `[约定：${title}]${done ? '（已完成）' : ''}`;

export function pacts(chatId) { return recordsOf(chatId, 'pact'); }

export function makePact({ chatId, role, authorId, title, extra = {} }) {
  const t = trim(title, 40);
  if (!t) throw new Error('请填写约定内容');
  const msg = messages.create({
    chatId, role, authorId, kind: 'pact',
    pact: PACT_OPEN, title: t,
    content: pactContent(t, false),
    status: 'done', ...extra,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

// 模型写「约定完成」时给的是一小段原话，拿它回头去认领。
// 认不出来就不动 —— 凭空标完一条别的约定比不标更糟。
export function findOpenPact(chatId, title) {
  const q = trim(title, 40).replace(/\s+/g, '');
  const open = pacts(chatId).filter(m => m.pact === PACT_OPEN);
  if (!open.length) return null;
  if (!q) return open[open.length - 1];
  for (let i = open.length - 1; i >= 0; i--) {
    const t = String(open[i].title || '').replace(/\s+/g, '');
    if (t && (t.includes(q) || q.includes(t))) return open[i];
  }
  return null;
}

export function completePact(id, extra = {}) {
  const m = messages.get(id);
  if (!m || m.kind !== 'pact' || m.pact === PACT_DONE) return null;
  messages.update(id, {
    pact: PACT_DONE, doneAt: Date.now(),
    content: pactContent(m.title, true),
  });
  const chat = chats.get(m.chatId);
  const notice = messages.create({
    chatId: m.chatId, role: 'user', authorId: 'me', kind: 'notice',
    settledId: id, settledKind: 'pact',
    content: `[约定已完成：${m.title}]`,
    status: 'done', ...extra,
  });
  if (chat) chats.update(chat.id, { lastMessageAt: Date.now() });
  return notice;
}

// 那一行「约定已完成」被删掉，这条约定就回到未完成。
// 和转账、礼物同构：提示行本身就是这件事发生过的唯一凭据。
export function unsettlePact(noticeId) {
  const n = messages.get(noticeId);
  const m = n && messages.get(n.settledId);
  if (!m || m.kind !== 'pact') return false;
  messages.update(m.id, { pact: PACT_OPEN, doneAt: 0, content: pactContent(m.title, false) });
  return true;
}

export function removePact(id) { return messages.remove(id); }

// ---- 信 ----

export function letters(chatId) { return recordsOf(chatId, 'letter'); }
export function drafts(chatId) { return items(chatId, DRAFT); }

export function saveDraft({ chatId, id, title, body, sendAt = 0 }) {
  const t = trim(title, 30);
  const b = trim(body, 2000);
  if (!b) throw new Error('请填写信的内容');
  // sendAt 是定时投递的时刻。0 表示不定时，一直留在信箱里等你自己寄。
  const at = Math.max(0, Number(sendAt) || 0);
  if (id) return spaceItems.update(id, { title: t, body: b, sendAt: at });
  return spaceItems.create({ chatId, type: DRAFT, title: t, body: b, sendAt: at });
}

/**
 * 到点该寄出去的那几封。
 *
 * 页面关着的时候没有定时器，所以不靠定时器 —— 到点的时刻记在信上，
 * 开着的时候由全局那个 tick 扫一遍，关着再打开也补得上。
 * 投递时间用的是**当初定的那个时刻**，不是发现它的时刻。
 */
export function deliverDue(now = Date.now()) {
  const out = [];
  for (const row of spaceItems.all()) {
    if (row.type !== DRAFT || !row.sendAt || row.sendAt > now) continue;
    if (!chats.get(row.chatId)) { spaceItems.remove(row.id); continue; }
    const msg = sendLetter({
      chatId: row.chatId, role: 'user', authorId: 'me',
      title: row.title, body: row.body,
      extra: { createdAt: row.sendAt },
    });
    spaceItems.remove(row.id);
    out.push(msg);
  }
  return out;
}

export function removeDraft(id) { return spaceItems.remove(id); }

export function sendLetter({ chatId, role, authorId, title, body, extra = {} }) {
  const t = trim(title, 30);
  const b = trim(body, 2000);
  if (!b) throw new Error('请填写信的内容');
  const msg = messages.create({
    chatId, role, authorId, kind: 'letter',
    title: t, body: b,
    content: `[信${t ? '：' + t : ''}]\n${b}`,
    status: 'done', ...extra,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

// 把一封留在信箱里的信寄出去。寄出之前它不进上下文，对方不知道有这么一封。
export function sendDraft(id) {
  const row = spaceItems.get(id);
  if (!row || row.type !== DRAFT) return null;
  const msg = sendLetter({
    chatId: row.chatId, role: 'user', authorId: 'me',
    title: row.title, body: row.body,
  });
  spaceItems.remove(id);
  return msg;
}

// 会话删了，空间里自己存的那两样也要跟着走 —— 别的都是消息，
// 会话一删本来就没了。三个删会话的入口各调一次，见调用方。
export function dropSpace(chatId) {
  spaceItems.byIndex(chatId).forEach(x => spaceItems.remove(x.id));
}

// ---- 给上下文用的摘要 ----
//
// 只给数字和标题，不给正文。信的正文本来就是一条消息，历史里有；
// 礼物、地点、歌单同理。这里要回答的只有「我们之间有哪些还没了结的事」。
export function summary(chatId) {
  const sp = spaceOf(chatId);
  if (!sp || !injectOn(sp.chat)) return null;
  const st = stats(chatId);
  const soon = upcoming(chatId).filter(x => x.left >= 0 && x.left <= 30);
  const open = pacts(chatId).filter(m => m.pact === PACT_OPEN).map(m => m.title);
  return { days: st.days, soon, open, gifts: st.gifts, places: st.places,
    listenSeconds: st.listenSeconds, listenCount: st.listenCount, calls: st.calls };
}
