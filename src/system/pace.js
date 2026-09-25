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
//   paced   过一会儿才回，**过多久由本地算**。
//
// 第三档要解决的是「秒回」这件事本身的假：真人不会每条都在三秒内回。
// 但「多久」绝不能问模型 —— 问它，它会写「我过了二十分钟才回你」然后
// 立刻把这句话发出来。所以时长在这儿算，算完就是一个定时器。
// 和距离、点数、金额一样：**数字不是模型的活**。
//
// 页面关掉定时器就没了。所以到点的时刻记在会话上，
// 下次打开时按时间戳补上 —— 早该回的立刻回，没到的接着等。

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
// 0 表示不封顶（CLAUDE.md 第 13 条）。默认十分钟，再久就不像在聊天了。
export const maxOf = chat => Math.max(0, Math.round(Number(chat?.paceMax) ?? 600) || 0);

export function setPace(chatId, patch) {
  const next = {};
  if (patch.base !== undefined) next.paceBase = Math.max(0, Math.round(Number(patch.base) || 0));
  if (patch.max !== undefined) next.paceMax = Math.max(0, Math.round(Number(patch.max) || 0));
  chats.update(chatId, next);
}

// 时段的倍数。深夜她多半睡了，白天最快。
const SLOT_MUL = { night: 5, morning: 1.6, noon: 1.2, afternoon: 1, evening: 1 };

/**
 * 这一条该等多久，单位秒。
 *
 * 四件事相乘，全都是本地读得到的：
 *   **几点了** 深夜慢五倍，白天最快；
 *   **她这会儿有没有事** 当前时段排了日程就慢一倍（见 4.83）；
 *   **运势** 走背字的时候懒得回，慢一点（见 4.82）；
 *   **这条要紧不要紧** 带问号、或者写得长，回得快一些。
 * 最后再乘一个抖动，免得每次都是同一个数。
 *
 * 「要紧不要紧」只看标点和长度，很粗 —— 但它要防的是「每条都一样快」，
 * 而不是真去理解这句话，那是模型的活，不是这儿的。
 */
export function delayFor(chatId, text = '', { rng = Math.random, at } = {}) {
  const chat = chats.get(chatId);
  if (!chat) return 0;
  const char = characters.get((chat.characterIds || [])[0]);
  let secs = baseOf(chat);

  const now = at || clock.now();
  secs *= SLOT_MUL[day.slotNow(char, now).id] ?? 1;

  const brief = char ? day.brief(char.id, now) : null;
  if (brief && brief.nowItems.length) secs *= 2;

  const luck = events.luckOf(char);
  if (luck < -0.4) secs *= 1.3;

  const t = String(text || '');
  if (/[?？]/.test(t)) secs *= 0.5;
  else if (t.length >= 30) secs *= 0.7;

  secs *= 0.6 + rng();            // 0.6 ~ 1.6 倍
  const cap = maxOf(chat);
  const out = Math.round(Math.max(1, secs));
  return cap ? Math.min(cap, out) : out;
}

// ---- 待回复 ----
//
// 记在会话上，不是记在内存里：页面一关内存就没了，而「她该回了」
// 这件事不该因为你退出去看了眼别的 app 就取消。

export const pendingOf = chat => (chat?.pacePending?.dueAt ? chat.pacePending : null);

export function schedule(chatId, text, opts = {}) {
  const chat = chats.get(chatId);
  if (!chat) return null;
  const secs = delayFor(chatId, text, opts);
  const dueAt = Date.now() + secs * 1000;
  chats.update(chatId, { pacePending: { dueAt, secs } });
  return { dueAt, secs };
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
