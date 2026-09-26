import { books, entries, chats, characters, settings, messagesOf, messages } from './db/index.js';
import * as accounts from './accounts.js';
import * as currency from './currency.js';
import * as transferSvc from './transfer.js';
import * as takeoutSvc from './takeout.js';
import * as requestSvc from './request.js';
import * as dayStore from './day.js';

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
//
// **三个钱包（4.278）。** 关联了对话的账本就是「一起记账」：我的钱、角色的钱、情侣账户，
// 各是一个 owner 的默认账户。角色的钱由模型按角色卡生成起始余额与固定收支（ai/tasks/money.js），
// 生成之前视作「不知道有多少」：不注入、不拦（charReady）。情侣账户是两个人的交集：
// 双方都能存（[存入情侣账户：金额]，落定即算），动用要对方批准。

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

export function create({ name, kind = PLAY, chatId = '', currency: code, start = 0 } = {}) {
  const row = books.create({
    name: trim(name, 20) || (kind === REAL ? '我的账本' : '未命名账本'),
    kind: KINDS.includes(kind) ? kind : PLAY,
    chatId: chatId || '',
    currency: code || currency.current().code,
    accounts: [],
    createdAt: Date.now(),
  });
  // 一本新账至少要有一个账户，否则第一笔记不下去
  const mine = addAccount(row.id, { name: '现金', owner: ME });
  if (Number(start) > 0) seed(row.id, mine.id, start);
  if (chatId) ensureChar(row.id);
  return get(row.id);
}

/** 起始余额：一笔 src 为 seed 的流水。再设一次就换掉那一笔，不叠加 */
export function seed(bookId, accountId, amount) {
  const book = get(bookId);
  if (!book) throw new Error('账本不存在');
  entriesOf(bookId).filter(e => e.src === 'seed' && e.accountId === accountId).forEach(e => entries.remove(e.id));
  const v = currency.round(Number(amount) || 0, book.currency);
  if (!v) return null;
  return entries.create({
    bookId, accountId, amount: v, category: 'other', note: '起始余额',
    at: Date.now(), src: 'seed', ref: '', pending: false,
  });
}

/**
 * 关联了对话的账本一定有角色的钱包。名字就是角色的名字；已经有的不动。
 * 顺带把从前建的「共同账户」改叫「情侣账户」（只改默认名，用户自己起的不动）
 */
export function ensureChar(bookId) {
  const book = get(bookId);
  if (!book || !book.chatId) return null;
  const who = whoOf(bookId);
  const had = accountsOf(bookId).find(a => a.owner === CHAR);
  const joint = accountsOf(bookId).find(a => a.owner === JOINT && a.name === '共同账户');
  if (joint) updateAccount(bookId, joint.id, { name: '情侣账户' });
  if (had) return had;
  return addAccount(bookId, { name: who.char || '角色', owner: CHAR });
}

/**
 * 角色的钱生成过了吗。没生成过的视作「不知道有多少」：不注入余额、不拦支付 ——
 * 和从前没有角色账户时一样。生成过（有起始余额、固定收支落过、或手动存过）才算数
 */
export function charReady(bookId) {
  const acc = defaultFor(bookId, CHAR);
  if (!acc) return false;
  return allEntries(bookId).some(e => e.accountId === acc.id);
}

/** 模型生成的那份「角色的钱」的说明。生成时写在账本上，钱包页上显示 */
export const charMoneyOf = bookId => get(bookId)?.charMoney || null;
export const setCharMoney = (bookId, info) => books.update(bookId, { charMoney: info || null });

export function update(id, patch) {
  const next = {};
  if (patch.name !== undefined) next.name = trim(patch.name, 20);
  if (patch.kind !== undefined && KINDS.includes(patch.kind)) next.kind = patch.kind;
  if (patch.chatId !== undefined) next.chatId = patch.chatId || '';
  if (patch.currency !== undefined) next.currency = patch.currency;
  if (patch.inject !== undefined) next.inject = !!patch.inject;
  if (patch.strict !== undefined) next.strict = !!patch.strict;
  if (patch.settle !== undefined) next.settle = !!patch.settle;
  const row = books.update(id, next);
  if (next.chatId) ensureChar(id);
  return row;
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

export function addAccount(id, { name, owner = ME, secret = false, pass = '', hint = '' } = {}) {
  const book = get(id);
  if (!book) throw new Error('账本不存在');
  const acc = {
    id: `ac${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: trim(name, 16) || '未命名',
    owner: OWNERS.includes(owner) ? owner : ME,
    // 私密账户：余额与密码都不进 prompt，猜这件事只发生在记账 app 里
    secret: !!secret,
    pass: String(pass || '').trim().slice(0, 12),
    hint: trim(hint, 30),
    unlocked: false,
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
    ...(patch.pass !== undefined ? { pass: String(patch.pass || '').trim().slice(0, 12) } : {}),
    ...(patch.hint !== undefined ? { hint: trim(patch.hint, 30) } : {}),
    ...(patch.unlocked !== undefined ? { unlocked: !!patch.unlocked } : {}),
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

/** 保证这本账上有一个共同账户。申请通过之后调它。 */
export function ensureJoint(bookId) {
  const had = accountsOf(bookId).find(a => a.owner === JOINT);
  if (had) return had;
  return addAccount(bookId, { name: '情侣账户', owner: JOINT });
}
export const hasJoint = bookId => !!accountsOf(bookId).find(a => a.owner === JOINT);

// ---- 亲属卡 ----
//
// 一张卡 = 「你花钱的时候花的是我的余额」。发卡的是 from，拿卡的是 to。
//
// **用掉多少不入库**，和余额一样是折出来的（见 chatEntries 里那段扫描）。
// 存一个 used 字段的话，某一轮被重新生成、那笔消费消失之后，
// 额度不会跟着还回来 —— 又是一个安静错下去的数。

export const cardsOf = bookId => (get(bookId)?.cards || []);
export const cardTo = (bookId, owner) =>
  cardsOf(bookId).find(c => c.to === owner && c.active !== false) || null;

export function addCard(bookId, { from, to, limit }) {
  const book = get(bookId);
  if (!book) throw new Error('账本不存在');
  const card = {
    id: `cd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    from: OWNERS.includes(from) ? from : ME,
    to: OWNERS.includes(to) ? to : CHAR,
    limit: currency.round(Math.abs(Number(limit) || 0), book.currency),
    active: true,
    at: Date.now(),
  };
  // 同一个方向只留一张：再发一张就是换额度，两张并存没人算得清
  const rest = cardsOf(bookId).filter(c => !(c.from === card.from && c.to === card.to));
  books.update(bookId, { cards: [...rest, card] });
  return card;
}

export function setCard(bookId, cardId, patch) {
  const next = cardsOf(bookId).map(c => (c.id === cardId ? {
    ...c,
    ...(patch.limit !== undefined
      ? { limit: currency.round(Math.abs(Number(patch.limit) || 0), get(bookId)?.currency) } : {}),
    ...(patch.active !== undefined ? { active: !!patch.active } : {}),
  } : c));
  books.update(bookId, { cards: next });
  return cardsOf(bookId).find(c => c.id === cardId) || null;
}

export const removeCard = (bookId, cardId) =>
  books.update(bookId, { cards: cardsOf(bookId).filter(c => c.id !== cardId) });

/** 这张卡已经被刷掉多少。扫一遍会话现算。 */
export function cardUsed(bookId, cardId) {
  let n = 0;
  for (const e of chatEntries(bookId)) if (e.cardId === cardId) n += -e.amount;
  return currency.round(n, get(bookId)?.currency);
}
export const cardLeft = (bookId, card) =>
  currency.round(Math.max(0, (card?.limit || 0) - cardUsed(bookId, card?.id)), get(bookId)?.currency);

// ---- 固定入账 ----
//
// 每月某一天自动落一笔。**不起定时器** —— 谁打开账本谁顺手把到期的补上，
// 和 watch.sweep、day.ensureToday 同一个路子。页面关着的时候没有任何东西
// 在跑，回来一次补齐。
//
// 补出来的流水是真流水（存在 entries 里），不是现算的：它没有一条消息
// 可以挂靠，而且用户随时会去改它。

export const rulesOf = bookId => (get(bookId)?.rules || []);

export function addRule(bookId, { accountId, day = 1, amount = 0, category = 'salary', note = '', by = '' }) {
  const book = get(bookId);
  if (!book) throw new Error('账本不存在');
  const rule = {
    id: `rl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    accountId: accountId || accountsOf(bookId)[0]?.id || '',
    day: Math.max(1, Math.min(31, Math.round(Number(day) || 1))),
    amount: currency.round(Number(amount) || 0, book.currency),
    category: categoryOf(category).id,
    note: trim(note, 40),
    active: true,
    // 谁建的：'ai' 是按角色卡生成的那几条，重新生成时整批换掉；用户自己建的不动
    by: String(by || ''),
    // 从建立的那一刻起算。不补历史 —— 新建一条规则不该凭空多出半年的账
    from: Date.now(),
  };
  books.update(bookId, { rules: [...rulesOf(bookId), rule] });
  return rule;
}

export function setRule(bookId, ruleId, patch) {
  const book = get(bookId);
  const next = rulesOf(bookId).map(r => (r.id === ruleId ? {
    ...r,
    ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
    ...(patch.day !== undefined ? { day: Math.max(1, Math.min(31, Math.round(Number(patch.day) || 1))) } : {}),
    ...(patch.amount !== undefined ? { amount: currency.round(Number(patch.amount) || 0, book?.currency) } : {}),
    ...(patch.category !== undefined ? { category: categoryOf(patch.category).id } : {}),
    ...(patch.note !== undefined ? { note: trim(patch.note, 40) } : {}),
    ...(patch.active !== undefined ? { active: !!patch.active } : {}),
  } : r));
  books.update(bookId, { rules: next });
  return rulesOf(bookId).find(r => r.id === ruleId) || null;
}

export const removeRule = (bookId, ruleId) =>
  books.update(bookId, { rules: rulesOf(bookId).filter(r => r.id !== ruleId) });

const ymd = at => {
  const d = new Date(at);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// 这条规则从 from 到今天，应该落过哪几次。按月走，遇到二月三十号这种
// 就落在当月最后一天 —— 每月一号发工资的人不该因为二月短一天就少领一次。
function dueDates(rule, now = Date.now()) {
  const out = [];
  const start = new Date(rule.from || now);
  const end = new Date(now);
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= end) {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const at = new Date(d.getFullYear(), d.getMonth(), Math.min(rule.day, last), 9, 0, 0);
    if (at.getTime() >= (rule.from || 0) && at <= end) out.push(at.getTime());
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/** 把到期还没落的固定入账补上。返回补了几笔。 */
export function runRules(bookId, now = Date.now()) {
  const book = get(bookId);
  if (!book) return 0;
  const had = new Set(entriesOf(bookId).filter(e => e.src === 'rule').map(e => e.ref));
  let made = 0;
  for (const rule of rulesOf(bookId)) {
    if (rule.active === false || !rule.amount) continue;
    for (const at of dueDates(rule, now)) {
      const ref = `${rule.id}@${ymd(at)}`;
      if (had.has(ref)) continue;
      entries.create({
        bookId, accountId: rule.accountId, amount: rule.amount,
        category: rule.category, note: rule.note, at,
        src: 'rule', ref, pending: false,
      });
      made += 1;
    }
  }
  return made;
}

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
  // 动用情侣账户：批准了才算，钱从情侣账户出
  if (m.kind === 'request' && m.requestKind === requestSvc.SPEND) {
    if (m.request !== requestSvc.APPROVED) return [];
    return [{ owner: JOINT, amount: OUT * (Number(m.amount) || 0), noCard: true }];
  }
  // 存入情侣账户：发出即落定，从存入方的钱包出、进情侣账户。不走亲属卡（那是消费，这不是）
  if (m.kind === 'request' && m.requestKind === requestSvc.DEPOSIT) {
    if (m.request !== requestSvc.APPROVED) return [];
    const v = Number(m.amount) || 0;
    const from = m.role === 'user' ? ME : CHAR;
    return [{ owner: from, amount: OUT * v, noCard: true }, { owner: JOINT, amount: IN * v, noCard: true }];
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
  const key = `${bookId}:${chatId}:${messages.indexVersion(chatId)}:`
    + `${(book.accounts || []).length}:${JSON.stringify(book.cards || [])}`;
  if (cache.key === key) return cache.rows;

  // **按时间顺序扫，边扫边算亲属卡还剩多少额度。**
  // 第 N 笔走不走得了卡，取决于前 N-1 笔刷掉了多少，所以这一遍不能乱序，
  // 也不能各算各的。额度同样不入库，和余额一样是折出来的。
  const cards = cardsOf(bookId).filter(c => c.active !== false);
  const used = new Map();
  const rows = [];
  const byTime = messagesOf(chatId).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  for (const m of byTime) {
    for (const mv of moveOf(m)) {
      let owner = mv.owner;
      let cardId = '';
      // 出账才走卡，进账不走。共同账户那一笔不走卡（noCard）。
      if (mv.amount < 0 && !mv.noCard) {
        const card = cards.find(c => c.to === owner);
        if (card) {
          const left = (card.limit || 0) - (used.get(card.id) || 0);
          // 额度够就整笔记在发卡方账上；不够就走不了，照旧记在自己账上。
          // 拆成两半记看着更精确，实际上没人算得清哪半走了卡。
          if (left >= -mv.amount) {
            used.set(card.id, (used.get(card.id) || 0) + -mv.amount);
            owner = card.from;
            cardId = card.id;
          }
        }
      }
      const acc = defaultFor(bookId, owner);
      if (!acc) continue;
      rows.push({
        id: `msg:${m.id}:${mv.owner}`,
        bookId, accountId: acc.id, amount: currency.round(mv.amount, book.currency),
        category: 'transfer',
        note: m.kind === 'takeout' ? (m.item || '外卖')
          : m.kind === 'request' ? (m.requestKind === requestSvc.DEPOSIT ? '存入情侣账户' : (m.note || '情侣账户')) : (m.note || ''),
        at: m.createdAt || 0, src: 'message', ref: m.id, pending: false,
        by: mv.owner, cardId,
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

/**
 * 记一笔。
 *
 * `tripId` 是这一笔属于哪一次出行。**花费不在出行那一行里记一个数**，
 * 就是账本里挂着这个 id 的那几笔的和（见 system/trip.js 的 spentOn）——
 * 记一个数的话，这里改一笔或删一笔，那边就悄悄错了。
 */
export function add({ bookId, accountId, amount, category = 'other', note = '',
  at = Date.now(), src = 'manual', pending = false, ref = '', tripId = '' } = {}) {
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
    src, pending: !!pending, ref, tripId: String(tripId || ''),
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

/**
 * 一本账上，某一类归属的总额。不给 owner 就是全部。
 *
 * **还锁着的私密账户不计入。** 计入的话，合计减一减就能反推出里面有多少，
 * 那张卡也就不必猜了。界面上单独列一行说明它锁着。
 */
export function totalOf(bookId, owner) {
  const list = accountsOf(bookId)
    .filter(a => (!owner || a.owner === owner) && unlocked(a));
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
/**
 * 这本账有流水的那几个月，新的在前。统计页上拿它翻月份 ——
 * 翻到一个空月份没有意义，有数的月份就这么几个。
 */
export function months(bookId) {
  const set = new Set();
  for (const e of allEntries(bookId)) if (counted(e)) set.add(monthKey(e.at));
  const now = thisMonth();
  set.add(now);
  return [...set].sort().reverse();
}

/**
 * 钱都花在哪儿了：按分类摊开，带占比。
 *
 * `stats` 里那个 byCategory 只给当月、只给金额。这一份多两样：
 * **占比**（光看数字比不出哪一项吃掉了大半）与**笔数**（三千块是一次买的，
 * 还是三十次凑出来的，是两回事）。
 */
export function spending(bookId, month = thisMonth()) {
  const by = new Map();
  let total = 0;
  for (const e of allEntries(bookId)) {
    if (!counted(e) || monthKey(e.at) !== month || e.amount >= 0) continue;
    const v = -e.amount;
    const had = by.get(e.category) || { amount: 0, count: 0 };
    by.set(e.category, { amount: had.amount + v, count: had.count + 1 });
    total += v;
  }
  const code = get(bookId)?.currency;
  const rows = [...by.entries()]
    .map(([id, v]) => ({
      id, label: categoryOf(id).label,
      amount: currency.round(v.amount, code),
      count: v.count,
      share: total ? v.amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  return { month, total: currency.round(total, code), rows };
}

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
  if (owner === JOINT) return '情侣账户';
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
  // 角色的钱还没生成：不知道有多少，也就无从说不够（4.278）
  if (owner === CHAR && !charReady(book.id)) return true;
  const v = Math.abs(Number(amount) || 0);
  // 手里有额度够用的亲属卡，付的就是发卡方的钱，看他够不够
  const card = cardTo(book.id, owner);
  const payer = card && cardLeft(book.id, card) >= v ? card.from : owner;
  const acc = defaultFor(book.id, payer);
  if (!acc) return true;
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
  const hidden = new Set(hiddenFromPrompt(book.id));
  if (hidden.has(hers?.id) || hidden.has(mine?.id) || hidden.has(joint?.id)) {
    console.warn('[bill] 私密账户不该出现在注入里');
  }
  const ready = charReady(book.id);
  return {
    name: book.name,
    self: hers && ready ? fmt(balanceOf(book.id, hers.id)) : '',
    selfName: hers?.name || '',
    other: mine ? fmt(balanceOf(book.id, mine.id)) : '',
    otherName: who.me,
    joint: joint ? fmt(balanceOf(book.id, joint.id)) : '',
    month: fmt(st.expense),
    strict: strictOn(book),
    hasJoint: hasJoint(book.id),
    // 角色手里那张（别人发给它的）与它发出去的那张
    cardHeld: (() => {
      const c = cardTo(book.id, CHAR);
      return c ? { limit: fmt(c.limit), left: fmt(cardLeft(book.id, c)), from: who.me } : null;
    })(),
    cardGiven: (() => {
      const c = cardTo(book.id, ME);
      return c ? { limit: fmt(c.limit), left: fmt(cardLeft(book.id, c)), to: who.me } : null;
    })(),
  };
}

// ---- 结算角色前一天花了多少 ----
//
// 数据来自那天的日程与三顿，**不另调接口**：日程本来每天就要排一次，
// 花销跟着那一次一起生成（见 task.day-plan 的 cost 与 task.recipe-batch
// 的 price）。见 CLAUDE.md 第 15 条。
//
// 一天只结一次，靠 ref 去重 —— 补两遍不该变成扣两遍。

export function settleDay(bookId, charId, date) {
  const book = get(bookId);
  if (!book) return 0;
  const row = dayStore.get(charId, date);
  if (!row) return 0;
  const acc = defaultFor(bookId, CHAR);
  if (!acc) return 0;

  const had = new Set(entriesOf(bookId).filter(e => e.src === 'day').map(e => e.ref));
  const at = new Date(`${date}T20:00:00`).getTime() || Date.now();
  let made = 0;

  const put = (key, amount, category, note) => {
    const ref = `${charId}@${date}#${key}`;
    if (had.has(ref) || !amount) return;
    entries.create({
      bookId, accountId: acc.id, amount: currency.round(-Math.abs(amount), book.currency),
      category, note: trim(note, 40), at, src: 'day', ref, pending: false,
    });
    made += 1;
  };

  // 取消掉的那几项不算 —— 没做的事不花钱
  (row.items || []).forEach((it, i) => {
    if (it.state === dayStore.DROP) return;
    put(`i${it.id || i}`, Number(it.cost) || 0, 'other', it.text);
  });
  (row.meals || []).forEach((m, i) => {
    put(`m${m.meal || i}`, Number(m.price) || 0, 'food', m.name);
  });
  return made;
}

/** 前一天的结算。每天排新日程时顺手结掉昨天，见 tasks/day.js。 */
export function settleYesterday(charId, now = Date.now()) {
  const book = all().find(b => {
    const chat = b.chatId ? chats.get(b.chatId) : null;
    return chat && (chat.characterIds || [])[0] === charId;
  });
  if (!book || !settleOn(book)) return 0;
  const char = characters.get(charId);
  if (!char) return 0;
  const y = new Date(now - 86400000);
  const pad = n => String(n).padStart(2, '0');
  return settleDay(book.id, charId,
    `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`);
}

// 结算前一天要不要做。**默认关着** —— 它会凭空往账上添一串支出，
// 用户得自己点头（第 13 条）。
export const settleOn = book => !!(book && book.settle);

// ---- 私密账户 ----
//
// 角色可以有一张不愿让人看见的卡。**密码不注入 prompt**，余额也不注入 ——
// 注入了它迟早会说漏，那就没得猜了。猜这件事整个发生在记账 app 里。

export const secretOf = bookId => accountsOf(bookId).find(a => a.owner === CHAR && a.secret) || null;

/**
 * 私密账户里有多少，**任何时候都不注入 prompt**。
 *
 * 这一句在 context() 里被显式调用，不是摆设：defaultFor 已经跳过了
 * secret，所以余额本来就不会漏进去 —— 但那是一个「顺带正确」，
 * 谁改一下 defaultFor 就悄悄破了。这里把它写成一件明说的事。
 */
export const hiddenFromPrompt = bookId => {
  const acc = secretOf(bookId);
  return acc ? [acc.id] : [];
};

/** 猜对了就永久解开。密码只存在这台设备上，这是个游戏，不是安全边界。 */
export function tryPass(bookId, accId, input) {
  const acc = accountOf(bookId, accId);
  if (!acc || !acc.secret) return true;
  const ok = String(input || '').trim() === String(acc.pass || '');
  if (ok) updateAccount(bookId, accId, { unlocked: true });
  return ok;
}
export const unlocked = acc => !acc?.secret || acc.unlocked === true;
