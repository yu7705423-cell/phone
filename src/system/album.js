import { albums, photos, shots, images, settings, characters } from './db/index.js';

// 相册。
//
// 里面放两种东西：
//
//   image  一张图。角色发来的、或者自己导入的
//   card   几条消息存成的一张「截图」
//
// ---- 卡片为什么不是一存了之 ----
//
// 气泡上可能盖着你自己写的美化 CSS。存卡片时把**那一刻的 CSS 原文**一起存下来，
// 看的时候连着它一起渲染，所以你之后换成什么美化都和这张卡片无关 ——
// 这正是「换了之后旧的不会跟着变」。
//
// CSS 按内容哈希去重（shots 域）：同一套美化下存的十张卡片共用一份，
// 换一套美化自然生成新的一份，旧卡片仍指着旧的那份。
//
// **只冻你的美化，不冻 app 自带的样式。** app 自带的气泡样式跟着版本走 ——
// 全都拍下来每张卡片都要背一份完整样式表，不值。

export const UNFILED = '';        // 没归类的那些

// ---- 相册 ----

export const listAlbums = () => albums.all()
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

export function createAlbum(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('请填写名称');
  return albums.create({ name: n.slice(0, 40), cover: null, createdAt: Date.now() });
}

export const renameAlbum = (id, name) =>
  albums.update(id, { name: String(name || '').trim().slice(0, 40) });

/** 删相册。里面的照片不跟着删，退回「未归类」—— 删错了不该连东西一起没。 */
export function removeAlbum(id) {
  photos.byIndex(id).forEach(p => photos.update(p.id, { albumId: UNFILED }));
  return albums.remove(id);
}

export const countOf = albumId => photos.byIndex(albumId).length;

// ---- 照片 ----

export const listPhotos = albumId => photos.byIndex(albumId)
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

export const allPhotos = () => photos.all()
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

/** 存一张图。from 记清楚它是谁发的、哪一段对话、什么时候。 */
export function saveImage({ imageId, albumId = UNFILED, from = null, note = '' }) {
  if (!imageId) throw new Error('没有图片');
  return photos.create({
    albumId, kind: 'image', imageId,
    from: from ? { ...from } : null,
    note: String(note || '').slice(0, 200),
    createdAt: Date.now(),
  });
}

/** 自己从文件导入。 */
export async function importFile(file, albumId = UNFILED) {
  const id = await images.put(file);
  return saveImage({ imageId: id, albumId });
}

export function removePhoto(id) {
  const p = photos.get(id);
  if (!p) return false;
  // 卡片自己那张光栅图是它专属的，删卡片要一起删；
  // 角色发的那张原图**不删** —— 它还挂在消息上，删了聊天记录里就空了
  if (p.kind === 'card' && p.imageId) images.remove(p.imageId);
  if (p.kind === 'image' && !p.from) images.remove(p.imageId);
  albums.all().forEach(a => { if (a.cover === id) albums.update(a.id, { cover: null }); });
  const okd = photos.remove(id);
  sweepShots();       // 最后一张用这套美化的卡片没了，那份 CSS 也留不住
  return okd;
}

export const movePhoto = (id, albumId) => photos.update(id, { albumId });

export const setCover = (albumId, photoId) => albums.update(albumId, { cover: photoId });

// ---- 美化快照 ----

const hash = async text => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text || ''));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
};

/** 把这一刻的美化 CSS 存成一份（已有同样内容就复用）。返回它的 id。 */
export async function keepShot(css) {
  const text = String(css || '');
  const id = await hash(text);
  if (!shots.has(id)) shots.create({ id, css: text, createdAt: Date.now() });
  return id;
}

export const shotCss = id => (id ? shots.get(id)?.css || '' : '');

/** 现在生效的那段美化。存卡片时拿它。 */
export const currentCss = () => settings.get().customCSS || '';

/**
 * 几条消息存成一张卡片。msgs 是**冻起来的副本** ——
 * 原消息以后删了、改了，卡片都还是当时那个样子。
 */
export async function saveCard({ msgs, albumId = UNFILED, title = '', css, imageId = null }) {
  const list = (msgs || []).filter(Boolean);
  if (!list.length) throw new Error('没有选中的消息');
  const shotId = await keepShot(css === undefined ? currentCss() : css);
  return photos.create({
    albumId, kind: 'card', shotId, imageId,
    title: String(title || '').slice(0, 60),
    msgs: structuredClone(list),
    createdAt: Date.now(),
  });
}

export const attachRaster = (photoId, imageId) => photos.update(photoId, { imageId });

/**
 * 把几条消息冻成卡片能独立渲染的样子。
 *
 * 头像、名字这些当场取出来存进副本 —— 卡片以后要能在角色都删了的情况下
 * 照样画得出来，不能到时候再回头去查。下划线开头的那几个字段是卡片专用的。
 */
export function freeze(msgs, { meName = '我', meAvatar = null } = {}) {
  return (msgs || []).filter(Boolean).map(m => {
    const mine = m.role === 'user';
    const char = mine ? null : characters.get(m.authorId);
    return {
      id: m.id, role: m.role, kind: m.kind, content: m.content,
      imageId: m.imageId || null, stickerId: m.stickerId || null,
      createdAt: m.createdAt,
      _name: mine ? meName : (char?.name || ''),
      _avatar: mine ? meAvatar : (char?.avatar || null),
    };
  });
}

/** 没有人再指着的那几份 CSS 快照，清掉。 */
export function sweepShots() {
  const used = new Set(photos.all().map(p => p.shotId).filter(Boolean));
  const dead = shots.all().filter(s => !used.has(s.id));
  dead.forEach(s => shots.remove(s.id));
  return dead.length;
}
