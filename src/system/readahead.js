import { ebooks, characters, settings } from './db/index.js';

// 让一个角色先往前读。
//
// 你选「从这里起注入 N 字」，把那一段交给它读一遍；它自己挑哪几段值得开口，
// 留下段评。你读到那儿才看见气泡 —— 它不会跑到你面前来说话。
//
// **一本书同时只有一个先读的角色。** 弹窗里那句「TA 已经看完了」要指得明确，
// 几个人各读到不同位置，这句话就没法说了。多人共读是另一回事：
// 那是「大家现在评这一段」，不是「一个人往前读」。
//
// 自动续读有两道闸：一是你得先在弹窗里选「一直继续」（默认每次都问），
// 二是**续读次数有上限**，到顶就停下来再问一次。不能一直注入一直花钱。

export const DEFAULT_CHARS = 6000;
export const DEFAULT_RUNS = 3;

/** 一次注入多少字。0 表示一直读到书末。 */
export function chars() {
  const v = Number(settings.get().injectChars);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : DEFAULT_CHARS;
}

/** 最多自动续几次。0 表示不自动续，每次都问。 */
export function maxRuns() {
  const v = Number(settings.get().injectMaxRuns);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : DEFAULT_RUNS;
}

const raw = bookId => ebooks.get(bookId)?.readAhead || null;

/** 谁在先读、读到哪儿、已经自动续了几次。没有就是 null。 */
export function stateOf(bookId) {
  const r = raw(bookId);
  if (!r?.charId) return null;
  const char = characters.get(r.charId);
  if (!char) return null;
  return {
    charId: r.charId, char,
    at: Math.max(0, Number(r.at) || 0),
    runs: Math.max(0, Number(r.runs) || 0),
    always: r.always === true,
  };
}

const write = (bookId, patch) => ebooks.update(bookId, {
  readAhead: { ...(raw(bookId) || {}), ...patch },
});

/** 换一个角色先读，或者头一次开始。读到哪儿从当前位置算起。 */
export const begin = (bookId, charId, from = 0) =>
  write(bookId, { charId, at: Math.max(0, Math.round(from) || 0), runs: 0, always: false });

/** 又读完一段。手动那次不计进自动次数。 */
export const advance = (bookId, to, { auto = false } = {}) => {
  const r = raw(bookId) || {};
  write(bookId, {
    at: Math.max(0, Math.round(to) || 0),
    runs: auto ? (Number(r.runs) || 0) + 1 : 0,
  });
};

export const setAlways = (bookId, v) => write(bookId, { always: v === true });

export const stop = bookId => ebooks.update(bookId, { readAhead: null });

/** 你有没有追上它。追上了才该弹那个窗。 */
export function caughtUp(bookId, youAt, span) {
  const s = stateOf(bookId);
  if (!s) return false;
  return youAt + span >= s.at;
}

/** 还能不能自动续。选了「一直继续」也仍然受次数上限约束。 */
export function canAuto(bookId) {
  const s = stateOf(bookId);
  if (!s || !s.always) return false;
  const cap = maxRuns();
  return cap > 0 && s.runs < cap;
}

/** 到顶了没有。到顶要把话说清楚，不能悄悄不动。 */
export function hitCap(bookId) {
  const s = stateOf(bookId);
  return !!s && s.always && s.runs >= maxRuns();
}
