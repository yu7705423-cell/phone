import { baseOf } from './ai/url.js';
import { neteaseConfig, setNetease, neteaseReady } from './ai/services.js';
import { characters } from './db/index.js';

// 网易云。接的是**自己部署的** NeteaseCloudMusicApi，地址在设置里填。
//
// 为什么不内置：那个服务要跑 Node，浏览器里起不来。而且所有人共用一个出口 IP
// 会被网易云限流 —— 谁想用谁自己部署一份，地址也就只能是个设置项。
//
// **两个账号**。用户自己的号存在设置里，角色那个号（其实是用户的第二个号）
// 存在角色卡上。这个接口支持把 cookie 当查询参数逐次传进去，所以两个号可以
// 在同一台设备上各走各的，不需要来回登录。
//
// 关于「一起听」：网易云自己那个一起听是**要双方在线的实时房间**，角色那边
// 没有第二个客户端，房开了也没人进。所以这里做的是**让两个号的听歌数据都真的
// 动**：同一首歌给两个号各打一次卡，听过的歌进各自那个「和 XX 一起听」歌单。
// 这是这个场景下「真的一起听」唯一落得了地的含义。
//
// **cookie 就是账号权限**，比接口密钥还敏感，只存在这台设备的浏览器里。
// 登录页把这句话直说，不替用户含糊。


function base() {
  const b = baseOf(neteaseConfig().baseUrl);
  if (!b) throw new Error('还没有填写音乐接口地址');
  return b;
}

// 每次都带 timestamp，否则接口那边会给缓存过的结果（登录状态尤其怕这个）
async function call(path, params = {}, cookie = '') {
  const url = new URL(base() + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  url.searchParams.set('timestamp', String(Date.now()));
  if (cookie) url.searchParams.set('cookie', cookie);

  const res = await fetch(url.toString(), { method: 'GET' });
  let body = null;
  try { body = await res.json(); } catch { /* 有些错误页不是 JSON */ }
  if (!res.ok) {
    throw new Error(`音乐接口 ${res.status}: ${body?.message || body?.msg || res.statusText}`);
  }
  return body || {};
}

export function ready() { return neteaseReady(); }

// ---- 登录。只做扫码：手机号那条路要用户把密码交出来，不做。 ----
export async function qrStart() {
  const key = (await call('/login/qr/key')).data?.unikey;
  if (!key) throw new Error('接口没有返回二维码 key');
  const made = await call('/login/qr/create', { key, qrimg: true });
  return { key, img: made.data?.qrimg || '', url: made.data?.qrurl || '' };
}

// 800 过期 · 801 等待扫码 · 802 已扫待确认 · 803 成功
export async function qrCheck(key) {
  const r = await call('/login/qr/check', { key });
  return { code: r.code, message: r.message || '', cookie: r.cookie || '' };
}

export async function accountOf(cookie) {
  const r = await call('/user/account', {}, cookie);
  const p = r.profile || {};
  return { uid: p.userId ? String(p.userId) : '', nickname: p.nickname || '', avatar: p.avatarUrl || '' };
}

// 登录成功之后把凭据落到该落的地方：不给 charId 就是用户自己的号
export async function saveLogin(cookie, charId = '') {
  const who = await accountOf(cookie);
  if (charId) {
    characters.update(charId, {
      neteaseCookie: cookie, neteaseNick: who.nickname, neteaseUid: who.uid,
    });
  } else {
    setNetease({ cookie, nickname: who.nickname, uid: who.uid });
  }
  return who;
}

export function logout(charId = '') {
  if (charId) characters.update(charId, { neteaseCookie: '', neteaseNick: '', neteaseUid: '' });
  else setNetease({ cookie: '', nickname: '', uid: '' });
}

export function cookieOf(charId = '') {
  if (!charId) return neteaseConfig().cookie || '';
  return characters.get(charId)?.neteaseCookie || '';
}

// 这一次动作要落到哪几个号上。两个号都登了就都落，只登一个就落一个。
export function accounts(charId) {
  const list = [];
  const mine = cookieOf();
  const hers = cookieOf(charId);
  if (mine) list.push({ cookie: mine, charId: '' });
  if (hers && hers !== mine) list.push({ cookie: hers, charId });
  return list;
}

// 这个号的 uid。登录时存过就用存的，没存过现问一次。
export async function uidOf(charId = '') {
  const saved = charId ? characters.get(charId)?.neteaseUid : neteaseConfig().uid;
  if (saved) return String(saved);
  const cookie = cookieOf(charId);
  if (!cookie) return '';
  return (await accountOf(cookie)).uid;
}

// ---- 个人主页那一页要的东西 ----
//
// 这些数字都是**网易云那边算好的**，这里只读不算：听歌总数是 listenSongs，
// 排行是 /user/record 的 playCount。自己再拿播放记录去累加会和客户端里
// 显示的对不上，而对得上正是这一页存在的理由。

export async function profile(charId = '') {
  const cookie = cookieOf(charId);
  const uid = await uidOf(charId);
  if (!uid) throw new Error('还没有登录音乐账号');
  const r = await call('/user/detail', { uid }, cookie);
  const p = r.profile || {};
  return {
    uid: String(p.userId || uid),
    nickname: p.nickname || '',
    avatar: p.avatarUrl || '',
    cover: p.backgroundUrl || '',
    signature: p.signature || '',
    level: Number(r.level || 0) || 0,
    listenSongs: Number(r.listenSongs || 0) || 0,
    createDays: Number(r.createDays || 0) || 0,
    follows: Number(p.follows || 0) || 0,
    followeds: Number(p.followeds || 0) || 0,
  };
}

// type 1 = 最近一周，0 = 所有时间。两边的结构一样，只是字段名不同。
export async function record(charId = '', { week = true, limit = 0 } = {}) {
  const cookie = cookieOf(charId);
  const uid = await uidOf(charId);
  if (!uid) throw new Error('还没有登录音乐账号');
  const r = await call('/user/record', { uid, type: week ? 1 : 0 }, cookie);
  const rows = (week ? r.weekData : r.allData) || r.weekData || r.allData || [];
  const list = rows.map(row => {
    const song = row.song || {};
    return {
      ...songOf(song),
      count: Number(row.playCount || 0) || 0,
      score: Number(row.score || 0) || 0,
      seconds: Math.round(Number(song.dt || song.duration || 0) / 1000) || 0,
      album: song.al?.name || song.album?.name || '',
      cover: song.al?.picUrl || '',
    };
  }).filter(x => x.id && x.title);
  return limit > 0 ? list.slice(0, limit) : list;
}

// 这个号的歌单。创建的排在前面，收藏的排在后面，网易云自己也是这个顺序。
export async function playlistsOf(charId = '') {
  const cookie = cookieOf(charId);
  const uid = await uidOf(charId);
  if (!uid) throw new Error('还没有登录音乐账号');
  const r = await call('/user/playlist', { uid, limit: 200 }, cookie);
  return (r.playlist || []).map(p => ({
    id: String(p.id),
    name: p.name || '',
    cover: p.coverImgUrl || '',
    count: Number(p.trackCount || 0) || 0,
    mine: String(p.userId || '') === String(uid),
    played: Number(p.playCount || 0) || 0,
  }));
}

// 歌单里的歌。/playlist/track/all 拿得到全部，老一点的部署退回 /playlist/detail。
export async function playlistTracks(id, limit = 0) {
  const cookie = cookieOf();
  try {
    const r = await call('/playlist/track/all', { id, limit: limit || 1000 }, cookie);
    const list = (r.songs || []).map(trackOf).filter(x => x.id && x.title);
    if (list.length) return list;
  } catch { /* 走下一条 */ }
  const r = await call('/playlist/detail', { id }, cookie);
  return ((r.playlist?.tracks) || []).map(trackOf).filter(x => x.id && x.title);
}

const trackOf = s => ({
  id: String(s.id || ''),
  title: s.name || '',
  artist: (s.ar || s.artists || []).map(a => a.name).filter(Boolean).join('、'),
  album: s.al?.name || s.album?.name || '',
  cover: s.al?.picUrl || s.album?.picUrl || '',
  seconds: Math.round(Number(s.dt || s.duration || 0) / 1000) || 0,
});

// ---- 曲库 ----
export async function search(keywords, limit = 20) {
  const r = await call('/search', { keywords, limit }, cookieOf());
  return (r.result?.songs || []).map(trackOf).filter(x => x.id && x.title);
}

// 播放地址是**会过期的**，所以不入库，每次要放的时候现取。
export async function songUrl(id, cookie = cookieOf()) {
  const r = await call('/song/url/v1', { id, level: 'standard' }, cookie)
    .catch(() => call('/song/url', { id }, cookie));   // 老一点的部署没有 v1
  const row = (r.data || [])[0];
  if (!row || !row.url) throw new Error('这首歌取不到播放地址，可能需要会员或版权受限');
  return row.url;
}

export async function lyric(id) {
  const r = await call('/lyric', { id });
  return r.lrc?.lyric || '';
}

// ---- 她在听什么 ----
//
// 电脑上用角色那个号登着真正的网易云客户端，放的每一首都会记进那个账号。
// 这里把它读回来，写进上下文。于是「你在听什么」这句话的答案是真的。
//
// 上面那句「角色那边没有第二个客户端」写得太早了：**用户自己就是那个客户端**。
//
// 两条路，按能拿到的信息从多到少试：
//   /record/recent/song   最近播放，带时间戳，能说出「刚刚在听」
//   /user/record          本周听歌排行，没有时间戳，只能说「最近常听」
// 两条都没有就是这份部署不支持，界面上直说，不假装有。

const songOf = s => ({
  id: String(s.id || s.songId || ''),
  title: s.name || s.title || '',
  artist: (s.ar || s.artists || []).map(a => a.name).filter(Boolean).join('、'),
});

export async function recent(charId, limit = 5) {
  const cookie = cookieOf(charId);
  if (!cookie) throw new Error(charId ? '这个角色还没有登录音乐账号' : '还没有登录音乐账号');
  const n = Math.max(1, Math.round(limit) || 5);

  // 带时间戳的那条路
  try {
    const r = await call('/record/recent/song', { limit: n }, cookie);
    const list = (r.data?.list || []).map(row => ({
      ...songOf(row.data || row.song || row),
      at: Number(row.playTime || row.time || 0) || 0,
    })).filter(x => x.id && x.title);
    if (list.length) return { kind: 'recent', songs: list.slice(0, n), at: Date.now() };
  } catch { /* 这份部署没有这个接口，走下一条 */ }

  // 退回排行榜。没有时间戳，所以只能说「最近常听」，不能说「刚刚在听」
  const uid = await uidOf(charId);
  if (!uid) throw new Error('取不到这个账号的 uid');
  const r = await call('/user/record', { uid, type: 1 }, cookie);
  const rows = r.weekData || r.allData || [];
  const songs = rows.map(row => songOf(row.song || {})).filter(x => x.id && x.title);
  if (!songs.length) throw new Error('这个账号最近没有听歌记录');
  return { kind: 'week', songs: songs.slice(0, n), at: Date.now() };
}

/** 拉一次并记在角色卡上。上下文那边读的是记下来的这一份，不现拉。 */
export async function pullRecent(charId, limit = 5) {
  const got = await recent(charId, limit);
  characters.update(charId, { nowPlaying: got });
  return got;
}

/**
 * 发消息时顺便看一眼。
 *
 * 不起定时器：不聊天的时候没必要一直压着那个接口。间隔由用户自己填，
 * 填 0 就是只在手动点的时候才拉（见「用量与上限」）。
 * 失败不抛：拉不到就用上一次的，再不行就不注入这一段。
 */
export async function pullIfDue(charId) {
  const gap = Math.max(0, Math.round(Number(neteaseConfig().recentGap) ?? 5) || 0);
  if (!gap || !charId || !cookieOf(charId)) return null;
  const last = characters.get(charId)?.nowPlaying?.at || 0;
  if (Date.now() - last < gap * 60000) return null;
  try { return await pullRecent(charId); } catch { return null; }
}

// ---- 让两个号的数据都真的动 ----
//
// 打卡。网易云自己的客户端放完一首就打一次，听歌记录和年度报告读的就是它。
export async function scrobble(songId, seconds, charId = '') {
  const jobs = accounts(charId).map(a =>
    call('/scrobble', { id: songId, sourceid: songId, time: Math.max(1, Math.round(seconds)) }, a.cookie)
      .catch(err => { console.warn('[netease] 打卡失败:', err.message || err); }));
  await Promise.all(jobs);
}

async function ensureList(cookie, name) {
  const mine = await call('/user/playlist', { uid: (await accountOf(cookie)).uid, limit: 200 }, cookie);
  const found = (mine.playlist || []).find(p => p.name === name);
  if (found) return String(found.id);
  const made = await call('/playlist/create', { name, privacy: 10 }, cookie);
  const id = made.id || made.playlist?.id;
  if (!id) throw new Error('建歌单失败');
  return String(id);
}

// 把这一场听过的歌同步进两个号各自那个歌单。默认不开 ——
// 往用户真实的歌单里写东西是件重的事，得他自己点头。
export async function syncPlaylist(songIds, charId, listName) {
  if (!neteaseConfig().sync || !songIds.length) return;
  const ids = songIds.join(',');
  for (const a of accounts(charId)) {
    try {
      const pid = await ensureList(a.cookie, listName);
      await call('/playlist/tracks', { op: 'add', pid, tracks: ids }, a.cookie);
    } catch (err) {
      console.warn('[netease] 歌单同步失败:', err.message || err);
    }
  }
}
