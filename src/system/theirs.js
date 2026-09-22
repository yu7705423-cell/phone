import { phones, phoneChats, images, characters } from './db/index.js';
import { ICON_MAX, PHOTO_MAX } from './db/images.js';

// 角色手机的数据层。
//
// 一个角色一台，一行装下：锁屏、壁纸、图标、备忘录、浏览记录。
// 那几样都不多，摊成几个域只会多几处要记得登记进备份的地方。
// 会话另算一个域（phoneChats），因为「进去之后再生成」改的正好是一整行。
//
// **这里只管存取，不调接口。** 生成在 ai/tasks/phone.js。

export const get = charId => phones.byIndex(charId)[0] || null;

const blank = charId => ({
  charId,
  lock: null,          // { code, why, hints, src, shown }。空着就按角色卡当场推（localLock）
  wallpaper: null,     // 图片 id。没有就用角色卡的封面
  icons: {},           // appId -> { name, icon }
  notes: [],           // 备忘录
  visits: [],          // 浏览记录
  createdAt: Date.now(),
});

/** 取那一行，没有就建一行。 */
export function ensure(charId) {
  return get(charId) || phones.create(blank(charId));
}

export function set(charId, patch) {
  const row = ensure(charId);
  return phones.update(row.id, patch);
}

// ---- 锁屏 ----
//
// **一台手机不会「还没有密码」。** 点进去看见的第一屏就该是锁屏，不是一页
// 「要不要现在设定一个密码」的设置 —— 那一页把这件事的意思整个抽掉了。
//
// 所以密码**不落库也先有**：没存过的时候按角色卡当场推出来一个（见 localLock），
// 不调接口、不等，进去就能输。存下来的只有两种情况：问过一条提示（要记住
// 问到第几条了），或者在「生成内容」里让模型重新定过一个。
//
// 密码生成之后不显示。猜不出来可以问它要提示，提示问完了可以直接看答案 ——
// 这个口子必须留着，不然一台永远打不开的手机就是一个坏功能。

const pad2 = n => String(n).padStart(2, '0');

/** 从生日那一栏里取出 MMDD。认 1999-03-14、3月14日、03/14、19990314。 */
function mmddOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const ok = (mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${pad2(mo)}${pad2(d)}` : '');

  let m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})/);
  if (m) return ok(Number(m[1]), Number(m[2]));

  m = s.match(/(?:\d{4}\s*[-/.年]\s*)?(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
  if (m) return ok(Number(m[1]), Number(m[2]));

  const only = s.replace(/\D/g, '');
  if (only.length === 8) return ok(Number(only.slice(4, 6)), Number(only.slice(6, 8)));
  if (only.length === 4) return ok(Number(only.slice(0, 2)), Number(only.slice(2, 4)));
  return '';
}

/** 设定正文里出现过的四位数，按出现顺序。用 (^|\D) 而不是后顾断言：iOS 15 上没有。 */
function foursInText(text) {
  const out = [];
  const re = /(^|\D)(\d{4})(?=\D|$)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[2]);
  return out;
}

/** 生日那一栏里的年份。只认像年份的那个范围，免得把 0314 当成年。 */
function yearOf(raw) {
  const m = String(raw || '').match(/(19\d{2}|20\d{2})/);
  return m ? m[1] : '';
}

// 两样都没有的时候按角色 id 推一串。**这一串是猜不出来的**，
// 所以那一条提示直接说明这件事，「直接查看密码」当场就给。
const hashOf = s => {
  let h = 0;
  for (let i = 0; i < String(s).length; i += 1) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
  return h;
};

/**
 * 这个角色身上有哪几样能当密码。按「好猜到难猜」排，但**排在前面不等于会被选中**。
 *
 * 从前是「有生日就用生日」，于是几乎每台手机都是生日 —— 第一次猜中之后，
 * 后面每一台都不用猜了，这个玩法当场失效。
 */
function lockPicks(char) {
  const out = [];
  const seen = new Set();
  const add = x => { if (x.code && !seen.has(x.code)) { seen.add(x.code); out.push(x); } };

  const bd = mmddOf(char.birthday);
  add({
    code: bd, why: '该角色的生日', src: 'birthday',
    hints: [
      '这串数字是一个日期。',
      '那是这台手机的主人自己的日期。',
      bd ? `月份是 ${Number(bd.slice(0, 2))} 月。` : '',
    ].filter(Boolean),
  });

  const yr = yearOf(char.birthday);
  add({
    code: yr, why: '该角色出生的年份', src: 'birthyear',
    hints: [
      '这串数字是一个年份。',
      '那是这台手机的主人出生的那一年。',
      yr ? `它在 ${yr.slice(0, 3)}0 年代。` : '',
    ].filter(Boolean),
  });

  const fours = foursInText([char.persona, char.description, char.signature]
    .filter(Boolean).join('\n'));
  if (fours[0]) {
    add({
      code: fours[0], why: '该角色设定中出现的第一串四位数字', src: 'text',
      hints: [
        '这串数字在该角色的设定里写着。',
        '它是设定正文中出现的第一串四位数字。',
        `第一位是 ${fours[0][0]}。`,
      ],
    });
  }
  if (fours.length > 1) {
    const last = fours[fours.length - 1];
    add({
      code: last, why: '该角色设定中出现的最后一串四位数字', src: 'text-last',
      hints: [
        '这串数字在该角色的设定里写着。',
        '它是设定正文中出现的最后一串四位数字。',
        `第一位是 ${last[0]}。`,
      ],
    });
  }
  return out;
}

/**
 * 不调接口，按角色卡当场推一个密码出来。
 *
 * **依据是随机挑的，但对同一个角色永远挑中同一个。** 用角色 id 当种子 ——
 * 真随机的话，这个函数每调一次就换一个密码，人昨天记住的今天就打不开了
 * （密码并不落库，见本文件开头）。
 *
 * 为什么要挑：从前「有生日就用生日」，几乎每台手机都是生日，
 * 猜中一台之后剩下的全都不用猜了。
 */
export function localLock(char) {
  if (!char) return null;
  const picks = lockPicks(char);
  if (!picks.length) {
    return {
      code: String(hashOf(char.id) % 10000).padStart(4, '0'),
      why: '该角色的设定中没有可以作为依据的数字，这串是按角色标识推出的',
      src: 'random',
      hints: ['该角色的设定中没有可以作为密码依据的信息。这串数字无从推测，可以直接查看。'],
      shown: 0,
    };
  }
  return { ...picks[hashOf(`${char.id}:lock`) % picks.length], shown: 0 };
}

/**
 * 这台手机现在用的那个密码。
 * 存过的优先；没存过就当场推一个，**不写库** —— 写了的话「换了生日
 * 密码不跟着换」就成了个要解释的毛病。
 */
export function lockOf(charId) {
  const stored = get(charId)?.lock;
  if (stored?.code) return stored;
  return localLock(characters.get(charId));
}

/** 密码是模型定的还是当场推的。界面据此说明线索是从哪儿来的。 */
export const lockSrc = charId => lockOf(charId)?.src || 'random';

export function setLock(charId, lock) {
  return set(charId, { lock: lock ? { ...lock, src: lock.src || 'ai', shown: 0 } : null });
}

/** 猜一次。对了返回 true，不落任何痕迹 —— 猜错几次不该被记下来。 */
export const tryCode = (charId, input) => {
  const code = String(lockOf(charId)?.code || '');
  return !!code && String(input || '').trim() === code;
};

/**
 * 再要一条提示。要完了返回 null，界面据此改成「直接看答案」。
 * 问到第几条要记住，所以这一下**会把当场推出来的那个密码存下来** ——
 * 存的是此刻这一个，之后改生日也不会换掉已经在猜的这一串。
 */
export function nextHint(charId) {
  const lock = lockOf(charId);
  if (!lock) return null;
  const list = lock.hints || [];
  const shown = Math.min(lock.shown || 0, list.length);
  if (shown >= list.length) return null;
  set(charId, { lock: { ...lock, shown: shown + 1 } });
  return list[shown];
}

// 这一次打开应用期间，哪几台已经解开了。
//
// **不落库。** 存起来就等于「解过一次永远不用再解」，那这道锁只有第一次有用。
// 刷新页面重新锁上，进出各页之间不重复问。
const opened = new Set();
export const isOpen = charId => opened.has(charId);
export const open = charId => opened.add(charId);
export const relock = charId => opened.delete(charId);

// ---- 备忘录与浏览记录 ----
//
// 两样都存在 phones 那一行里，各是一个数组。**追加不覆盖**：
// 再生成一次是往后加，不是把上一次的抹掉 —— 抹掉的话「再来一次」
// 就成了「重掷一次」，上一次里合意的那几条也跟着没了。

const cap = (v, n) => String(v ?? '').trim().slice(0, n);

export const notesOf = charId => get(charId)?.notes || [];

export function addNotes(charId, rows) {
  const clean = (rows || [])
    .map(r => ({ title: cap(r?.title, 20), text: cap(r?.text, 400) }))
    .filter(r => r.title || r.text);
  if (!clean.length) return [];
  const next = [...notesOf(charId), ...clean];
  set(charId, { notes: next });
  return clean;
}

export const removeNote = (charId, i) => set(charId, {
  notes: notesOf(charId).filter((_, k) => k !== i),
});

export const visitsOf = charId => get(charId)?.visits || [];

export function addVisits(charId, rows) {
  const clean = (rows || [])
    .map(r => ({ query: cap(r?.query, 40), site: cap(r?.site, 30) }))
    .filter(r => r.query);
  if (!clean.length) return [];
  const next = [...clean, ...visitsOf(charId)];   // 新的在前，和真的浏览记录一样
  set(charId, { visits: next });
  return clean;
}

export const removeVisit = (charId, i) => set(charId, {
  visits: visitsOf(charId).filter((_, k) => k !== i),
});

// ---- 这台手机长什么样 ----
//
// 图标与名称的那套动作和 system/look.js 里给主界面用的那套**形状一样**，
// 所以界面可以直接复用 ui/IconPicker（它本来就收一个 service 对象，
// 就是为了「改它的地方不止一处」）。区别只在存到哪儿：那边在 settings，
// 这边在这台手机自己那一行上。
//
// 换下来的旧图当场删掉，不然改十次壁纸库里就躺着十张没人要的。

export const iconOf = (charId, appId) => (get(charId)?.icons || {})[appId] || {};

export function setIcon(charId, appId, patch) {
  const all = get(charId)?.icons || {};
  set(charId, { icons: { ...all, [appId]: { ...(all[appId] || {}), ...patch } } });
}

export function resetIcon(charId, appId) {
  const all = { ...(get(charId)?.icons || {}) };
  if (all[appId]?.imageId) images.remove(all[appId].imageId);
  delete all[appId];
  set(charId, { icons: all });
}

export async function setIconFile(charId, appId, file) {
  const id = await images.putIcon(file, ICON_MAX);
  const old = iconOf(charId, appId).imageId;
  if (old) images.remove(old);
  setIcon(charId, appId, { imageId: id });
  return id;
}

// 链接同样落到本地，不做远程引用
export async function setIconUrl(charId, appId, url) {
  const res = await fetch(String(url || '').trim());
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  if (!/^image\//.test(blob.type)) throw new Error('这个链接不是图片');
  return setIconFile(charId, appId, new File([blob], 'icon', { type: blob.type }));
}

export function clearIconImage(charId, appId) {
  const old = iconOf(charId, appId).imageId;
  if (old) images.remove(old);
  setIcon(charId, appId, { imageId: null });
}

/** 壁纸。没设过就回落到角色卡的封面 —— 那张本来就是这个角色的画面。 */
export const wallpaperOf = charId => get(charId)?.wallpaper || null;

export async function setWallpaper(charId, file) {
  const id = await images.put(file, PHOTO_MAX);
  const old = wallpaperOf(charId);
  if (old) images.remove(old);
  set(charId, { wallpaper: id });
  return id;
}

export function clearWallpaper(charId) {
  const old = wallpaperOf(charId);
  if (old) images.remove(old);
  set(charId, { wallpaper: null });
}

// ---- 那台手机里的相册 ----
//
// **这是角色手机唯一真正自己拥有的东西。** 别的（书架、身体状态、今天、
// 和你的对话）都在别处有主，这里只是视图。
//
// 一张「照片」记的是**一句描述**，图片可有可无：模型手里没有照片，
// 让它写一句「拍到了什么」是它做得到的事；真图可以事后自己挂上去，
// 和书架上那本书接不接得上正文是同一个道理。
//
// 相册可以设一个密码。**那不是加密**，库里就是明文，界面上也这么写 ——
// 它挡的是「顺手翻到」，不是挡人来查。

/**
 * 允许这个角色在对话里往自己相册存照片。**默认关着。**
 *
 * 开着要在每一轮的提示词里多列一条能力，也会改变它说话的样子。
 * 这种事不替用户默认打开（第 15 条那个精神：会多出点什么的，让用户自己开）。
 * 开关放在相册那一页 —— 它起作用的地方就在那儿（第 5 条）。
 */
export const keepOn = charId => get(charId)?.keepOn === true;
export const setKeepOn = (charId, v) => set(charId, { keepOn: v === true });

export const albumsOf = charId => get(charId)?.albums || [];
export const photosOf = charId => get(charId)?.photos || [];

export const albumOf = (charId, albumId) =>
  albumsOf(charId).find(a => a.id === albumId) || null;

/** 某一本里的那几张。albumId 留空取没归类的。 */
export const inAlbum = (charId, albumId) =>
  photosOf(charId).filter(p => (p.albumId || '') === (albumId || ''));

export function addAlbum(charId, { name, code = '' }) {
  const n = cap(name, 20);
  if (!n) throw new Error('请填写名称');
  const row = { id: `pa_${Date.now().toString(36)}`, name: n, code: cap(code, 20) };
  set(charId, { albums: [...albumsOf(charId), row] });
  return row;
}

export const updateAlbum = (charId, albumId, patch) => set(charId, {
  albums: albumsOf(charId).map(a => (a.id === albumId
    ? { ...a, ...patch, name: cap(patch.name ?? a.name, 20), code: cap(patch.code ?? a.code, 20) }
    : a)),
});

/** 删本子不删照片：里面那几张退回「没归类」，不跟着一起没。 */
export function removeAlbum(charId, albumId) {
  set(charId, {
    albums: albumsOf(charId).filter(a => a.id !== albumId),
    photos: photosOf(charId).map(p => (p.albumId === albumId ? { ...p, albumId: '' } : p)),
  });
}

export function addPhotos(charId, rows, albumId = '') {
  const clean = (rows || [])
    .map((r, i) => ({
      id: `pp_${Date.now().toString(36)}_${i}`,
      albumId: cap(r?.albumId ?? albumId, 40),
      note: cap(r?.note, 200),
      imageId: r?.imageId || null,
      // 'you' 是用户发过来、角色自己存下的那张。界面上标一下，
      // 免得和生成出来的混在一起分不清哪张是真的
      from: r?.from === 'you' ? 'you' : '',
      // 裁过的要标出来：你看到的这张和你发出去的那张不一样了
      cropped: r?.cropped === true,
      at: Number(r?.at) || Date.now(),
    }))
    .filter(r => r.note || r.imageId);
  if (!clean.length) return [];
  set(charId, { photos: [...clean, ...photosOf(charId)] });   // 新的在前
  return clean;
}

export const updatePhoto = (charId, photoId, patch) => set(charId, {
  photos: photosOf(charId).map(p => (p.id === photoId ? { ...p, ...patch } : p)),
});

export const removePhoto = (charId, photoId) => set(charId, {
  photos: photosOf(charId).filter(p => p.id !== photoId),
});

// 相册里挂上去的真图，purge.usedImageIds 直接从 phones 那一行里数
// —— 那个函数的活就是「把所有用图的地方列一遍」，它一处处伸手进各个域，
// 这里不另给一个 helper，免得两处各数各的。

// 这一次打开期间，哪几本密码本已经开过了。和锁屏同一个道理：不落库
const openedAlbums = new Set();
const keyOf = (charId, albumId) => `${charId}/${albumId}`;
export const albumOpen = (charId, albumId) => {
  const a = albumOf(charId, albumId);
  return !a?.code || openedAlbums.has(keyOf(charId, albumId));
};
export const openAlbum = (charId, albumId, code) => {
  const a = albumOf(charId, albumId);
  if (!a || (a.code && String(code).trim() !== a.code)) return false;
  openedAlbums.add(keyOf(charId, albumId));
  return true;
};

// ---- 那台手机里的会话 ----
//
// 一条会话一行，消息内嵌。**分两步生成**：先生成「和谁在聊、最后一句是什么」
// 这份列表，点进某一条才生成那一段对话 —— 一次把十条会话的正文都要回来，
// 模型多半写到第三条就收尾了。

export const chatsOf = charId => phoneChats.byIndex(charId)
  .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));

export const chat = id => phoneChats.get(id);

export function addChat(charId, { npcId = '', name, preview = '', lastAt = Date.now() }) {
  const n = cap(name, 40);
  if (!n) return null;
  return phoneChats.create({
    charId, npcId: npcId || '', name: n, preview: cap(preview, 80),
    lines: [], lastAt, filled: false,
  });
}

/** 这台手机上已经有谁了。生成列表时发过去，让它别重复。 */
export const chatNames = charId => chatsOf(charId).map(c => c.name);

/**
 * 把一条会话的正文填上。「进去之后再生成」落在这儿。
 * from 只认两种：char 是这台手机的主人，other 是对面。
 */
export const fillChat = (id, lines) => phoneChats.update(id, {
  lines: (lines || []).map(l => ({
    from: l.from === 'char' ? 'char' : 'other',
    text: cap(l.text, 300),
  })).filter(l => l.text),
  filled: true,
});

/**
 * 往一条会话后面接一句。**登着它的手机自己打的那一句走这儿。**
 *
 * 和 fillChat 的区别是接不是换：那一个是「这一整段是什么样」，这一个是
 * 「又说了一句」。列表上那条最后一句与排序也跟着更新 —— 不更新的话，
 * 刚说完话的那一条还排在底下，看着像没发出去。
 */
export function addLine(id, { from, text }) {
  const row = phoneChats.get(id);
  const t = cap(text, 300);
  if (!row || !t) return null;
  const line = { from: from === 'char' ? 'char' : 'other', text: t };
  phoneChats.update(id, {
    lines: [...(row.lines || []), line],
    preview: cap(t, 80),
    lastAt: Date.now(),
    filled: true,
  });
  return line;
}

/** 空手起一条会话：登着它的手机给一个还没聊过的人发消息。 */
export function startChat(charId, { npcId = '', name }) {
  const n = cap(name, 40);
  if (!n) throw new Error('请填写对方的名称');
  if (chatNames(charId).includes(n)) throw new Error('这台手机上已经有这个人了');
  return phoneChats.create({
    charId, npcId: npcId || '', name: n, preview: '',
    lines: [], lastAt: Date.now(), filled: true,
  });
}

export const removeChat = id => phoneChats.remove(id);

/** 这个角色那台手机整台清掉。 */
export function wipe(charId) {
  phoneChats.byIndex(charId).forEach(c => phoneChats.remove(c.id));
  const row = get(charId);
  if (row) phones.remove(row.id);
  opened.delete(charId);
}
