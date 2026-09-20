import { characters } from '../../db/index.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';
import { relationsOf } from './card.js';
import * as vision from '../vision.js';
import { images, settings } from '../../db/index.js';
import * as theirs from '../../theirs.js';

// 生成角色手机里的东西。
//
// 头一样是锁屏密码。**生成之后不显示给用户** —— 看了就没得猜了，
// 而猜这一下本来就是这个功能的全部意思。密码、答案、三条提示一次要回来，
// 问提示的时候不再调接口（第 15 条：能一次要回来的不分两次）。

const str = v => String(v ?? '').trim();

const personaOf = char => [char.persona, char.signature, char.description]
  .filter(Boolean).join('\n\n') || '（角色卡里还没有写人设）';

/**
 * 按人设定一个开机密码。digits 由用户挑，四位或六位。
 * 存下来的时候 shown 归零 —— 一条提示都还没问过。
 */
export async function makeLock(charId, { digits = 4 } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const n = digits === 6 ? 6 : 4;

  const out = await runJSONTask('phone.lock', {
    system: fillTemplate(template('task.phone-lock'), {
      charName: char.name || '该角色',
      charPersona: personaOf(char),
      digits: n,
    }),
    key: `phone-lock:${charId}:${Date.now()}`,
    maxTokens: 500,
  });

  // 模型偶尔会给带空格或别的字符的串，也偶尔会给错位数。
  // 位数不对就不收 —— 一个开不了的锁比没有锁糟得多
  const code = str(out?.code).replace(/\D/g, '');
  if (code.length !== n) throw new Error(`模型给的不是 ${n} 位数字，请重试`);

  const hints = (Array.isArray(out?.hints) ? out.hints : [])
    .map(str).filter(Boolean).slice(0, 3);
  if (!hints.length) throw new Error('模型没有给出提示，请重试');

  theirs.setLock(charId, { code, why: str(out?.why), hints, src: 'ai' });
  return n;
}

// ---- 把角色说要留的那一块裁出来 ----
//
// 「为什么不能裁」：能裁。裁一张图是 canvas 五行代码的事。
// **难的是知道裁哪儿** —— 聊天模型看不见那张照片，它写「只留你」的时候
// 是在说一件它没看见的事。
//
// 所以要多问一次**识图接口**：把图和它那句话一起发过去，要一个框回来。
// 这是一次额外的接口调用，所以按第 15 条登记在 ai/cost.js，**默认关着**。
//
// 三种情况都不裁，原图照存：没开这个开关、没配识图接口、模型说它看不出
// 那句话指的是哪一块。**看不出就别乱裁** —— 裁错了的那张比没裁糟得多，
// 原图还被换掉了。

const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0));

/** 按归一化的框裁一张图，落成新的一张。原图不动。 */
async function cropTo(imageId, box) {
  const blob = await images.blob(imageId);
  if (!blob) throw new Error('图片已不存在');
  const bmp = await createImageBitmap(blob);
  const sx = Math.round(clamp01(box.x) * bmp.width);
  const sy = Math.round(clamp01(box.y) * bmp.height);
  const sw = Math.max(1, Math.round(clamp01(box.w) * bmp.width));
  const sh = Math.max(1, Math.round(clamp01(box.h) * bmp.height));
  // 框可能越界，收回图内
  const w = Math.min(sw, bmp.width - sx);
  const h = Math.min(sh, bmp.height - sy);
  if (w < 8 || h < 8) throw new Error('这个范围太小了');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise(res => canvas.toBlob(res, 'image/webp', 0.9))
    || await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
  if (!out) throw new Error('裁不出来');
  return images.put(new File([out], 'kept', { type: out.type }));
}

/**
 * 角色说它要留哪一块，就裁哪一块。裁不成返回原来那个 id ——
 * **裁这件事失败了不该连带着让这张照片存不进去。**
 */
export async function cropKept(imageId, note) {
  if (!imageId || !note) return imageId;
  if (settings.get().cropKeptPhoto !== true) return imageId;
  if (!vision.isVisionReady()) return imageId;
  try {
    const raw = await vision.askImage(
      imageId,
      fillTemplate(template('task.phone-crop'), { note }),
      `phone-crop:${imageId}:${Date.now()}`,
    );
    const box = JSON.parse(String(raw).replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
    if (!box || box.keep !== true) return imageId;
    if (clamp01(box.w) >= 0.98 && clamp01(box.h) >= 0.98) return imageId;  // 等于没裁
    return await cropTo(imageId, box);
  } catch (err) {
    console.warn('[phone] 这一张没裁成，存原图:', err.message || err);
    return imageId;
  }
}

// ---- 一个 app 一次请求 ----
//
// **不把整台手机塞进一次请求里。** 一次要得太多，模型常常只写出前几项就收尾，
// 后面那几个 app 空着，而且失败一次要从头再来。一个 app 一次，坏了只重来那一个。
//
// 每一次都把已经有的那些发过去，让它别重复 —— 这也是「再生成一次」
// 能往后加而不是重掷的前提。

/** 一个 app 一条：id、名字、生成函数。生成页照着这一份列。 */
// 能生成的几样。`state` 是那一项此刻的实情，界面照着显示 ——
// 写在这里而不是界面里，是因为「有几条」这件事各项算法不同，
// 而界面只该负责摆出来。
//
// 锁屏那一项 `solo`：**「全部生成」不带它**。密码本来就是有的（按角色卡
// 当场推的那一个），重新定一次会把正在猜的那一串换掉 —— 那不该是
// 按一下「全部生成」顺带发生的事。
export const MAKERS = [
  { id: 'chats', label: '聊天', icon: 'message', run: makeChats,
    done: n => `新增 ${n} 条会话`,
    state: id => `已有 ${theirs.chatsOf(id).length} 条会话`,
    desc: '不设上限。这一步只生成「和谁在聊、最后一句是什么」，'
      + '每段对话的正文在点进那一条时单独生成。' },
  { id: 'album', label: '相册', icon: 'camera', run: makeAlbum,
    done: n => `新增 ${n} 张`,
    state: id => `已有 ${theirs.photosOf(id).length} 张`,
    desc: '不设上限。生成的是每张照片的描述，不生成图片本身，'
      + '可以在相册中为某一张挂上真实图片。' },
  { id: 'notes', label: '备忘录', icon: 'notes', run: makeNotes,
    done: n => `新增 ${n} 条`,
    state: id => `已有 ${theirs.notesOf(id).length} 条`,
    desc: '不设上限。数量越多，这一次请求越长，也越可能写不完。' },
  { id: 'visits', label: '浏览记录', icon: 'search', run: makeVisits,
    done: n => `新增 ${n} 条`,
    state: id => `已有 ${theirs.visitsOf(id).length} 条`,
    desc: '不设上限。' },
  { id: 'lock', label: '锁屏密码', icon: 'lock', run: makeLock, solo: true,
    done: n => `已重新设定 ${n} 位密码，现在需要重新推测`,
    choices: [{ value: 4, label: '四位' }, { value: 6, label: '六位' }],
    state: id => (theirs.lockSrc(id) === 'ai'
      ? '当前密码由模型依据该角色的设定生成'
      : '当前密码依据角色卡中的信息推出，未调用接口'),
    desc: '重新设定这台手机的开机密码，同时生成三条可以在锁屏上询问的线索。'
      + '设定后不会显示密码。当前正在使用的密码将被替换。' },
];

// ---- 聊天：分两步 ----
//
// 先生成「和谁在聊、最后一句是什么」这份列表，点进某一条才生成那一段对话。
// **一次把十条会话的正文都要回来，模型多半写到第三条就收尾了** ——
// 这正是「进去之后再生成」要解决的事。
//
// 和谁聊天优先取**这个角色已经认识的人**（relationsOf，也就是 NPC 那一套），
// 生成回来按名字对回去：对得上的记下 npcId，界面上就能用那个 NPC 的头像，
// 也点得进它的卡片。对不上的留个名字 —— 一个人认识的人本来就多于
// 已经建了卡的那几个，不为这个去凭空造 NPC。

export async function makeChats(charId, { count = 6 } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const n = Math.max(1, Math.round(count) || 0);

  const known = relationsOf(charId)
    .map(r => ({ id: r.charId, name: characters.get(r.charId)?.name || '', label: r.label }))
    .filter(k => k.name);

  const out = await runJSONTask('phone.chats', {
    system: fillTemplate(template('task.phone-chats'), {
      charName: char.name || '该角色',
      charPersona: personaOf(char),
      count: n,
      known: known.map(k => `- ${k.name}${k.label ? `（${k.label}）` : ''}`).join('\n')
        || '（还没有建立关系的人）',
      existing: theirs.chatNames(charId).map(x => `- ${x}`).join('\n') || '（还没有）',
    }),
    key: `phone-chats:${charId}:${Date.now()}`,
    maxTokens: 300 + n * 60,
  });

  const rows = Array.isArray(out?.chats) ? out.chats : [];
  const have = new Set(theirs.chatNames(charId));
  let added = 0;
  let at = Date.now();
  for (const r of rows) {
    const name = str(r?.name);
    if (!name || have.has(name)) continue;
    have.add(name);
    // 名字对得上已经认识的那几个就接上，接不上就只留名字
    const hit = known.find(k => k.name === name);
    theirs.addChat(charId, {
      npcId: hit?.id || '', name, preview: str(r?.preview),
      // 列表按最后活跃排序，靠前的排在前面
      lastAt: at,
    });
    at -= 60000;
    added += 1;
  }
  if (!added) throw new Error('这一次没有生成出内容，可以再试一次');
  return added;
}

/** 点进某一条才生成那一段对话。已经有正文的不重生成。 */
export async function fillChat(chatId, { count = 12 } = {}) {
  const row = theirs.chat(chatId);
  if (!row) throw new Error('这条会话已经不在了');
  const char = characters.get(row.charId);
  if (!char) throw new Error('角色不存在');
  const npc = row.npcId ? characters.get(row.npcId) : null;
  const n = Math.max(2, Math.round(count) || 0);

  const out = await runJSONTask('phone.chat', {
    system: fillTemplate(template('task.phone-chat'), {
      charName: char.name || '该角色',
      charPersona: personaOf(char),
      other: row.name,
      otherPersona: npc ? personaOf(npc) : '（没有更多设定，按上面的关系与最后一句推断）',
      preview: row.preview || '（没有记下最后一句）',
      count: n,
    }),
    key: `phone-chat:${chatId}:${Date.now()}`,
    maxTokens: 300 + n * 60,
  });

  const lines = Array.isArray(out?.lines) ? out.lines : [];
  if (!lines.length) throw new Error('这一次没有生成出内容，可以再试一次');
  theirs.fillChat(chatId, lines);
  return lines.length;
}

/**
 * 登着它的手机给某人发了一句之后，对面回一句。
 *
 * **一次发送一次请求**，不重试、不顺带做别的（第 15 条）。发出去的那一句
 * 由界面先落库，这里只负责要回话 —— 所以请求失败时你打的那句还在，
 * 按一下「让对方回复」再试就是了。
 *
 * 走副用接口：这不是你正盯着屏幕等的那两件事之一（第 15 条那张表）。
 */
export async function replyInChat(chatId) {
  const row = theirs.chat(chatId);
  if (!row) throw new Error('这条会话已经不在了');
  const char = characters.get(row.charId);
  if (!char) throw new Error('角色不存在');
  const npc = row.npcId ? characters.get(row.npcId) : null;

  // 只带最近这一段。整条会话发过去越长越贵，而回一句用不着从头看起
  const lines = (row.lines || []).slice(-30)
    .map(l => `${l.from === 'char' ? char.name || '该角色' : row.name}: ${l.text}`)
    .join('\n') || '（还没有说过话）';

  const out = await runJSONTask('phone.reply', {
    system: fillTemplate(template('task.phone-reply'), {
      charName: char.name || '该角色',
      charPersona: personaOf(char),
      other: row.name,
      otherPersona: npc ? personaOf(npc) : '（没有更多设定，按上面的对话推断）',
      history: lines,
    }),
    key: `phone-reply:${chatId}:${Date.now()}`,
    maxTokens: 400,
  });

  const rows = (Array.isArray(out?.lines) ? out.lines : [])
    .map(l => str(l?.text)).filter(Boolean);
  if (!rows.length) throw new Error('这一次没有回话，可以再试一次');
  rows.forEach(text => theirs.addLine(chatId, { from: 'other', text }));
  return rows.length;
}

/**
 * 相册里的照片。生成的是**一句描述**，不是图 —— 模型手里没有照片。
 * 真图可以事后自己挂上去，和书架上那本书接不接得上正文是同一个道理。
 */
export async function makeAlbum(charId, { count = 8 } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const n = Math.max(1, Math.round(count) || 0);
  const have = theirs.photosOf(charId);

  const out = await runJSONTask('phone.album', {
    system: fillTemplate(template('task.phone-album'), {
      charName: char.name || '该角色',
      charPersona: personaOf(char),
      count: n,
      existing: have.slice(0, 40).map(x => `- ${x.note}`).join('\n') || '（还没有）',
    }),
    key: `phone-album:${charId}:${Date.now()}`,
    maxTokens: 300 + n * 40,
  });

  const rows = Array.isArray(out?.photos) ? out.photos : [];
  const added = theirs.addPhotos(charId, rows.map(r => ({ note: str(r?.note) })));
  if (!added.length) throw new Error('这一次没有生成出内容，可以再试一次');
  return added.length;
}

export async function makeNotes(charId, { count = 6 } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const n = Math.max(1, Math.round(count) || 0);
  const have = theirs.notesOf(charId);

  const out = await runJSONTask('phone.notes', {
    system: fillTemplate(template('task.phone-notes'), {
      charName: char.name || '该角色',
      charPersona: personaOf(char),
      count: n,
      existing: have.map(x => `- ${x.title}`).join('\n') || '（还没有）',
    }),
    key: `phone-notes:${charId}:${Date.now()}`,
    maxTokens: 400 + n * 120,
  });

  const rows = Array.isArray(out?.notes) ? out.notes : [];
  const added = theirs.addNotes(charId, rows);
  if (!added.length) throw new Error('这一次没有生成出内容，可以再试一次');
  return added.length;
}

export async function makeVisits(charId, { count = 10 } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const n = Math.max(1, Math.round(count) || 0);
  const have = theirs.visitsOf(charId);

  const out = await runJSONTask('phone.visits', {
    system: fillTemplate(template('task.phone-visits'), {
      charName: char.name || '该角色',
      charPersona: personaOf(char),
      count: n,
      existing: have.map(x => `- ${x.query}`).join('\n') || '（还没有）',
    }),
    key: `phone-visits:${charId}:${Date.now()}`,
    maxTokens: 300 + n * 40,
  });

  const rows = Array.isArray(out?.visits) ? out.visits : [];
  const added = theirs.addVisits(charId, rows);
  if (!added.length) throw new Error('这一次没有生成出内容，可以再试一次');
  return added.length;
}
