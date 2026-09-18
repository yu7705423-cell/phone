import { books, entries, chats, characters, settings, messagesOf, messages } from './db/index.js';
import * as accounts from './accounts.js';
import * as currency from './currency.js';
import * as transferSvc from './transfer.js';
import * as takeoutSvc from './takeout.js';

// 记账。
//
// 三层，中间那层是地基：
//   **账户** 谁有多少钱。我的、角色的、共同的、私密卡，都只是 owner 不同的账户。
//   **流水** 钱怎么动的。每一笔一条。
//   **动作** 谁能让钱动 —— 手记、固定入账、亲属卡、申请、聊天里提取。
//           这一层全部只做一件事：生成流水。
//
// **余额不入库，永远是流水折出来的。**
//
// 不是洁癖。角色那一轮是可以重新生成的，重生成会把整轮消息清掉。余额要是存着
// 的一个数字，那轮里「转了 200」被撤掉之后，这 200 就永远留在余额里了 ——
// 而且没有任何人会发现，账目错了不报错，只会越滚越歪。余额是算出来的，
// 消息没了那笔流水就不存在，余额自己就对了。
//
// **两种账本功能完全一样。** 差别只在 user 那一侧记的是不是真事：真实账本里
// 角色照样有钱，那部分本来就是设定出来的。所以这里不为 kind 分叉，
// 它只是一个标签。
//
// **聊天里提取出来的一律先挂着（pending），你点一下才进余额。** 模型认错金额、
// 把玩笑当真账，都不该直接污染账本。见 balanceOf 里那一句过滤。

export const REAL = 'real';
export const PLAY = 'play';
export const KINDS = [REAL, PLAY];

// 账户归谁。共同账户动钱要对方同意，私密卡要猜密码 —— 那两件在后面的批次里做，
// 这里先把归属定下来，不然后面要迁数据。
export const ME = 'me';
export const CHAR = 'char';
export const JOINT = 'joint';
export const OWNERS = [ME, CHAR, JOINT];

export const CATEGORIES = [
  { id: 'food', label: '餐饮' },
  { id: 'transit', label: '交通' },
  { id: 'shopping', label: '购物' },
  { id: 'home', label: '居住' },
  { id: 'fun', label: '娱乐' },
  { id: 'health', label: '医疗' },
  { id: 'social', label: '人情' },
  { id: 'salary', label: '收入' },
  { id: 'transfer', label: '转账' },
  { id: 'other', label: '其他' },
];
export const categoryOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

const trim = (v, n) => String(v ?? '').trim().slice(0, n);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ---- 账本 ----

export const all = () => books.all().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
export const get = id => books.get(id);

export function create({ name, kind = PLAY, chatId = '', currency: code } = {}) {
  const row = books.create({
    name: trim(name, 20) || (kind === REAL ? '我的账本' : '未命名账本'),
    kind: KINDS.includes(kind) ? kind : PLAY,
    chatId: chatId || '',
    currency: code || currency.current().code,
    accounts: [],
    createdAt: Date.now(),
  });
  // 一本新账至少要有一个账户，否则第一笔记不下去
  addAccount(row.id, { name: '现金', owner: ME });
  return get(row.id);
}

export function update(id, patch) {
  const next = {};
  if (patch.name !== undefined) next.name = trim(patch.name, 20);
  if (patch.kind !== undefined && KINDS.includes(patch.kind)) next.kind = patch.kind;
  if (patch.chatId !== undefined) next.chatId = patch.chatId || '';
  if (patch.currency !== undefined) next.currency = patch.currency;
  if (patch.inject !== undefined) next.inject = !!patch.inject;
  if (patch.strict !== undefined) next.strict = !!patch.strict;
  return books.update(id, next);
}

/** 删账本连同它的流水。流水留着没有意义，而且会一直算进「全部账本」的统计。 */
export function remove(id) {
  entries.byIndex(id).forEach(e => entries.remove(e.id));
  if (currentId() === id) settings.set({ billBook: '' });
  return books.remove(id);
}

// 当前看的是哪一本。记在设置里 —— 关掉 app 再回来还是那一本。
export function currentId() {
  const id = settings.get().billBook;
  return id && books.has(id) ? id : (all()[0]?.id || '');
}
export const current = () => get(currentId());
export const setCurrent = id => settings.set({ billBook: books.has(id) ? id : '' });

/** 至少有一本。第一次打开 app 时建，不走迁移 —— 不用记账的人不该凭空多一本。 */
export function ensure() {
  if (all().length) return current();
  return create({ name: '我的账本', kind: REAL });
}

// ---- 账户。内嵌在账本里：一本账上就三五个，单开一张表不值当 ----

export const accountsOf = id => (get(id)?.accounts || []);
export const accountOf = (id, accId) => accountsOf(id).find(a => a.id === accId) || null;

const writeAccounts = (id, list) => books.update(id, { accounts: list });

export function addAccount(id, { name, owner = ME, secret = false } = {}) {
  const book = get(id);
  if (!book) throw new Error('账本不存在');
  const acc = {
    id: `ac${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: trim(name, 16) || '未命名',
    owner: OWNERS.includes(owner) ? owner : ME,
    secret: !!secret,
  };
  writeAccounts(id, [...accountsOf(id), acc]);
  return acc;
}

export function updateAccount(id, accId, patch) {
  const next = accountsOf(id).map(a => (a.id === accId ? {
    ...a,
    ...(patch.name !== undefined ? { name: trim(patch.name, 16) } : {}),
    ...(patch.owner !== undefined && OWNERS.includes(patch.owner) ? { owner: patch.owner } : {}),
    ...(patch.secret !== undefined ? { secret: !!patch.secret } : {}),
  } : a));
  writeAccounts(id, next);
  return accountOf(id, accId);
}

/**
 * 删账户。**它名下的流水一起删** —— 留着就成了没有归属的钱，
 * 既算不进任何账户，又还在「本月支出」里，怎么看都对不上。
 */
export function removeAccount(id, accId) {
  entriesOf(id).filter(e => e.accountId === accId).forEach(e => entries.remove(e.id));
  writeAccounts(id, accountsOf(id).filter(a => a.id !== accId));
  return true;
}

/** 这一类归属的默认账户。转账、外卖这些落到哪儿，就看它。 */
export function defaultFor(bookId, owner) {
  const list = accountsOf(bookId).filter(a => a.owner === owner && !a.secret);
  return list[0] || accountsOf(bookId).find(a => a.owner === owner) || null;
}

/** 这段会话绑的是哪一本账。没绑就是没有。 */
export const bookOfChat = chatId =>
  (chatId ? all().find(b => b.chatId === chatId) : null) || null;

// 注入 prompt 与余额不足的拦截，默认都开着。绑一本账到某段会话，
// 本来就是为了让钱在那段对话里算数 —— 那两件正是「算数」的全部内容。
export const injectOn = book => book && book.inject !== false;
export const strictOn = book => book && book.strict !== false;

// ---- 流水 ----
//
// amount 带符号：正数进账，负数出账。折余额时直接相加，不必再看一个 type 字段。

export const entriesOf = id => entries.byIndex(id);

// ---- 会话里那几种消息，本身就是一笔钱的流动 ----
//
// **不另存一份流水。** 和情侣空间那边同一个道理（见 space.js）：礼物墙就是
// 会话里 kind 为 gift 的消息。这里也一样，转账、请客、代付现算出来。
//
// 好处是它天生跟着消息一起删、跟着重新生成一起撤、天生和聊天记录对得上。
// 存一份的话，角色那一轮被重新生成时要有人负责把对应的流水也撤掉 ——
// 那是一个永远会忘的活，而且忘了不报错。
//
// 只认已经落定的：待收款的转账、还没表态的请客，钱都没动。

const OUT = -1, IN = 1;

// 一条消息折成几笔。[{ owner, amount }]，amount 带符号。
function moveOf(m) {
  if (m.kind === 'transfer') {
    if (m.transfer !== transferSvc.TAKEN) return [];
    const from = m.role === 'user' ? ME : CHAR;
    const to = from === ME ? CHAR : ME;
    return [{ owner: from, amount: OUT * m.amount }, { owner: to, amount: IN * m.amount }];
  }
  if (m.kind === 'takeout') {
    const v = Number(m.amount) || 0;
    if (!v) return [];
    const who = m.role === 'user' ? ME : CHAR;
    const other = who === ME ? CHAR : ME;
    // 自己点自己吃自己付：一落库就算数，不必表态
    if (m.takeoutKind === takeoutSvc.SELF) return [{ owner: who, amount: OUT * v }];
    if (m.takeout !== takeoutSvc.TAKEN) return [];
    // 请客：点的人付。代付：对方付。
    const payer = m.takeoutKind === takeoutSvc.TREAT ? who : other;
    return [{ owner: payer, amount: OUT * v }];
  }
  return [];
}

let cache = { key: '', rows: [] };

/**
 * 这本账从会话里读出来的那几笔。返回的形状和 entries 一样，
 * 余额、统计两边都能直接拿去折。
 *
 * 按会话的索引版本缓存：消息没变就不重扫。一段聊了几万条的会话，
 * 每次画一行余额都全表扫一遍是不行的。
 */
export function chatEntries(bookId) {
  const book = get(bookId);
  const chatId = book?.chatId;
  if (!chatId) return [];
  const key = `${bookId}:${chatId}:${messages.indexVersion(chatId)}:${(book.accounts || []).length}`;
  if (cache.key === key) return cache.rows;

  const rows = [];
  for (const m of messagesOf(chatId)) {
    for (const mv of moveOf(m)) {
      const acc = defaultFor(bookId, mv.owner);
      if (!acc) continue;
      rows.push({
        id: `msg:${m.id}:${mv.owner}`,
        bookId, accountId: acc.id, amount: currency.round(mv.amount, book.currency),
        category: 'transfer', note: m.kind === 'takeout' ? (m.item || '外卖') : (m.note || ''),
        at: m.createdAt || 0, src: 'message', ref: m.id, pending: false,
      });
    }
  }
  cache = { key, rows };
  return rows;
}

/** 手记的加上会话里现算的，按时间排好。界面与统计都读这一份。 */
export const allEntries = id => [...entriesOf(id), ...chatEntries(id)];

/** 按时间倒序的那一份，界面上从新到旧读。 */
export const recent = (id, limit = 0) => {
  const list = allEntries(id).sort((a, b) => (b.at || 0) - (a.at || 0));
  return limit > 0 ? list.slice(0, limit) : list;
};

export function add({ bookId, accountId, amount, category = 'other', note = '',
  at = Date.now(), src = 'manual', pending = false, ref = '' } = {}) {
  const book = get(bookId);
  if (!book) throw new Error('账本不存在');
  const acc = accountOf(bookId, accountId) || accountsOf(bookId)[0];
  if (!acc) throw new Error('这本账还没有账户');
  const v = currency.round(num(amount), book.currency);
  if (!v) throw new Error('金额不能为零');
  return entries.create({
    bookId, accountId: acc.id, amount: v,
    category: categoryOf(category).id,
    note: trim(note, 40),
    at: num(at) || Date.now(),
    src, pending: !!pending, ref,
  });
}

export function edit(entryId, patch) {
  const e = entries.get(entryId);
  if (!e) return null;
  const book = get(e.bookId);
  const next = {};
  if (patch.amount !== undefined) next.amount = currency.round(num(patch.amount), book?.currency);
  if (patch.accountId !== undefined) next.accountId = patch.accountId;
  if (patch.category !== undefined) next.category = categoryOf(patch.category).id;
  if (patch.note !== undefined) next.note = trim(patch.note, 40);
  if (patch.at !== undefined) next.at = num(patch.at) || e.at;
  if (patch.pending !== undefined) next.pending = !!patch.pending;
  return entries.update(entryId, next);
}

export const drop = entryId => entries.remove(entryId);

/** 待确认的那几条。聊天里提取出来的先落在这儿，确认过才算数。 */
export const pendingOf = id => entriesOf(id).filter(e => e.pending);
export const confirm = entryId => edit(entryId, { pending: false });

// ---- 余额。全部现算 ----

const counted = e => !e.pending;

export function balanceOf(bookId, accId) {
  let n = 0;
  for (const e of allEntries(bookId)) if (counted(e) && e.accountId === accId) n += e.amount;
  return currency.round(n, get(bookId)?.currency);
}

/** 一本账上，某一类归属的总额。不给 owner 就是全部。 */
export function totalOf(bookId, owner) {
  const list = accountsOf(bookId).filter(a => !owner || a.owner === owner);
  const ids = new Set(list.map(a => a.id));
  let n = 0;
  for (const e of allEntries(bookId)) if (counted(e) && ids.has(e.accountId)) n += e.amount;
  return currency.round(n, get(bookId)?.currency);
}

// ---- 统计 ----

const monthKey = at => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const thisMonth = () => monthKey(Date.now());

/** 某个月的收支。month 形如 2026-09，不给就是本月。 */
export function stats(bookId, month = thisMonth()) {
  let income = 0, expense = 0;
  const byCategory = new Map();
  for (const e of allEntries(bookId)) {
    if (!counted(e) || monthKey(e.at) !== month) continue;
    if (e.amount > 0) income += e.amount;
    else {
      expense -= e.amount;
      byCategory.set(e.category, (byCategory.get(e.category) || 0) - e.amount);
    }
  }
  const code = get(bookId)?.currency;
  return {
    month,
    income: currency.round(income, code),
    expense: currency.round(expense, code),
    net: currency.round(income - expense, code),
    byCategory: [...byCategory.entries()]
      .map(([id, v]) => ({ id, label: categoryOf(id).label, amount: currency.round(v, code) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// ---- 显示 ----

export const money = (bookId, n) => currency.display(n, get(bookId)?.currency);

/** 这本账挂在谁身上。没绑会话就只有「我」。 */
export function whoOf(bookId) {
  const book = get(bookId);
  const chat = book?.chatId ? chats.get(book.chatId) : null;
  const char = chat ? characters.get((chat.characterIds || [])[0]) : null;
  const me = (chat && accounts.get(chat.personaId)) || accounts.current();
  return { me: me?.name || '我', char: char?.name || '', chat, char2: char };
}

export function ownerLabel(bookId, owner) {
  const who = whoOf(bookId);
  if (owner === CHAR) return who.char || '角色';
  if (owner === JOINT) return '共同';
  return who.me;
}

// ---- 钱不能无中生有 ----
//
// 两道关。**第一道在 prompt**：余额是个算得出来的确定数字，注入进去
// （见 ai/context/bill.js），和距离、点数一样 —— 数字不是模型的活。
//
// 第二道在这里：真要付的时候再算一次。模型说了不算，账上有没有才算。

/** 这一方付得起这笔钱吗。没绑账本、或者没开严格模式，一律付得起。 */
export function affordable(chatId, owner, amount) {
  const book = bookOfChat(chatId);
  if (!book || !strictOn(book)) return true;
  const acc = defaultFor(book.id, owner);
  if (!acc) return true;
  const v = Math.abs(Number(amount) || 0);
  return balanceOf(book.id, acc.id) >= v;
}

/** 注入用的那一份。context/bill.js 读它。 */
export function context(chatId) {
  const book = bookOfChat(chatId);
  if (!book || !injectOn(book)) return null;
  const who = whoOf(book.id);
  const mine = defaultFor(book.id, ME);
  const hers = defaultFor(book.id, CHAR);
  const joint = defaultFor(book.id, JOINT);
  const st = stats(book.id);
  const fmt = n => currency.format(n, book.currency);
  return {
    name: book.name,
    self: hers ? fmt(balanceOf(book.id, hers.id)) : '',
    selfName: hers?.name || '',
    other: mine ? fmt(balanceOf(book.id, mine.id)) : '',
    otherName: who.me,
    joint: joint ? fmt(balanceOf(book.id, joint.id)) : '',
    month: fmt(st.expense),
    strict: strictOn(book),
  };
}
