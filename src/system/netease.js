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

const trim = u => String(u || '').replace(/\/+$/, '');

function base() {
  const b = trim(neteaseConfig().baseUrl);
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

// ---- 曲库 ----
export async function search(keywords, limit = 20) {
  const r = await call('/search', { keywords, limit }, cookieOf());
  return (r.result?.songs || []).map(s => ({
    id: String(s.id),
    title: s.name || '',
    artist: (s.artists || s.ar || []).map(a => a.name).filter(Boolean).join('、'),
    album: s.album?.name || '',
    seconds: Math.round((s.duration || s.dt || 0) / 1000),
  }));
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
