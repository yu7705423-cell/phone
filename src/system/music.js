import { songs, playlists, files, images, messages, chats } from './db/index.js';

// 曲库与歌单。
//
// 这一层是**本地的**：歌是用户自己传进来的，音频要么是一个 URL，要么是一个
// 存在本机的音频文件。为什么不做「只填歌名」那种纯虚拟的歌 —— 因为一起听要
// 真的有东西在响，计时才有意义；光有个名字，两个人对着空气坐着。
//
// 歌词按 LRC 存原文，播放时按时间轴对出当前这一句。对不上就当没有歌词。

export const LIB_OWNER = 'me';

export function allSongs() {
  return songs.all().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function addSong({ title, artist = '', url = '', audioId = null,
                          lyric = '', coverId = null, seconds = 0 }) {
  const t = String(title || '').trim().slice(0, 60);
  if (!t) throw new Error('请填写歌曲名称');
  if (!url && !audioId) throw new Error('请填写播放地址或上传音频文件');
  return songs.create({
    title: t, artist: String(artist || '').trim().slice(0, 40),
    url: String(url || '').trim(), audioId,
    lyric: String(lyric || ''), coverId,
    seconds: Math.max(0, Math.round(seconds) || 0),
    source: 'local',
  });
}

/**
 * 改一首已经在库里的。只改传进来的那几项。
 *
 * 换了音频文件就把旧的那份删掉 —— 文件躺在 IndexedDB 里，没人引用它也不会
 * 自己消失。网易云来的那些只让改歌词：名字、歌手、地址都是那边的，
 * 改了反而对不上。
 */
export function updateSong(id, patch = {}) {
  const song = songs.get(id);
  if (!song) throw new Error('这首歌已不在曲库中');
  const next = {};

  if (song.source === 'netease') {
    if (patch.lyric !== undefined) next.lyric = String(patch.lyric || '');
    return songs.update(id, next);
  }

  if (patch.title !== undefined) {
    const t = String(patch.title).trim().slice(0, 60);
    if (!t) throw new Error('请填写歌曲名称');
    next.title = t;
  }
  if (patch.artist !== undefined) next.artist = String(patch.artist).trim().slice(0, 40);
  if (patch.lyric !== undefined) next.lyric = String(patch.lyric || '');
  if (patch.seconds !== undefined) next.seconds = Math.max(0, Math.round(patch.seconds) || 0);

  if (patch.url !== undefined || patch.audioId !== undefined) {
    const url = String(patch.url ?? song.url ?? '').trim();
    const audioId = patch.audioId !== undefined ? patch.audioId : song.audioId;
    if (!url && !audioId) throw new Error('请填写播放地址或上传音频文件');
    if (patch.audioId !== undefined && song.audioId && song.audioId !== patch.audioId) {
      files.remove(song.audioId);
    }
    next.url = url;
    next.audioId = audioId;
  }
  return songs.update(id, next);
}

// 网易云搜到的一首落进曲库。**不存播放地址** —— 那个地址会过期，
// 每次要放的时候现取（见 listen.srcOf）。
export function fromNetease(track) {
  const exist = songs.all().find(s => s.source === 'netease' && s.neteaseId === track.id);
  if (exist) return exist;
  return songs.create({
    title: String(track.title || '').slice(0, 60),
    artist: String(track.artist || '').slice(0, 40),
    url: '', audioId: null, lyric: '', coverId: null,
    seconds: Math.max(0, Math.round(track.seconds) || 0),
    source: 'netease', neteaseId: String(track.id),
    // 网易云那边的封面网址。不下载存本地：封面只是认歌用的，过期了也就少一张图
    cover: String(track.cover || ''),
  });
}

export function removeSong(id) {
  const s = songs.get(id);
  if (!s) return false;
  if (s.audioId) files.remove(s.audioId);
  if (s.coverId) images.remove(s.coverId);
  // 歌单里那条引用也要拔掉，否则点进去是个空位
  playlists.all().forEach(p => {
    if ((p.trackIds || []).includes(id)) {
      playlists.update(p.id, { trackIds: p.trackIds.filter(x => x !== id) });
    }
  });
  return songs.remove(id);
}

// 曲库里找一首。角色点歌时拿它认领 —— 它只知道歌名，认不认得出全靠这里。
// 先全等，再包含，最后去掉空格再比一次。
export function findSong(name) {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  const flat = s => `${s.title} ${s.artist}`.toLowerCase();
  const tight = t => t.replace(/[\s·・]/g, '');
  const all = allSongs();
  return all.find(s => s.title.toLowerCase() === q)
    || all.find(s => flat(s).includes(q))
    || all.find(s => q.includes(s.title.toLowerCase()) && s.title.length >= 2)
    || all.find(s => tight(flat(s)).includes(tight(q)))
    || null;
}

// ---- 角色找歌 ----
//
// 角色写歌名的样子五花八门：「晴天 - 周杰伦」「晴天 — 周杰伦」「晴天（周杰伦）」
// 「周杰伦《晴天》」「晴天」。拆成歌名与歌手两半，先在曲库里找，找不到而且配了网易云，
// 就去那边搜第一首收进曲库。两处都没有回 null —— 凭空造一首放不出来的歌，
// 界面上只是个哑巴卡片。
export function splitQuery(q) {
  const t = String(q || '').trim();
  let m = t.match(/^(.+?)\s*《(.+?)》\s*$/);
  if (m) return { title: m[2].trim(), artist: m[1].trim() };
  m = t.match(/^《?(.+?)》?\s*[(（](.+?)[)）]\s*$/);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };
  m = t.match(/^《?(.+?)》?\s+[-—–－|｜/]\s*(.+)$/) || t.match(/^《?(.+?)》?\s*[—–－|｜]\s*(.+)$/);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };
  return { title: t.replace(/^《|》$/g, '').trim(), artist: '' };
}

export async function resolveSong(query) {
  const { title, artist } = splitQuery(query);
  if (!title) return null;
  const hit = allSongs().find(s => s.title === title && (!artist || !s.artist || s.artist.includes(artist) || artist.includes(s.artist)))
    || (artist ? null : findSong(title));
  if (hit) return hit;
  // 动态 import：netease 那边走一大串设置，这个文件只管曲库，不背着它
  const ne = await import('./netease.js');
  if (!ne.ready()) return null;
  const rows = await ne.search(artist ? `${title} ${artist}` : title, 5).catch(() => []);
  const pick = rows.find(r => r.title === title) || rows[0];
  return pick ? fromNetease(pick) : null;
}

/**
 * 在会话里分享一首歌。正文写成和角色分享时同一个标记，角色读历史时看到的是
 * 「[分享歌曲：晚风 - 林晚]」，知道是哪一首。
 */
export function share({ chatId, song, role = 'user', authorId = 'me' }) {
  if (!song) throw new Error('没有选择歌曲');
  const q = song.artist ? `${song.title} - ${song.artist}` : song.title;
  const msg = messages.create({
    chatId, role, authorId, kind: 'song', status: 'done',
    songId: song.id, songState: 'done', songQuery: q,
    content: `[分享歌曲：${q}]`,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

/** 某人名下叫这个名字的歌单。没有就建一个 */
export function listNamed(owner, name) {
  const n = String(name || '').trim().slice(0, 40);
  return allLists(owner).find(p => p.name === n) || createList({ name: n, owner });
}

// ---- 歌单 ----
// owner 是 'me' 或某个角色的 id。角色能建自己的歌单，那是它的品味，
// 不该和用户的混在一张表里。
export function allLists(owner) {
  const list = playlists.all().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return owner ? list.filter(p => p.owner === owner) : list;
}

export function createList({ name, owner = LIB_OWNER, trackIds = [] }) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) throw new Error('请填写歌单名称');
  return playlists.create({ name: n, owner, trackIds: [...trackIds] });
}

export function removeList(id) { return playlists.remove(id); }

export function addTrack(listId, songId) {
  const p = playlists.get(listId);
  if (!p || !songs.get(songId)) return false;
  if ((p.trackIds || []).includes(songId)) return false;
  playlists.update(listId, { trackIds: [...(p.trackIds || []), songId] });
  return true;
}


export function tracksOf(listId) {
  const p = playlists.get(listId);
  return (p?.trackIds || []).map(id => songs.get(id)).filter(Boolean);
}

// ---- 歌词 ----
// LRC：每行 [mm:ss.xx] 歌词。一行可能挂好几个时间戳，拆开各算一条。
export function parseLyric(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const words = line.replace(/\[[\d:.]+\]/g, '').trim();
    const stamps = line.match(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g) || [];
    for (const st of stamps) {
      const m = st.match(/\[(\d+):(\d+)(?:[.:](\d+))?\]/);
      if (!m) continue;
      const cs = m[3] ? Number(`0.${m[3]}`) : 0;
      out.push({ at: Number(m[1]) * 60 + Number(m[2]) + cs, text: words });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// 到第几秒了，现在唱到哪一句
export function lyricAt(lines, sec) {
  if (!lines || !lines.length) return '';
  let cur = '';
  for (const l of lines) {
    if (l.at > sec + 0.15) break;
    cur = l.text;
  }
  return cur;
}

export function label(song) {
  if (!song) return '';
  return song.artist ? `${song.title} — ${song.artist}` : song.title;
}
