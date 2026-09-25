import { createStore } from './store.js';
import { chats, characters, messages, songs, files, settings } from './db/index.js';
import * as music from './music.js';
import * as netease from './netease.js';

// 一起听。
//
// 和通话不一样，它是**边聊边听**的：不另起一个页面把会话盖住，只在会话顶上
// 加一条播放条。听歌本来就是背景，两个人该聊什么还聊什么。
//
// 统计分两层：
//   **本次** 这一场听了多久、几首，存在这个 store 里，挂断就结算；
//   **累积** 这段关系一共听了多久、几首，累加在 chat 上，不会因为结束而清零。
// 结算时落一条 kind: 'listen' 的记录，正文里带着这一场的曲目 ——
// 情侣空间要的就是这些记录，不必另建一张表。

export const listen = createStore({
  active: false,
  chatId: '',
  charId: '',
  listId: '',          // 从哪个歌单起的头，空表示单曲
  songId: '',
  playing: false,
  at: 0,               // 当前这首播到第几秒
  seconds: 0,          // 本场累计听了多久
  count: 0,            // 本场听完/切过的曲目数
  played: [],          // 本场的曲目 id，按先后
  error: '',
});

let audio = null;
let tick = null;
let songSec = 0;          // 这一首自己放了多久，打卡要用

// 放够这么久才算「听过」。网易云自己的客户端也是放一会儿才打卡，
// 刚点开就切走的那种不该记进听歌记录。用户可以改，填 0 就是一放就打卡。
const scrobbleAfter = () => Math.max(0, settings.get().scrobbleAfter || 0);

// 给两个号各打一次卡。不 await —— 打卡慢一点不该让换歌卡住。
function scrobbleNow(song, seconds, charId) {
  if (!song || song.source !== 'netease' || !song.neteaseId) return;
  const after = scrobbleAfter();
  if (after && seconds < Math.min(after, song.seconds || after)) return;
  netease.scrobble(song.neteaseId, seconds, charId).catch(() => {});
}

export function playing() { return listen.get().active; }
export function inChat(chatId) { return listen.get().active && listen.get().chatId === chatId; }

export function current() {
  const s = listen.get();
  return s.songId ? songs.get(s.songId) : null;
}

// 累积统计挂在会话上。一起听是两个人的事，属于这段关系，不属于某一场。
export function totals(chatId) {
  const c = chats.get(chatId);
  return { seconds: c?.listenSeconds || 0, count: c?.listenCount || 0 };
}

export function fmt(sec) {
  const n = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h) return `${h} 小时 ${m} 分`;
  if (m) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

export function clock(sec) {
  const n = Math.max(0, Math.round(sec || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

// ---- 播放 ----
async function srcOf(song) {
  if (!song) return '';
  if (song.url) return song.url;
  if (song.audioId) return (await files.url(song.audioId)) || '';
  // 网易云那边的地址会过期，所以不入库，每次现取
  if (song.source === 'netease' && song.neteaseId && netease.ready()) {
    return netease.songUrl(song.neteaseId).catch(err => {
      listen.set({ error: String(err.message || err) });
      return '';
    });
  }
  return '';
}

function stopAudio() {
  // 走之前先把这一首的卡打了
  const s = listen.get();
  if (s.songId) scrobbleNow(songs.get(s.songId), songSec, s.charId);
  songSec = 0;
  if (audio) { try { audio.pause(); } catch { /* 已经停了 */ } audio = null; }
  clearInterval(tick); tick = null;
}

async function load(songId, autoplay = true) {
  const song = songs.get(songId);
  if (!song) { listen.set({ error: '这首歌已经不在曲库里了' }); return; }
  stopAudio();
  // **先同步把「现在是这一首」记下来**，再去解地址。取本地文件的地址是异步的，
  // 等它回来才更新的话，中间那一下界面上是一场没有歌的一起听，
  // next() 这时候也找不到自己在队列里的位置。
  listen.set({ songId, at: 0, error: '', blocked: false });

  const src = await srcOf(song);
  if (!src) { listen.set({ error: '这首歌没有可播放的音频' }); return; }
  // 解地址的工夫里可能已经又切走了，那这一份就作废
  if (listen.get().songId !== songId) return;

  audio = new Audio(src);
  audio.onended = () => next();
  audio.onerror = () => listen.set({ playing: false, error: '这首歌放不出来，检查一下地址' });

  if (autoplay) {
    try { await audio.play(); listen.set({ playing: true }); }
    catch { listen.set({ playing: false, blocked: true, error: '浏览器拦下了自动播放，点此继续播放' }); }
  }
  // 秒表只在真的在放的时候走 —— 暂停的时间不算进一起听的时长
  tick = setInterval(() => {
    if (!audio || audio.paused) return;
    const s = listen.get();
    songSec += 1;
    listen.set({ at: Math.round(audio.currentTime || 0), seconds: s.seconds + 1 });
  }, 1000);
}

function queue() {
  const s = listen.get();
  return s.listId ? music.tracksOf(s.listId).map(t => t.id) : [s.songId].filter(Boolean);
}

export function next() {
  const s = listen.get();
  const q = queue();
  const i = q.indexOf(s.songId);
  // 同一首不重复记数：来回切上一首下一首时，听过的那份不该越滚越多
  const done = s.songId && !s.played.includes(s.songId) ? [...s.played, s.songId] : s.played;
  // 当前这首根本不在队列里（角色临时点的一首歌），放完就停下，
  // 不要莫名其妙跳回歌单第一首去
  const nextId = i < 0 ? null : q[i + 1];
  listen.set({ played: done, count: done.length });
  if (nextId) load(nextId);
  else { stopAudio(); listen.set({ playing: false }); }
}

export function prev() {
  const q = queue();
  const i = q.indexOf(listen.get().songId);
  if (i > 0) load(q[i - 1]);
}

/**
 * 精确到小数的位置。「正在播放」那一页逐句高亮歌词用 ——
 * at 一秒才更新一次还取了整，拿它对歌词每句都慢半拍
 */
export function position() { return audio ? audio.currentTime : listen.get().at; }

/** 这一首多长。音频读得出来的优先，读不出来用曲库里记的 */
export function duration() {
  const d = audio?.duration;
  return Number.isFinite(d) && d > 0 ? d : (current()?.seconds || 0);
}

/** 跳到第几秒。拖进度条、点一句歌词都走这里 */
export function seek(sec) {
  if (!audio) return;
  audio.currentTime = Math.max(0, Math.min(sec, audio.duration || sec));
  listen.set({ at: Math.round(audio.currentTime) });
}

// 被浏览器拦下的那一次：人点一下之后就放得出来了。**那一行提示要跟着清掉**，
// 从前只改了 playing，「被拦下了」一直挂在播放条上，歌词永远轮不到显示
export function toggle() {
  if (!audio) return;
  if (audio.paused) {
    audio.play()
      .then(() => listen.set({ playing: true, blocked: false, error: '' }))
      .catch(() => listen.set({ playing: false, blocked: true, error: '浏览器拦下了自动播放，点此继续播放' }));
    listen.set({ playing: true });
  } else { audio.pause(); listen.set({ playing: false }); }
}

// ---- 开场与收场 ----
/**
 * 开一场。
 *
 * autoplay 为假时只把场子支起来，不出声 —— 角色主动拉你听歌走的就是这条：
 * 没有用户动作，浏览器本来也不让自动播，与其弹一个「被拦下了」的错，
 * 不如老老实实停在那儿等人按播放。
 */
export function start({ chatId, listId = '', songId = '', autoplay = true }) {
  const chat = chats.get(chatId);
  const char = characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char) throw new Error('会话或角色不存在');
  if (char.canListen === false) throw new Error('该角色未开启一起听');

  // 没指定就自己挑：先看这个角色自己的歌单，再看用户的，最后退到曲库最新一首
  let list = listId;
  let first = songId || music.tracksOf(list)[0]?.id;
  if (!first) {
    const mine = music.allLists(char.id).find(p => (p.trackIds || []).length)
      || music.allLists(music.LIB_OWNER).find(p => (p.trackIds || []).length);
    if (mine) { list = mine.id; first = mine.trackIds[0]; }
  }
  if (!first) first = music.allSongs()[0]?.id;
  if (!first) throw new Error('曲库里还没有歌。可以在「一起听」中搜索网易云，或打开自己的网易云歌单');

  listen.set({
    active: true, chatId, charId: char.id, listId: list, songId: '',
    playing: false, at: 0, seconds: 0, count: 0, played: [], error: '',
  });
  load(first, autoplay);
  return true;
}

// ---- 曲库空着也起得来（接网易云） ----
//
// 只用网易云的人，本机曲库常常是空的。从前那样 start 直接报「曲库里还没有歌」，
// 角色写 [一起听] 起不来，它后面那句 [点歌] 也就跟着落空。
// 所以本机挑不出第一首时，去网易云拿一首：刚听过的，没有就取自己第一个歌单的第一首。

async function firstFromNetease() {
  if (!netease.ready() || !netease.cookieOf()) return null;
  try {
    const r = await netease.recent('', 1);
    if (r.songs?.[0]) return music.fromNetease(r.songs[0]);
  } catch { /* 这个号没有听歌记录，走下一条 */ }
  try {
    const lists = await netease.playlistsOf('');
    for (const p of lists.slice(0, 3)) {
      const t = (await netease.playlistTracks(p.id, 1))[0];
      if (t) return music.fromNetease(t);
    }
  } catch { /* 取不到歌单 */ }
  return null;
}

const hasLocal = char => !!(music.allSongs().length
  || music.allLists(char?.id).some(p => (p.trackIds || []).length));

/** 起一场一起听。本机挑不出歌时从网易云拿一首（角色写 [一起听] 走这里） */
export async function startAnywhere({ chatId, autoplay = true }) {
  const chat = chats.get(chatId);
  const char = characters.get((chat?.characterIds || [])[0]);
  if (hasLocal(char)) return start({ chatId, autoplay });
  const song = await firstFromNetease();
  return start({ chatId, songId: song ? song.id : '', autoplay });
}

/**
 * 打开自己的网易云歌单一起听：歌单里的歌收进曲库（只存歌名与网易云 id，不存播放地址），
 * 本机建一个同名歌单（已有就补齐），从第一首放起。正在一起听就只换歌单与这一首
 */
export async function startNeteaseList({ chatId, id, name }) {
  const tracks = await netease.playlistTracks(id);
  if (!tracks.length) throw new Error('这个歌单里没有能放的歌');
  const list = music.listNamed(music.LIB_OWNER, name || '网易云歌单');
  const ids = tracks.map(t => music.fromNetease(t).id);
  ids.forEach(sid => music.addTrack(list.id, sid));
  if (listen.get().active && listen.get().chatId === chatId) {
    listen.set({ listId: list.id });
    play(ids[0]);
    return list;
  }
  start({ chatId, listId: list.id, songId: ids[0] });
  return list;
}

// 换一首。角色点歌走的也是这里。
export function play(songId) {
  if (!listen.get().active) return false;
  const s = listen.get();
  if (s.songId && s.songId !== songId && !s.played.includes(s.songId)) {
    const done = [...s.played, s.songId];
    listen.set({ played: done, count: done.length });
  }
  load(songId);
  return true;
}

export function stop() {
  const s = listen.get();
  if (!s.active) return null;
  const played = s.songId && !s.played.includes(s.songId) ? [...s.played, s.songId] : s.played;
  stopAudio();

  const chat = chats.get(s.chatId);
  const char = characters.get(s.charId);
  let record = null;
  if (chat && char && (s.seconds > 0 || played.length)) {
    const names = played.map(id => music.label(songs.get(id))).filter(Boolean);
    // 累积统计加在会话上，不因为这一场结束而清零
    chats.update(chat.id, {
      listenSeconds: (chat.listenSeconds || 0) + s.seconds,
      listenCount: (chat.listenCount || 0) + played.length,
      lastMessageAt: Date.now(),
    });
    // 歌单同步。默认不开 —— 往用户真实的歌单里写东西是件重的事。
    const neteaseIds = played
      .map(id => songs.get(id))
      .filter(x => x && x.source === 'netease' && x.neteaseId)
      .map(x => x.neteaseId);
    if (neteaseIds.length) {
      netease.syncPlaylist(neteaseIds, char.id, `和${char.name || '她'}一起听`).catch(() => {});
    }
    record = messages.create({
      chatId: chat.id, kind: 'listen',
      role: 'user', authorId: 'me',
      seconds: s.seconds, trackIds: played,
      content: `[一起听了 ${fmt(s.seconds)}，${played.length} 首]`
        + (names.length ? '\n' + names.join('、') : ''),
      status: 'done',
    });
  }
  listen.set({
    active: false, chatId: '', charId: '', listId: '', songId: '',
    playing: false, at: 0, seconds: 0, count: 0, played: [], error: '',
  });
  return record;
}

// 这一场的歌词现在唱到哪一句，给界面显示
export function lyricNow() {
  const song = current();
  if (!song || !song.lyric) return '';
  return music.lyricAt(music.parseLyric(song.lyric), listen.get().at);
}
