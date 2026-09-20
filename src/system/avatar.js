import { characters, chats, personas, persona } from './db/index.js';
import { images } from './db/images.js';

// 头像联动。
//
// 两个方向：
//   **她看得见你的头像**。换了就在下一轮提一句，附一句客观描述。
//   **她也能换自己的**。从你预先传进去的那一批里挑一张。
//
// 描述是**本地算的**，不走识图接口：把图缩到 16×16 读一遍像素，
// 算平均亮度和饱和度。换头像这件事每次都要描述一句，为它调一次识图
// 太贵了；而且这里要的本来也不是「图上有什么」，是「大致什么样」。
//
// **只说看得见的，不替用户解释。** 一张纯黑头像写成「几乎全黑」，
// 不写「看起来心情不好」—— 那是模型该自己琢磨的事。写死了反而变成
// 一条生硬的设定，她会照着念出来。

const HEX = n => Math.max(0, Math.min(255, Math.round(n)));

/** 把一张图读成 { light, sat, r, g, b }。读不出来返回 null。 */
export async function sample(imageId) {
  if (!imageId || typeof document === 'undefined') return null;
  const url = await images.url(imageId);
  if (!url) return null;
  try {
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error('读不出这张图'));
      el.src = url;
    });
    const n = 16;
    const cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const { data } = ctx.getImageData(0, 0, n, n);

    let r = 0, g = 0, b = 0, sat = 0;
    const px = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2];
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      sat += mx ? (mx - mn) / mx : 0;
    }
    r = HEX(r / px); g = HEX(g / px); b = HEX(b / px);
    // 感知亮度。绿色最亮、蓝色最暗，按人眼的权重算才和「看起来暗不暗」对得上
    const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return { light, sat: sat / px, r, g, b };
  } catch { return null; }
}

const HUES = [
  [15, '红'], [45, '橙'], [70, '黄'], [160, '绿'],
  [200, '青'], [255, '蓝'], [320, '紫'], [360, '红'],
];

function hueName(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return '';
  const d = mx - mn;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return (HUES.find(x => h <= x[0]) || HUES[HUES.length - 1])[1];
}

/**
 * 一句客观描述。只说明暗、浓淡、大致什么色，不作任何解读。
 */
export function describe(s) {
  if (!s) return '';
  if (s.light < 0.06) return '几乎全黑';
  if (s.light > 0.94) return '几乎全白';
  const dark = s.light < 0.3 ? '很暗' : s.light < 0.5 ? '偏暗' : s.light > 0.8 ? '很亮' : '';
  if (s.sat < 0.08) return dark ? `没有颜色，${dark}` : '几乎没有颜色，灰调';
  const hue = hueName(s.r, s.g, s.b);
  const deep = s.sat > 0.5 ? '颜色很浓' : '颜色偏淡';
  return [hue ? `以${hue}色为主` : '', deep, dark].filter(Boolean).join('，');
}

/** 算好一句描述存回去。换头像的时候调一次，之后注入都是同步读字段。 */
export async function note(imageId) {
  return describe(await sample(imageId));
}

// ---- 我这边换了头像 ----
//
// 描述在换的那一刻就算好存下来，注入时只是读一个字段 ——
// 注入块是同步的，不能在那儿等一个 canvas。

export async function rememberMine(personaId, imageId) {
  const text = await note(imageId);
  if (personas.get(personaId)) personas.update(personaId, { avatarNote: text });
  // 老版本那份单人设 KV 也跟着写一份，两边不至于对不上
  if (persona.get()?.id === personaId) persona.set({ avatarNote: text });
  return text;
}

/**
 * 这段对话里，我的头像是不是「刚换的」。
 * seenAvatar 记的是上一次注入时它是哪一张。
 */
export function changedFor(chat, me) {
  if (!chat || !me || !me.avatar) return false;
  return chat.seenAvatar !== me.avatar;
}

/** 注入完之后记一笔，下一轮就不再说「刚换」了。 */
export function markSeen(chatId, imageId) {
  const chat = chats.get(chatId);
  if (chat && chat.seenAvatar !== imageId) chats.update(chatId, { seenAvatar: imageId || '' });
}

// ---- 她那边的头像库 ----
//
// 用户先传几张进去，角色自己挑一张换上。不给它上网找 ——
// 纯浏览器里没有那个能力（见 ARCHITECTURE 4.84）。

export const poolOf = char => (char?.avatarPool || []).filter(x => x && x.imageId);

export function addToPool(charId, { imageId, name }) {
  const char = characters.get(charId);
  if (!char || !imageId) return null;
  const n = String(name || '').trim().slice(0, 20) || `第 ${poolOf(char).length + 1} 张`;
  const pool = [...poolOf(char), { imageId, name: n }];
  characters.update(charId, { avatarPool: pool });
  return pool;
}

export function removeFromPool(charId, imageId) {
  const char = characters.get(charId);
  if (!char) return;
  characters.update(charId, { avatarPool: poolOf(char).filter(x => x.imageId !== imageId) });
}

/** 库里的名字单子，给模型看的。空库就返回空串，那样这个能力整个不注入。 */
export const poolNames = char => poolOf(char).map(x => x.name).join('、');

/**
 * 按名字换上一张。认不出名字就不换 —— 凭空换成另一张，
 * 用户看到的是一个它根本没提过的头像。
 */
export function wear(charId, name) {
  const char = characters.get(charId);
  if (!char) return null;
  const q = String(name || '').replace(/\s+/g, '');
  if (!q) return null;
  const pool = poolOf(char);
  const hit = pool.find(x => {
    const t = String(x.name || '').replace(/\s+/g, '');
    return t && (t.includes(q) || q.includes(t));
  });
  if (!hit || hit.imageId === char.avatar) return null;
  // 第一次被换掉时，把原来那张记下来。**不记就找不回来了** ——
  // 角色自己换头像是它的自由，但「它本来长什么样」是另一件事，
  // 那张是你当初给它选的，不该被它一句话覆盖掉
  const patch = { avatar: hit.imageId };
  if (!char.avatarBase && char.avatar) patch.avatarBase = char.avatar;
  characters.update(charId, patch);
  return hit;
}

/**
 * 原本那张与现在这张。
 *
 * `avatar` 一直是**现在在用的**那张 —— 界面上到处都读它，换个字段等于把每一处
 * 显示都改一遍，漏一处就是两张脸。所以原本那张单独记在 `avatarBase`，
 * 没被换过时它是空的，那时两张就是同一张。
 *
 * 用户自己那边同理（`persona.avatarBase`）。
 */
export function facesOf(who) {
  const now = who?.avatar || null;
  const base = who?.avatarBase || null;
  return { now, base: base || now, changed: !!(base && base !== now) };
}

/** 换回原本那张。没换过就什么都不做。 */
export function restoreFace(charId) {
  const char = characters.get(charId);
  if (!char?.avatarBase || char.avatarBase === char.avatar) return false;
  characters.update(charId, { avatar: char.avatarBase, avatarBase: '' });
  return true;
}
