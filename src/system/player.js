import { createStore } from './store.js';
import { settings } from './db/index.js';
import * as netease from './netease.js';
import * as listen from './listen.js';

// 音乐 app 自己的播放器。
//
// 和「一起听」分两套：那一个绑在某段会话上，两个人共用一条进度，结束时还要
// 记一笔时长；这一个是自己听自己的，不关任何角色的事。
// 两边不同时响 —— 这边一开，先把那边停掉。
//
// 队列里放的是曲目对象（id / title / artist / cover / seconds），**不入库**：
// 播放地址会过期，每次要放的时候现取（netease.songUrl）。想把某一首留下来，
// 走曲库那个入口（music.fromNetease），那是另一件事。
//
// 放够一定时长给网易云打一次卡。「我的」那一页上的听歌排行与累计首数，
// 读的就是这个数 —— 在这儿听的歌会真的记进账号，和在客户端里听是一回事。

export const player = createStore({
  queue: [],          // 当前这一列曲目
  index: -1,          // 放到第几首
  playing: false,
  seconds: 0,         // 这一首放到第几秒
  duration: 0,
  loading: false,
  error: '',
});

let audio = null;
let tick = null;
let played = 0;       // 这一首实际响了多久，打卡用

const scrobbleAfter = () => Math.max(0, settings.get().scrobbleAfter || 0);

export function current() {
  const s = player.get();
  return s.queue[s.index] || null;
}

// 收掉当前这个 audio。**先摘掉回调再动 src** —— 把 src 设成空串本身会让
// 浏览器在这个元素上再抛一次 error，回调还挂着的话，换一首歌就会闪一句
// 「这首歌放不出来」，而那一首其实好好的。
function clear() {
  clearInterval(tick); tick = null;
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.onloadedmetadata = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio = null;
}

// 打一次卡。不 await：网络慢不该让换歌跟着卡住。
function scrobble(track, seconds) {
  if (!track || !track.id || seconds <= 0) return;
  const after = scrobbleAfter();
  if (after && seconds < Math.min(after, track.seconds || after)) return;
  netease.scrobble(track.id, seconds).catch(() => {});
}

async function load(autoplay) {
  const track = current();
  clear();
  if (!track) return;

  player.set({ loading: true, error: '', seconds: 0, duration: track.seconds || 0 });
  played = 0;

  let src = '';
  try { src = await netease.songUrl(track.id); }
  catch (err) { player.set({ loading: false, playing: false, error: String(err.message || err) }); return; }

  // 取地址的工夫里可能已经切走了，那这一份就作废
  if (current()?.id !== track.id) return;

  audio = new Audio(src);
  audio.onended = () => { scrobble(track, played); next(); };
  audio.onerror = () => player.set({ playing: false, loading: false, error: '这首歌放不出来' });
  audio.onloadedmetadata = () => {
    if (audio && audio.duration && Number.isFinite(audio.duration)) {
      player.set({ duration: Math.round(audio.duration) });
    }
  };

  tick = setInterval(() => {
    if (!audio) return;
    if (!audio.paused) played += 1;
    player.set({ seconds: Math.round(audio.currentTime) });
  }, 1000);

  player.set({ loading: false });
  if (autoplay) {
    try { await audio.play(); player.set({ playing: true }); }
    catch { player.set({ playing: false, error: '浏览器拦下了自动播放，点一下播放键' }); }
  }
}

/** 放一列歌，从第 index 首开始。开这边就把「一起听」停掉。 */
export function play(queue, index = 0) {
  const list = (queue || []).filter(t => t && t.id);
  if (!list.length) return;
  if (listen.playing()) listen.stop();
  player.set({ queue: list, index: Math.max(0, Math.min(index, list.length - 1)) });
  load(true);
}

/** 放一首。当前队列里有这一首就跳过去，没有就单独起一列。 */
export function playOne(track) {
  if (!track || !track.id) return;
  const { queue } = player.get();
  const at = queue.findIndex(t => t.id === track.id);
  if (at >= 0) { player.set({ index: at }); if (listen.playing()) listen.stop(); load(true); return; }
  play([track], 0);
}

export function toggle() {
  if (!audio) { if (current()) load(true); return; }
  if (audio.paused) {
    audio.play().then(() => player.set({ playing: true }))
      .catch(() => player.set({ playing: false, error: '浏览器拦下了播放，再点一次' }));
  } else {
    audio.pause();
    player.set({ playing: false });
  }
}

export function next() {
  const s = player.get();
  if (!s.queue.length) return;
  scrobble(current(), played);
  const at = s.index + 1;
  // 放到头了就停在最后一首上，不清队列 —— 队列一清底部那条就消失，
  // 刚听完的是哪一首也跟着没了。要从头再放，点一下播放键就是。
  if (at >= s.queue.length) { clear(); player.set({ playing: false, seconds: 0 }); return; }
  player.set({ index: at });
  load(true);
}

export function prev() {
  const s = player.get();
  if (!s.queue.length) return;
  // 放过三秒就是「从头再来」，不是「上一首」。客户端都是这个规矩。
  if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
  player.set({ index: Math.max(0, s.index - 1) });
  load(true);
}

export function seek(sec) {
  if (!audio) return;
  audio.currentTime = Math.max(0, Math.min(sec, audio.duration || sec));
  player.set({ seconds: Math.round(audio.currentTime) });
}

export function stop() {
  scrobble(current(), played);
  clear();
  player.set({ queue: [], index: -1, playing: false, seconds: 0, duration: 0, loading: false });
}

/** 秒数写成 3:07。时长为 0 时给 --:--，不假装知道。 */
export function fmt(sec) {
  const n = Math.max(0, Math.round(sec) || 0);
  if (!n) return '--:--';
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** 累计时长写成「1 天 3 小时」这种。给「我的」那一页用。 */
export function hoursText(sec) {
  const n = Math.max(0, Math.round(sec) || 0);
  if (!n) return '0 分钟';
  const d = Math.floor(n / 86400);
  const h = Math.floor((n % 86400) / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分钟`;
  return `${m} 分钟`;
}
