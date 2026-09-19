import { createStore } from './store.js';
import { chats, characters, messages, settings } from './db/index.js';
import * as video from './video.js';
import * as subtitle from './subtitle.js';
import * as listen from './listen.js';

// 一起看。
//
// **诚实地说，这是「她陪你看」，不是两块屏幕对时间。** 角色那边没有第二个
// 播放器，所谓一起，发生的地方就是你这一台设备。所以这里不做房间、不做同步，
// 只做一件事：把「现在演到哪儿、刚说了什么」摆到她面前。
//
// 她读到的三样，按贵贱排：
//   **台词**  免费。到此刻为止的最后几句，这是主力。
//   **提纲**  开看前一次性读完整份字幕生成，注入时**只给已经看过的那几段**。
//   **画面**  最贵，这一版不做（见 ARCHITECTURE 里那一节的理由）。
//
// 什么时候该开口，**本地算**：字幕的疏密就是戏的疏密。对手戏正密的时候插话
// 最讨嫌，空窗才是开口的时机。这一判断不花一分钱，见 subtitle.density。

export const watch = createStore({
  active: false,
  chatId: '',
  charId: '',
  videoId: '',
  at: 0,              // 现在播到第几秒
  duration: 0,
  playing: false,
  seconds: 0,         // 这一场看了多久
  saidAt: -1,         // 她上一次开口时片子播到哪儿
  said: 0,
  awayAt: 0,          // 人离开播放页的时刻。0 表示人还在那一屏上
  error: '',
});

let el = null;        // 页面上那个 <video>，由页面挂进来
let tick = null;

export const playing = () => watch.get().active;
export const inChat = chatId => watch.get().active && watch.get().chatId === chatId;

export function current() {
  const s = watch.get();
  return s.videoId ? video.get(s.videoId) : null;
}

/** 这一场的字幕。每次现解析，解析结果不入库。 */
export const lines = () => video.linesOf(current());

/** 开一场。片子放不放得出来由页面负责，这里只管记状态。 */
export function start({ chatId, videoId }) {
  const chat = chats.get(chatId);
  const row = video.get(videoId);
  if (!chat) throw new Error('会话不存在');
  if (!row) throw new Error('这部片已不在片库中');
  if (listen.playing()) listen.stop();   // 两边不同时响

  watch.set({
    active: true,
    chatId,
    charId: (chat.characterIds || [])[0] || '',
    videoId,
    at: 0, duration: row.seconds || 0,
    playing: false, seconds: 0, saidAt: -1, said: 0, awayAt: 0, error: '',
  });
  return row;
}

/** 页面把 <video> 交给这里，标记那几条才控制得到它。 */
export function attach(node) {
  el = node;
  clearInterval(tick);
  if (!el) return;
  watch.set({ awayAt: 0 });
  tick = setInterval(() => {
    if (!el) return;
    const s = watch.get();
    if (!s.active) return;
    watch.set({
      at: Math.round(el.currentTime) || 0,
      duration: Math.round(el.duration) || s.duration,
      playing: !el.paused,
      seconds: el.paused ? s.seconds : s.seconds + 1,
    });
  }, 1000);
}

/**
 * 人离开了播放页。
 *
 * **这一场不就此结束**：中途回一条消息、翻一下资料，回来还要接着看。
 * 但画面确实停了（video 元素跟着页面一起没了），所以状态要如实改成暂停，
 * 并记下离开的时刻 —— prompt 里必须说清楚人不在那一屏上了。
 *
 * 一直不回来的那种由 sweep() 收场：不起定时器，谁来读谁顺手扫一眼。
 */
export function detach() {
  clearInterval(tick); tick = null;
  el = null;
  if (watch.get().active) watch.set({ playing: false, awayAt: Date.now() });
}

// 离开多久就算这一场散了。填 0 表示一直留着，要用户自己点结束。
const awayEnd = () => {
  const n = Math.round(Number(settings.get().watchAwayEnd) ?? 15);
  return Number.isFinite(n) && n >= 0 ? n : 15;
};

/**
 * 人离开太久就替他收场。**不起定时器** —— 这一场只在被读的时候才有意义，
 * 所以谁来读谁顺手扫一眼（context、due 都会先叫它）。
 *
 * 不收场的话，prompt 会一直说「你正在和对方一起看」，而进度冻在离开那一秒。
 * 那和三天前的播放记录写成「正在听」是同一类错。
 */
export function sweep() {
  const s = watch.get();
  if (!s.active || !s.awayAt) return false;
  const mins = awayEnd();
  if (!mins || Date.now() - s.awayAt < mins * 60000) return false;
  stop();
  return true;
}

export function toggle(play) {
  if (!el) return;
  const want = play === undefined ? el.paused : play;
  if (want) el.play().catch(() => watch.set({ error: '浏览器拦下了播放，点一下播放键' }));
  else el.pause();
  watch.set({ playing: want, error: '' });
}

export function seek(sec) {
  if (!el) return;
  const to = Math.max(0, Math.min(Number(sec) || 0, el.duration || Number(sec) || 0));
  el.currentTime = to;
  watch.set({ at: Math.round(to) });
}

/** 她说完一句，记下说的时候播到哪儿。节奏判断要用。 */
export function markSaid() {
  const s = watch.get();
  watch.set({ saidAt: s.at, said: s.said + 1 });
}

const gapOf = () => {
  const n = Math.round(Number(settings.get().watchGap) ?? 90);
  return Number.isFinite(n) && n >= 0 ? n : 90;
};

const lineCount = () => {
  const n = Math.round(Number(settings.get().watchLines) ?? 8);
  return Number.isFinite(n) && n > 0 ? n : 8;
};

/**
 * 现在该不该让她开口。
 *
 * 三个条件一起看：间隔到了没、这一带是不是正演着对手戏、空窗够不够长。
 * 正密的时候要多等一会儿；安静段落可以早一点开口。
 * 间隔填 0 表示不自动开口，只有你说话她才回。
 */
export function due() {
  if (sweep()) return false;
  const s = watch.get();
  const gap = gapOf();
  if (!s.active || !s.playing || !gap) return false;

  const since = s.saidAt < 0 ? s.at : s.at - s.saidAt;
  if (since < gap) return false;

  const d = subtitle.density(lines(), s.at);
  if (d.quiet) return true;                 // 空下来了，正是时候
  if (d.talky) return since >= gap * 2;      // 对手戏正密，再等一轮
  return true;
}

/** 注入用的那一份。context/watch.js 读它。 */
export function context() {
  if (sweep()) return null;
  const s = watch.get();
  if (!s.active) return null;
  const row = current();
  if (!row) return null;

  const all = lines();
  const recent = subtitle.recentLines(all, s.at, lineCount());
  const d = subtitle.density(all, s.at);
  return {
    title: row.title,
    at: s.at,
    stamp: subtitle.stamp(s.at),
    duration: s.duration,
    playing: s.playing,
    hasLines: all.length > 0,
    recent: recent.map(l => l.text),
    outline: video.outlineSoFar(row, s.at),
    quiet: d.quiet,
    talky: d.talky,
    away: !!s.awayAt,
    seen: !!characters.get(s.charId)?.watchedBefore,
  };
}

/** 收场。落一条记录，累积加在会话上。 */
export function stop() {
  const s = watch.get();
  detach();
  if (!s.active) return null;

  const chat = chats.get(s.chatId);
  const row = video.get(s.videoId);
  let record = null;
  if (chat && row && s.seconds > 0) {
    chats.update(chat.id, {
      watchSeconds: (chat.watchSeconds || 0) + s.seconds,
      watchCount: (chat.watchCount || 0) + 1,
      lastMessageAt: Date.now(),
    });
    record = messages.create({
      chatId: chat.id, kind: 'watch', role: 'user', authorId: 'me',
      seconds: s.seconds, videoId: s.videoId, at: s.at,
      content: `[一起看了 ${fmt(s.seconds)}]\n${row.title}　看到 ${subtitle.stamp(s.at)}`,
      status: 'done',
    });
  }
  // 看完自动写一篇。多一次调用，默认关着，开关登记在 ai/cost.js
  if (record) {
    import('./review.js')
      .then(m => m.writeOnFinish({ kind: m.VIDEO, subjectId: s.videoId, charId: s.charId, at: s.at }))
      .catch(() => {});
  }
  watch.set({
    active: false, chatId: '', charId: '', videoId: '',
    at: 0, duration: 0, playing: false, seconds: 0, saidAt: -1, said: 0,
    awayAt: 0, error: '',
  });
  return record;
}

/** 这段会话一共一起看了多久。 */
export function totals(chatId) {
  const chat = chats.get(chatId);
  return { seconds: chat?.watchSeconds || 0, count: chat?.watchCount || 0 };
}

export function fmt(sec) {
  const n = Math.max(0, Math.round(sec) || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h) return `${h} 小时 ${m} 分钟`;
  if (m) return `${m} 分钟`;
  return `${n} 秒`;
}
