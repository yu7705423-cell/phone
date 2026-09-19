import { characters, lorebooks, memories, chats, messages, messagesOf, images, files } from './db/index.js';
import { DATA_VERSION } from './db/schema.js';
import * as accounts from './accounts.js';
import { uid } from './store.js';
import { zip, unzip, verify } from './zip.js';

// 单个角色的打包与安装。
//
// 一个角色及其相关的全部数据。整个库那一份是 backup.js。
//
// 装回去的规矩：角色 id 撞了另建副本不覆盖；世界书 id 撞了用本机那本
// （同一本常被多个角色关联，盖掉等于替别人改设定）；图片音频已有的跳过。

const FORMAT = 'mini-phone-character';
const VERSION = 1;

const extOf = (type, fallback) => {
  const m = String(type || '').toLowerCase().match(/^(?:image|audio|video|application)\/([a-z0-9.+-]+)/);
  return m ? m[1].replace(/^x-/, '').replace(/\+.*$/, '').slice(0, 8) : fallback;
};

// 这个角色连着哪些东西。导出和「导出前先算个账」都用它。
export function collect(charId, { history = true } = {}) {
  const main = characters.get(charId);
  if (!main) throw new Error('这个角色已经不在了');

  const alts = characters.where(c => c.parentId === charId);
  const cast = [main, ...alts];
  const castIds = new Set(cast.map(c => c.id));

  // 关联的世界书。全局那种不带走 —— 它在对方那边本来就该是对方自己的
  const bookIds = new Set();
  cast.forEach(c => (c.lorebookIds || []).forEach(b => bookIds.add(b)));
  const books = [...bookIds].map(b => lorebooks.get(b)).filter(b => b && !b.global);

  const chatRows = history ? chats.all().filter(c => (c.characterIds || []).some(x => castIds.has(x))) : [];
  const msgRows = history ? chatRows.flatMap(c => messagesOf(c.id)) : [];
  const memRows = history ? memories.where(m => castIds.has(m.charId)) : [];

  // 要跟着走的图片与音频
  const imgIds = new Set();
  const fileIds = new Set();
  cast.forEach(c => {
    [c.avatar, c.cover, c.faceImage, c.callImage].forEach(id => id && imgIds.add(id));
    (c.avatarPool || []).forEach(x => x?.imageId && imgIds.add(x.imageId));
  });
  msgRows.forEach(m => {
    if (m.imageId) imgIds.add(m.imageId);
    if (m.audioId) fileIds.add(m.audioId);
  });

  return { main, cast, books, chats: chatRows, messages: msgRows, memories: memRows,
    imgIds: [...imgIds].filter(id => images.has(id)),
    fileIds: [...fileIds].filter(id => files.info(id)) };
}

/** 导出前把账摆出来：带走几段会话、多少条消息、几张图。 */
export function estimate(charId, opts) {
  const g = collect(charId, opts);
  return {
    name: g.main.name || '未命名',
    alts: g.cast.length - 1,
    books: g.books.length,
    chats: g.chats.length,
    messages: g.messages.length,
    memories: g.memories.length,
    images: g.imgIds.length,
    files: g.fileIds.length,
  };
}

export async function build(charId, { history = true, onProgress } = {}) {
  const g = collect(charId, { history });
  const data = {
    _format: FORMAT,
    _version: VERSION,
    _data: DATA_VERSION,
    _history: !!history,
    exportedAt: new Date().toISOString(),
    character: g.main,
    alts: g.cast.slice(1),
    lorebooks: g.books,
    memories: g.memories,
    chats: g.chats,
    messages: g.messages,
  };

  const entries = [{ name: 'character.json', text: JSON.stringify(data) }];
  for (const id of g.imgIds) {
    const blob = await images.blob(id);
    if (blob) entries.push({ name: `images/${id}.${extOf(blob.type, 'bin')}`, blob });
  }
  for (const id of g.fileIds) {
    const blob = await files.blob(id);
    if (blob) entries.push({ name: `files/${id}.${extOf(blob.type, 'bin')}`, blob });
  }
  const out = await zip(entries, { onProgress });
  const check = await verify(out, ['character.json']);
  if (!check.ok) throw new Error(`打出来的包自检没过（${check.problem}），请重试`);
  return out;
}

/** 文件名。名字里可能有斜杠之类的，扫掉再用。 */
export const fileNameFor = name =>
  `角色-${String(name || '未命名').replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || '未命名'}`
  + `-${new Date().toISOString().slice(0, 10)}.zip`;

/**
 * 读一个包出来先看看，**不动库**。界面照着它写确认框，确认了再 install。
 */
export async function read(file) {
  const found = await unzip(file);
  const json = found.get('character.json');
  if (!json) {
    const names = [...found.keys()].slice(0, 5).join('、');
    throw new Error(names
      ? `这个包里没有 character.json。里面是：${names}${found.size > 5 ? ' 等' : ''}`
      : '这个包里一条记录都读不出来，可能不是角色包');
  }
  const data = JSON.parse(await json.text());
  if (data._format !== FORMAT) throw new Error('这不是一个角色包');
  const from = Number(data._data) || 0;
  if (from > DATA_VERSION) {
    throw new Error(`这个包来自更新的版本（数据版本 ${from}，本机 ${DATA_VERSION}）。`
      + '请先更新到最新版本再导入。');
  }
  const main = data.character;
  if (!main || !main.id) throw new Error('这个包里没有角色');
  return {
    data, media: found,
    name: main.name || '未命名',
    exists: characters.has(main.id),
    alts: (data.alts || []).length,
    books: (data.lorebooks || []).length,
    chats: (data.chats || []).length,
    messages: (data.messages || []).length,
    memories: (data.memories || []).length,
    history: !!data._history,
  };
}

/**
 * 真的装进去。传 read() 的返回值。
 *
 * 会话与记忆一律挂到**当前账号**下：包里那个 personaId 是导出那台设备的，
 * 在这里多半不存在，照抄过来这段会话谁也看不见。
 */
export async function install(pack) {
  const { data, media } = pack;
  const me = accounts.currentId();

  // 图片与音频先放回去，已经有的跳过（同一个包导入两次，那就是同一张图）
  let mediaCount = 0;
  for (const [name, blob] of media) {
    const m = name.match(/^(images|files)\/([^./]+)/);
    if (!m) continue;
    const [, kind, id] = m;
    try {
      if (kind === 'images') { if (!images.has(id)) { await images.putRaw(id, blob); mediaCount++; } }
      else if (!files.info(id)) { await files.putRaw(id, blob); mediaCount++; }
    } catch (err) { console.warn('[charpack] 放回失败', name, err.message || err); }
  }

  // 世界书：本机已经有同一个 id 就用本机那本，不覆盖
  (data.lorebooks || []).forEach(b => { if (b && b.id && !lorebooks.has(b.id)) lorebooks.put(b); });

  // 角色。撞了就整包换一套 id，另建一个副本
  const cast = [data.character, ...(data.alts || [])].filter(c => c && c.id);
  const copied = cast.some(c => characters.has(c.id));
  const idMap = new Map();
  cast.forEach(c => idMap.set(c.id, copied ? uid('char') : c.id));
  const remap = id => idMap.get(id) || id;

  cast.forEach(c => {
    const row = { ...c, id: remap(c.id) };
    if (c.parentId) row.parentId = remap(c.parentId);
    // 指向包外角色的关系留着不动：relationsOf 本来就会滤掉找不到的那些
    if (Array.isArray(c.relations)) {
      row.relations = c.relations.map(r => ({ ...r, charId: remap(r.charId) }));
    }
    row.lorebookIds = (c.lorebookIds || []).filter(b => lorebooks.has(b));
    if (copied) row.name = `${c.name || '未命名'}（副本）`;
    characters.put(row);
  });

  // 会话与消息
  const chatMap = new Map();
  (data.chats || []).forEach(c => {
    const id = (copied || chats.has(c.id)) ? uid('chat') : c.id;
    chatMap.set(c.id, id);
    chats.put({
      ...c, id, personaId: me,
      characterIds: (c.characterIds || []).map(remap),
    });
  });
  (data.messages || []).forEach(m => {
    const chatId = chatMap.get(m.chatId);
    if (!chatId) return;                       // 会话没带进来的消息不要
    const id = (copied || messages.has(m.id)) ? uid('msg') : m.id;
    messages.put({ ...m, id, chatId, authorId: m.authorId === 'me' ? 'me' : remap(m.authorId) });
  });

  // 记忆。同一个角色的记忆各身份分开存，这里一律归到当前账号名下
  (data.memories || []).forEach(m => {
    const id = (copied || memories.has(m.id)) ? uid('mem') : m.id;
    memories.put({ ...m, id, charId: remap(m.charId), personaId: me });
  });

  return {
    charId: remap(data.character.id),
    copied,
    chats: (data.chats || []).length,
    messages: (data.messages || []).length,
    memories: (data.memories || []).length,
    media: mediaCount,
  };
}
