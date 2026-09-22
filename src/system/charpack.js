import { characters, lorebooks, memories, chats, messages, messagesOf, images, files,
         scenes, beats, trips, spaceItems, skins, days, meals, health, phones, phoneChats,
         moments, reviews, readnotes, todos, ebooks, videos, works, chapters } from './db/index.js';
import { DATA_VERSION } from './db/schema.js';
import * as accounts from './accounts.js';
import { uid } from './store.js';
import { zip, unzip, verify } from './zip.js';
import { packRow, unpackRow } from './typed.js';

// 单个角色的打包与安装。
//
// 一个角色及其相关的全部数据。整个库那一份是 backup.js。
//
// 装回去的规矩：角色 id 撞了另建副本不覆盖；世界书 id 撞了用本机那本
// （同一本常被多个角色关联，盖掉等于替别人改设定）；图片音频已有的跳过。

const FORMAT = 'mini-phone-character';
// 2：带上了挂在这个角色与这几段会话上的其余数据域（线下、出行、纪念日、
// 美化、每一天、吃饭、健康、那台手机、动态、影评、段评、待办）。
// 老包（1）照读，只是那几样是空的
const VERSION = 2;

// 挂在会话上的域 / 挂在角色上的域。**加数据域时这两张表要跟着加一行**，
// 和 purge 的 dropChat / dropCharacter 是同一件事的两面：那边管删，
// 这边管带走。漏了不会报错，只是导出的包里少一块，换台设备才发现。

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

  const none = [];
  const chatRows = history
    ? chats.all().filter(c => (c.characterIds || []).some(x => castIds.has(x))) : none;
  const msgRows = history ? chatRows.flatMap(c => messagesOf(c.id)) : none;
  const memRows = history ? memories.where(m => castIds.has(m.charId)) : none;

  // 挂在这几段会话上的
  const sceneRows = chatRows.flatMap(c => scenes.byIndex(c.id));
  const workRows = chatRows.flatMap(c => works.byIndex(c.id));
  const chapterRows = workRows.flatMap(w => chapters.byIndex(w.id));
  // 线下的段与作品的段在同一个域里，一起带走（见 ARCHITECTURE 4.117）
  const beatRows = [...sceneRows, ...chapterRows].flatMap(x => beats.byIndex(x.id));
  const tripRows = chatRows.flatMap(c => trips.byIndex(c.id));
  const spaceRows = chatRows.flatMap(c => spaceItems.byIndex(c.id));
  // 美化可以几段会话共用一份，去一次重
  const skinRows = [...new Set(chatRows.map(c => c.skinId).filter(Boolean))]
    .map(id => skins.get(id)).filter(Boolean);

  // 挂在这几个角色上的
  const dayRows = history ? cast.flatMap(c => days.byIndex(c.id)) : none;
  const mealRows = history ? cast.flatMap(c => meals.byIndex(c.id)) : none;
  const healthRows = history ? cast.flatMap(c => health.byIndex(c.id)) : none;
  const phoneRows = history ? cast.flatMap(c => phones.byIndex(c.id)) : none;
  const phoneChatRows = history ? cast.flatMap(c => phoneChats.byIndex(c.id)) : none;
  const momentRows = history ? moments.where(m => castIds.has(m.authorId)) : none;
  const reviewRows = history ? reviews.where(r => castIds.has(r.charId)) : none;
  const noteRows = history ? readnotes.where(r => castIds.has(r.authorId)) : none;
  const todoRows = history ? todos.where(t => castIds.has(t.charId)) : none;

  // 要跟着走的图片与音频
  const imgIds = new Set();
  const fileIds = new Set();
  cast.forEach(c => {
    [c.avatar, c.cover, c.faceImage, c.callImage].forEach(id => id && imgIds.add(id));
    (c.avatarPool || []).forEach(x => x?.imageId && imgIds.add(x.imageId));
    // 主页上那一排精选
    (c.highlights || []).forEach(h => h?.imageId && imgIds.add(h.imageId));
    // 角色书架上自己换过的封面
    (c.shelf || []).forEach(it => it?.cover && imgIds.add(it.cover));
  });
  msgRows.forEach(m => {
    if (m.imageId) imgIds.add(m.imageId);
    if (m.audioId) fileIds.add(m.audioId);
  });
  momentRows.forEach(m => (m.images || []).forEach(id => id && imgIds.add(id)));
  // 那台手机上的三处图：相册、壁纸、换过的应用图标
  phoneRows.forEach(row => {
    (row.photos || []).forEach(p => p?.imageId && imgIds.add(p.imageId));
    if (row.wallpaper) imgIds.add(row.wallpaper);
    Object.values(row.icons || {}).forEach(v => v?.imageId && imgIds.add(v.imageId));
  });

  return {
    main, cast, books,
    chats: chatRows, messages: msgRows, memories: memRows,
    scenes: sceneRows, works: workRows, chapters: chapterRows, beats: beatRows, trips: tripRows, spaceItems: spaceRows, skins: skinRows,
    days: dayRows, meals: mealRows, health: healthRows,
    phones: phoneRows, phoneChats: phoneChatRows,
    moments: momentRows, reviews: reviewRows, readnotes: noteRows, todos: todoRows,
    imgIds: [...imgIds].filter(id => images.has(id)),
    fileIds: [...fileIds].filter(id => files.info(id)),
  };
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
    scenes: g.scenes.length,
    works: g.works.length,
    chapters: g.chapters.length,
    extras: g.trips.length + g.spaceItems.length + g.days.length + g.meals.length
      + g.health.length + g.phones.length + g.phoneChats.length + g.moments.length
      + g.reviews.length + g.readnotes.length + g.todos.length,
    skins: g.skins.length,
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
    // 记忆身上那个向量是 Float32Array，直接进 JSON 会烂掉，见 system/typed.js
    memories: g.memories.map(m => packRow('memories', m)),
    chats: g.chats,
    messages: g.messages,
    scenes: g.scenes,
    works: g.works,
    chapters: g.chapters,
    beats: g.beats,
    trips: g.trips,
    spaceItems: g.spaceItems,
    skins: g.skins,
    days: g.days,
    meals: g.meals,
    health: g.health,
    phones: g.phones,
    phoneChats: g.phoneChats,
    moments: g.moments,
    reviews: g.reviews,
    readnotes: g.readnotes,
    todos: g.todos,
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

// 除会话、消息、记忆、线下、美化之外，跟着角色走的那几域。界面上报一个总数
const EXTRA_KINDS = ['trips', 'spaceItems', 'days', 'meals', 'health',
  'phones', 'phoneChats', 'moments', 'reviews', 'readnotes', 'todos'];

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
    scenes: (data.scenes || []).length,
    works: (data.works || []).length,
    skins: (data.skins || []).length,
    // 那一堆按角色或会话挂着的小东西，界面上合成一句话，不逐项报数
    extras: EXTRA_KINDS.reduce((n, k) => n + (data[k] || []).length, 0),
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

  // 撞了就整包换一套 id。**每一域都要各记一张 id 表**：下面那些行
  // 互相指着（线下的段指着场次、待办指着消息、美化被会话指着），
  // 少一张表就是一堆指向空处的行
  const fresh = (map, col, row, prefix) => {
    const id = (copied || col.has(row.id)) ? uid(prefix) : row.id;
    map.set(row.id, id);
    return id;
  };
  const who = id => (id === 'me' || !id ? id : remap(id));

  // 美化。会话指着它，所以先放。
  // 规矩和世界书一样：id 撞了用本机那一份，不覆盖 —— 一份美化常被几段会话
  // 共用，盖掉等于替别的会话改样子；同一个包导两次也不该多出一份同名的
  const skinMap = new Map();
  (data.skins || []).forEach(k => {
    if (!k || !k.id) return;
    if (skins.has(k.id)) { skinMap.set(k.id, k.id); return; }
    skins.put({ ...k });
    skinMap.set(k.id, k.id);
  });

  // 会话与消息
  const chatMap = new Map();
  (data.chats || []).forEach(c => {
    const id = fresh(chatMap, chats, c, 'chat');
    chats.put({
      ...c, id, personaId: me,
      characterIds: (c.characterIds || []).map(remap),
      skinId: c.skinId ? (skinMap.get(c.skinId) || '') : '',
    });
  });
  const msgMap = new Map();
  (data.messages || []).forEach(m => {
    const chatId = chatMap.get(m.chatId);
    if (!chatId) return;                       // 会话没带进来的消息不要
    const id = fresh(msgMap, messages, m, 'msg');
    messages.put({ ...m, id, chatId, authorId: who(m.authorId) });
  });

  // 记忆。同一个角色的记忆各身份分开存，这里一律归到当前账号名下
  (data.memories || []).forEach(raw => {
    const m = unpackRow('memories', raw);
    const id = (copied || memories.has(m.id)) ? uid('mem') : m.id;
    memories.put({ ...m, id, charId: remap(m.charId), personaId: me });
  });

  // ---- 挂在会话上的那几域 ----
  // 正文的归属：一场戏，或者一部作品的一篇。两种 id 都记在这一张表上
  const proseMap = new Map();
  (data.scenes || []).forEach(sc => {
    const chatId = chatMap.get(sc.chatId);
    if (!chatId) return;
    scenes.put({
      ...sc, id: fresh(proseMap, scenes, sc, 'sc'), chatId,
      castIds: (sc.castIds || []).map(remap),
    });
  });
  // 「我们」的作品与每一篇。正文和线下共用 beats，所以两张表一起查
  const workMap = new Map();
  (data.works || []).forEach(w => {
    const chatId = chatMap.get(w.chatId);
    if (!chatId) return;
    works.put({
      ...w, id: fresh(workMap, works, w, 'wk'), chatId,
      castIds: (w.castIds || []).map(remap),
    });
  });
  (data.chapters || []).forEach(c => {
    const workId = workMap.get(c.workId);
    if (!workId) return;
    chapters.put({ ...c, id: fresh(proseMap, chapters, c, 'cp'), workId });
  });
  (data.beats || []).forEach(b => {
    const owner = proseMap.get(b.sceneId);
    if (!owner) return;
    const id = (copied || beats.has(b.id)) ? uid('bt') : b.id;
    beats.put({ ...b, id, sceneId: owner, authorId: who(b.authorId) });
  });
  (data.trips || []).forEach(t => {
    const chatId = chatMap.get(t.chatId);
    if (!chatId) return;
    const id = (copied || trips.has(t.id)) ? uid('tr') : t.id;
    trips.put({ ...t, id, chatId });
  });
  (data.spaceItems || []).forEach(x => {
    const chatId = chatMap.get(x.chatId);
    if (!chatId) return;
    const id = (copied || spaceItems.has(x.id)) ? uid('si') : x.id;
    spaceItems.put({ ...x, id, chatId });
  });

  // ---- 挂在角色上的那几域 ----
  const mine = new Set(cast.map(c => c.id));
  const byChar = (rows, col, prefix, key) => (rows || []).forEach(r => {
    if (!r || !mine.has(r[key])) return;
    const id = (copied || col.has(r.id)) ? uid(prefix) : r.id;
    col.put({ ...r, id, [key]: remap(r[key]) });
  });
  byChar(data.days, days, 'day', 'charId');
  byChar(data.meals, meals, 'ml', 'charId');
  byChar(data.health, health, 'hl', 'who');
  byChar(data.phones, phones, 'ph', 'charId');

  (data.phoneChats || []).forEach(r => {
    if (!r || !mine.has(r.charId)) return;
    const id = (copied || phoneChats.has(r.id)) ? uid('pc') : r.id;
    phoneChats.put({ ...r, id, charId: remap(r.charId), npcId: r.npcId ? remap(r.npcId) : '' });
  });
  (data.moments || []).forEach(r => {
    if (!r || !mine.has(r.authorId)) return;
    const id = (copied || moments.has(r.id)) ? uid('mo') : r.id;
    moments.put({
      ...r, id, authorId: remap(r.authorId),
      likes: (r.likes || []).map(who),
      comments: (r.comments || []).map(c => ({ ...c, authorId: who(c.authorId) })),
    });
  });

  // 影评书评与段评指着本机的书或片子。那两样是使用者自己的库，不在角色包里，
  // 所以对方没有那一本时这几条就落不下去 —— 落下去也没有一处显示得到它
  let dropped = 0;
  const hasSubject = (kind, id) => (kind === 'video' ? videos.has(id) : ebooks.has(id));
  (data.reviews || []).forEach(r => {
    if (!r || !mine.has(r.charId)) return;
    if (!hasSubject(r.kind, r.subjectId)) { dropped += 1; return; }
    const id = (copied || reviews.has(r.id)) ? uid('rev') : r.id;
    reviews.put({ ...r, id, charId: remap(r.charId) });
  });
  (data.readnotes || []).forEach(r => {
    if (!r || !mine.has(r.authorId)) return;
    if (!hasSubject(r.bookId ? 'book' : 'video', r.bookId || r.videoId)) { dropped += 1; return; }
    const id = (copied || readnotes.has(r.id)) ? uid('rn') : r.id;
    readnotes.put({ ...r, id, authorId: remap(r.authorId) });
  });

  (data.todos || []).forEach(t => {
    if (!t || !mine.has(t.charId)) return;
    const id = (copied || todos.has(t.id)) ? uid('td') : t.id;
    todos.put({
      ...t, id, charId: remap(t.charId),
      chatId: t.chatId ? (chatMap.get(t.chatId) || '') : '',
      srcMsgId: t.srcMsgId ? (msgMap.get(t.srcMsgId) || '') : '',
    });
  });

  return {
    charId: remap(data.character.id),
    copied,
    chats: (data.chats || []).length,
    messages: (data.messages || []).length,
    memories: (data.memories || []).length,
    scenes: (data.scenes || []).length,
    works: (data.works || []).length,
    media: mediaCount,
    dropped,
  };
}
