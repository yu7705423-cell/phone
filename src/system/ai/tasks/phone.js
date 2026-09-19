import { characters } from '../../db/index.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';
import { relationsOf } from './card.js';
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

  theirs.setLock(charId, { code, why: str(out?.why), hints });
  return { digits: n, hints: hints.length };
}

// ---- 一个 app 一次请求 ----
//
// **不把整台手机塞进一次请求里。** 一次要得太多，模型常常只写出前几项就收尾，
// 后面那几个 app 空着，而且失败一次要从头再来。一个 app 一次，坏了只重来那一个。
//
// 每一次都把已经有的那些发过去，让它别重复 —— 这也是「再生成一次」
// 能往后加而不是重掷的前提。

/** 一个 app 一条：id、名字、生成函数。生成页照着这一份列。 */
export const MAKERS = [
  { id: 'chats', label: '聊天', unit: '条会话', run: makeChats },
  { id: 'album', label: '相册', unit: '张', run: makeAlbum },
  { id: 'notes', label: '备忘录', unit: '条', run: makeNotes },
  { id: 'visits', label: '浏览记录', unit: '条', run: makeVisits },
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
