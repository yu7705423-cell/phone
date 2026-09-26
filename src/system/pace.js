import { chats, characters, settings } from './db/index.js';
import * as clock from './time.js';
import * as day from './day.js';
import * as events from './events.js';

// 她什么时候回。
//
// 原本的规矩是「发出去就只是发出去，要不要回复由你按按钮决定」。
// 这个模块加的是第二、第三档：
//
//   manual  按按钮才回。原来的样子，默认还是它。
//   now     发完就回。省得每条都按一下。
//   paced   **看她这会儿在干什么**，回复的时刻由状态决定（ARCHITECTURE 4.261）。
//
// 第三档要解决的是「秒回」这件事本身的假：真人不会每条都在三秒内回。
// 从前它是一个公式（基准秒数乘时段乘运势），本质还是「发一句、等一会儿」。用户的话：
// 「不是每一句发出去等一会儿，对方什么时候回复取决于对方的状态」。所以现在先推状态：
//
//   空闲   几分钟内回（基准时长加抖动，要紧的快一些）
//   忙碌   角色的一天里当前时段排着事，等这件事做完（时段结束）再回
//   睡觉   免打扰时段（主动发起对话里那一段，默认 0 到 8 点）里睡着，起床后回
//
// 忙碌、睡觉期间你发十条，她回来只回一次，把十条一起读：到点时刻记在会话上，一段会话一个，
// 新消息不把它往后推。「多久」绝不问模型 —— 问它，它会写「我过了二十分钟才回你」然后
// 立刻把这句话发出来。状态全从本地数据推，和距离、点数、金额一样：**数字不是模型的活**。
//
// 页面关掉定时器就没了。所以到点的时刻记在会话上，下次打开时按时间戳补上 ——
// 早该回的立刻回，没到的接着等。**应用不在前台、也没开保活或后台运行时，到点是收不到的**，
// 界面上写明。

export const MANUAL = 'manual';
export const NOW = 'now';
export const PACED = 'paced';
export const MODES = [MANUAL, NOW, PACED];

export function modeOf(chat) {
  const m = chat?.paceMode;
  return MODES.includes(m) ? m : MANUAL;
}
export function setMode(chatId, mode) {
  chats.update(chatId, { paceMode: MODES.includes(mode) ? mode : MANUAL });
}

export const baseOf = chat => {
  const n = Math.round(Number(chat?.paceBase) || 0);
  return n > 0 ? n : 60;
};
export const maxOf = chat => Math.max(0, Math.round(Number(chat?.paceMax) || 0));

export function setPace(chatId, patch) {
  const next = {};
  if (patch.base !== undefined) next.paceBase = Math.max(0, Math.round(Number(patch.base) || 0));
  if (patch.max !== undefined) next.paceMax = Math.max(0, Math.round(Number(patch.max) || 0));
  chats.update(chatId, next);
}

// 最长等多久。0 表示不封顶（CLAUDE.md 第 13 条）。默认不封顶：忙碌、睡觉本来就是几小时的事，
// 封顶十分钟等于没有这个功能（从前默认 600，只对旧的公式有意义）
export const sleepOf = chat => chat?.paceSleep !== false;
export function setSleep(chatId, on) { chats.update(chatId, { paceSleep: on !== false }); }

const H = 3600 * 1000;
const clampHour = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.round(n))) : d; };
const inWindow = (h, from, to) => (from === to ? false : from < to ? (h >= from && h < to) : (h >= from || h < to));

// 从 at 起，角色那边下一次到整点 hour 的时刻。当前正是那个小时就算下一天
function nextHourAt(char, at, hour) {
  const p = clock.partsOf(new Date(at), clock.charZone(char));
  const h = Number(p.hour), m = Number(p.minute);
  let dh = (hour - h + 24) % 24;
  if (dh === 0) dh = 24;
  return at + (dh * 60 - m) * 60 * 1000;
}

/**
 * 她这会儿在干什么。{ kind: 'free' | 'busy' | 'asleep', what, until }
 * 全从本地读：免打扰时段（睡觉）、角色的一天（忙碌）。都不是就是空闲
 */
export function stateOf(chat, when = clock.now()) {
  const at = +when;   // 传进来的可能是 Date，下面要做加减
  const char = characters.get((chat?.characterIds || [])[0]);
  if (!char) return { kind: 'free', what: '', until: 0 };
  // 会话切到线下时两个人在一处（system/face.js）：不忙也不在休息，按空闲算。
  // 档位不换 —— 换成「发完就回」会把延迟回复里几条并成一次回的省法丢掉，多花的账用户看不见
  if (chat?.face?.on === true) return { kind: 'free', what: '', until: 0 };
  const from = clampHour(char.proactiveQuietFrom, 0), to = clampHour(char.proactiveQuietTo, 8);
  const h = Number(clock.partsOf(new Date(at), clock.charZone(char)).hour);
  if (sleepOf(chat) && inWindow(h, from, to)) return { kind: 'asleep', what: '休息中', until: nextHourAt(char, at, to) };
  const brief = day.brief(char.id, at);
  if (brief && brief.nowItems.length) {
    return { kind: 'busy', what: brief.nowItems[0], until: nextHourAt(char, at, brief.slot.to) };
  }
  return { kind: 'free', what: '', until: 0 };
}

/**
 * 这一条该什么时候回。回 { dueAt, secs, state }。
 *
 *   空闲   基准时长；带问号的减半，写得长的打七折；再乘 0.6 到 1.6 的抖动；走背字慢一点（见 4.82）
 *   忙碌   这件事结束之后 0 到 15 分钟
 *   睡觉   起床之后 0 到 20 分钟
 * 最后按「最长等多久」封顶（0 不封顶）。
 *
 * 「要紧不要紧」只看标点和长度，很粗 —— 它要防的是「每条都一样快」，
 * 而不是真去理解这句话，那是模型的活，不是这儿的。
 */
export function dueFor(chatId, text = '', { rng = Math.random, at } = {}) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  const now = +(at || clock.now());
  const state = stateOf(chat, now);
  let dueAt;
  if (state.kind === 'asleep') dueAt = state.until + rng() * 20 * 60 * 1000;
  else if (state.kind === 'busy') dueAt = state.until + rng() * 15 * 60 * 1000;
  else {
    const char = characters.get((chat.characterIds || [])[0]);
    let secs = baseOf(chat);
    const luck = events.luckOf(char);
    if (luck < -0.4) secs *= 1.3;
    const t = String(text || '');
    if (/[?？]/.test(t)) secs *= 0.5;
    else if (t.length >= 30) secs *= 0.7;
    secs *= 0.6 + rng();
    dueAt = now + Math.max(1, secs) * 1000;
  }
  const cap = maxOf(chat);
  if (cap) dueAt = Math.min(dueAt, now + cap * 1000);
  const secs = Math.max(1, Math.round((dueAt - now) / 1000));
  return { dueAt: now + secs * 1000, secs, state: { kind: state.kind, what: state.what } };
}

// ---- 待回复 ----
//
// 记在会话上，不是记在内存里：页面一关内存就没了，而「她该回了」
// 这件事不该因为你退出去看了眼别的 app 就取消。

export const pendingOf = chat => (chat?.pacePending?.dueAt ? chat.pacePending : null);

export function schedule(chatId, text, opts = {}) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  const next = dueFor(chatId, text, opts);
  if (!next) return null;
  // 到点时刻按真实的现在算（opts.at 只用来推状态，测试里会假装成别的时刻）
  const dueAt = Date.now() + next.secs * 1000;
  // 已经在等了：忙碌、睡觉时她回来一次把几条一起读，新消息不把到点往后推；
  // 空闲时也取早的那个 —— 连发两条不该比只发一条回得更晚
  const cur = pendingOf(chat);
  if (cur && cur.dueAt <= dueAt) return cur;
  const pending = { dueAt, secs: next.secs, state: next.state };
  chats.update(chatId, { pacePending: pending });
  return pending;
}

export function clear(chatId) {
  const chat = chats.get(chatId);
  if (chat && chat.pacePending) chats.update(chatId, { pacePending: null });
}

/** 还差多少毫秒。已经过点了就是 0，没排就是 null。 */
export function leftOf(chat) {
  const p = pendingOf(chat);
  if (!p) return null;
  return Math.max(0, p.dueAt - Date.now());
}

/** 念给人听的那一版。 */
export function leftText(ms) {
  if (ms === null || ms === undefined) return '';
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return '就快回复了';
  if (s < 60) return `约 ${s} 秒后回复`;
  if (s < 3600) return `约 ${Math.ceil(s / 60)} 分钟后回复`;
  return `约 ${Math.round(s / 3600)} 小时后回复`;
}

/** 连着状态一起念：「对方正在上课，约 2 小时后回复」 */
export function pendingText(chat) {
  const p = pendingOf(chat);
  if (!p) return '';
  const left = leftText(leftOf(chat));
  const st = p.state || {};
  if (st.kind === 'busy' && st.what) return `对方正在${st.what}，${left}`;
  if (st.kind === 'asleep') return `对方在休息，${left}`;
  return left;
}

/** 到点的会话。 */
export function dueChats(now = Date.now()) {
  return chats.all().filter(c => {
    const p = pendingOf(c);
    return p && p.dueAt <= now;
  });
}

/**
 * 把到点的那几段对话真的回掉。
 *
 * 会话页自己也有一个定时器，但它只管你正开着的那一段。人在别处、
 * 或者页面刚打开的时候，靠的是这一条 —— 全局那个 tick 每二十秒扫一遍。
 * 这样「她趁你没看的时候回了一句」才成立，而且会走通知。
 *
 * 动态 import：engine 那一串要用到 db 和模板，静态引进来会绕一大圈。
 * 失败不抛：一段没回成不该拖住别的。
 */
export async function runDue(now = Date.now()) {
  const list = dueChats(now);
  if (!list.length) return 0;
  const [engine, reply] = await Promise.all([
    import('./ai/engine.js'), import('./ai/reply.js'),
  ]);
  if (!engine.isConfigured()) return 0;

  let done = 0;
  const grp = await import('./ai/group.js');
  const { isGroup } = await import('./group.js');
  for (const chat of list) {
    // 上面等了几次 import，这期间会话页的定时器可能已经清掉并动手了：再确认一次还在等。
    // 不确认的话两边各发一次，第二次还会把第一次顶掉（replace），第一次的钱白付
    if (!pendingOf(chats.get(chat.id))) continue;
    // 群聊走群聊那一路：一次调用写整轮，或者按开关每人一次
    if (isGroup(chat)) {
      if (grp.isBusy(chat)) continue;
      clear(chat.id);
      try {
        const made = await grp.run(chat, { notify: true });
        chats.update(chat.id, { unread: (chats.get(chat.id)?.unread || 0) + made.length });
        done += 1;
      } catch (err) {
        console.warn('[pace] 这个群没回成:', err.message || err);
      }
      continue;
    }
    const char = characters.get((chat.characterIds || [])[0]);
    // 正在生成就别插一脚 —— 会话页那个定时器可能已经动手了
    if (!char || engine.isReplying(chat.id, char.id)) continue;
    // 先清掉再生成：生成要花好几秒，这期间 tick 会再跑一轮
    clear(chat.id);
    try {
      const raw = await engine.streamReply({ chat, char });
      const text = String(raw || '').trim();
      if (!text) continue;
      const made = await reply.renderTurn({
        chat, char, raw: text, turnId: `pace-${Date.now()}`, swipes: [text], swipeIndex: 0,
        notify: true,
      });
      chats.update(chat.id, { unread: (chats.get(chat.id)?.unread || 0) + made.length });
      done += 1;
    } catch (err) {
      // 断在中途：收到的部分已经付过钱，照常落下（见 reply.keepPartial）
      const kept = await reply.keepPartial({ chat, char, err, notify: true }).catch(() => []);
      if (kept.length) chats.update(chat.id, { unread: (chats.get(chat.id)?.unread || 0) + kept.length });
      console.warn('[pace] 这一段没回成:', err.message || err);
    }
  }
  return done;
}
