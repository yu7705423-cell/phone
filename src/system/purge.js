import { chats, characters, memories, messages, messagesOf, moments, personas, stickers,
         settings, layout, images, files, videos, songs, ebooks, phones, photos,
         spaceItems, scenes, beats, readnotes, trips, days, meals, health, reviews, todos,
         phoneChats } from './db/index.js';
import { allImageIds } from './looks.js';

// 把一个角色身上的东西清干净。
//
// 按角色算，不按会话算：同一个角色可以和好几个身份各有一段会话，记忆也是
// 按 charId + personaId 分开存的，「清空」指的是这个角色名下的全部。

const chatsOf = charId =>
  chats.all().filter(c => (c.characterIds || []).includes(charId));

const memsOf = charId =>
  memories.all().filter(m => m.charId === charId);

/** 清之前先数一遍。界面要把数目写在确认框里，不能让用户蒙着点。 */
export function counts(charId) {
  const list = chatsOf(charId);
  return {
    chats: list.length,
    messages: list.reduce((n, c) => n + messagesOf(c.id).length, 0),
    memories: memsOf(charId).length,
  };
}

/**
 * 清空这个角色名下所有会话的聊天记录。会话本身留着，只是空了。
 * 那几个游标记的是「提取到哪条了」，消息没了不归零，下次提取会找不到位置。
 */
export function clearHistory(charId) {
  const list = chatsOf(charId);
  let n = 0;
  const imgs = [];
  for (const chat of list) {
    for (const m of messagesOf(chat.id)) {
      if (m.imageId) imgs.push(m.imageId);
      if (m.audioId) files.remove(m.audioId);
    }
    n += messages.removeWhere(m => m.chatId === chat.id);
    chats.update(chat.id, { memoryUpTo: null, memoryTriedId: null, summary: '', unread: 0 });
  }
  releaseImages(imgs);
  return n;
}

/**
 * 消息没了，它的图能不能删，要看还有没有别人指着它 ——「保存到相册」存的是
 * **同一个 id**，不是复制一份。从前删消息直接删图，相册里那一张就成了空框。
 * 所以先把消息删掉，再按引用表看：没人要的才删。
 */
export function releaseImages(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return 0;
  const used = usedImageIds();
  let n = 0;
  list.forEach(id => { if (!used.has(id)) { images.remove(id); n += 1; } });
  return n;
}

/**
 * 删掉一段会话，连同挂在它身上的一切：消息（及其语音、没人共用的图）、
 * 情侣空间里自己存的那两样、线下的场次与正文、出行。
 * 记忆不动 —— 它按角色存，不按会话；段评也不动，它挂在书上。
 *
 * 从前列表页和资料页各删各的，都只删消息和空间，线下、出行、段评留成孤儿，
 * 按会话建的索引指着一段已经不在的会话。删会话只能从这里走。
 */
export function dropChat(chatId) {
  if (!chats.has(chatId)) return false;
  const imgs = [];
  for (const m of messagesOf(chatId)) {
    if (m.imageId) imgs.push(m.imageId);
    if (m.audioId) files.remove(m.audioId);
  }
  messages.removeWhere(m => m.chatId === chatId);
  spaceItems.byIndex(chatId).slice().forEach(x => spaceItems.remove(x.id));
  scenes.byIndex(chatId).slice().forEach(sc => {
    beats.byIndex(sc.id).slice().forEach(b => beats.remove(b.id));
    scenes.remove(sc.id);
  });
  trips.byIndex(chatId).slice().forEach(t => trips.remove(t.id));
  chats.remove(chatId);
  releaseImages(imgs);
  return true;
}

/**
 * 删掉一个角色，连同它名下的一切：会话（走上面的 dropChat）、记忆、动态、
 * 它的每一天与吃饭记录、它那台手机、健康记录、影评书评、它提的待办、
 * 它写的段评，以及它自己的那几张图（头像、封面、通话画面、头像池、书架封面）。
 *
 * 按 charId 建了索引的域，角色没了就成了孤儿，指着一个不存在的人。
 * 从前资料页自己列了五样，后来加的一样都没跟上。删角色只能从这里走。
 */
export function dropCharacter(charId) {
  const c = characters.get(charId);
  if (!c) return false;
  chatsOf(charId).forEach(chat => dropChat(chat.id));
  memories.removeWhere(m => m.charId === charId);
  moments.removeWhere(m => m.authorId === charId);
  days.byIndex(charId).slice().forEach(r => days.remove(r.id));
  meals.byIndex(charId).slice().forEach(r => meals.remove(r.id));
  health.byIndex(charId).slice().forEach(r => health.remove(r.id));
  reviews.removeWhere(r => r.charId === charId);
  todos.removeWhere(t => t.charId === charId);
  readnotes.removeWhere(r => r.authorId === charId);
  const imgs = [c.avatar, c.cover, c.faceImage, c.callImage,
    ...(c.avatarPool || []).map(x => x?.imageId),
    ...(c.shelf || []).map(it => it?.cover)];
  phones.byIndex(charId).slice().forEach(row => {
    (row.photos || []).forEach(p => imgs.push(p.imageId));
    imgs.push(row.wallpaper);
    Object.values(row.icons || {}).forEach(v => imgs.push(v?.imageId));
    phones.remove(row.id);
  });
  phoneChats.byIndex(charId).slice().forEach(r => phoneChats.remove(r.id));
  characters.remove(charId);
  releaseImages(imgs);
  return true;
}

/** 清空这个角色的记忆。各个身份下的都算，和上面同一个道理。 */
export function clearMemories(charId) {
  return memories.removeWhere(m => m.charId === charId);
}

export function clearAll(charId) {
  return { messages: clearHistory(charId), memories: clearMemories(charId) };
}

/**
 * 库里有哪些图片还有人引用。清理无引用图片时照着这张单子留。
 * **漏一处就是删一批**，所以往 images 里存东西的地方都要在这里留一行。
 */
export function usedImageIds() {
  const used = new Set();
  const add = id => id && used.add(id);

  characters.all().forEach(c => {
    add(c.avatar); add(c.cover); add(c.faceImage); add(c.callImage);
    (c.avatarPool || []).forEach(x => add(x?.imageId));
  });
  // 聊天记录里的图：用户发的照片、角色按描述生成的图
  messages.all().forEach(m => add(m.imageId));
  moments.all().forEach(m => (m.images || []).forEach(add));
  personas.all().forEach(p => { add(p.avatar); add(p.cover); });
  stickers.all().forEach(st => add(st.imageId));

  const s = settings.get();
  Object.values(s.appIcons || {}).forEach(v => add(v?.imageId));
  add(s.lastTest);                       // 生图那一页留的最后一张测试图

  const lay = layout.get();
  const w = lay.wallpaper || {};
  add(w.home); add(w.lock);
  (lay.pages || []).forEach(p => (p.cells || []).forEach(c => add(c.config?.imageId)));

  // 相册：自己导入的、从聊天存进来的（和消息共用一个 id）、卡片的光栅图
  photos.all().forEach(p => add(p.imageId));
  // 歌的封面、书的封面、角色书架上换过的封面
  songs.all().forEach(x => add(x.coverId));
  ebooks.all().forEach(x => add(x.cover));
  characters.all().forEach(c => (c.shelf || []).forEach(it => add(it?.cover)));
  // 阅读页与线下各自换过的背景图
  add(s.reader?.bgImage); add(s.stage?.bgImage);
  // 外观预设里的图也算有引用，否则一清理，存好的预设就成了空壳
  allImageIds().forEach(add);
  // 角色手机上的三处图：相册里挂的真图、换过的壁纸、换过的应用图标。
  // 漏任何一处，清理一次那一处就全空了
  phones.all().forEach(row => {
    (row.photos || []).forEach(p => add(p.imageId));
    add(row.wallpaper);
    Object.values(row.icons || {}).forEach(v => add(v?.imageId));
  });
  // 字体存在 files 域，不在这一批里，删字体走「主题」那边
  return used;
}

/** 没有任何地方引用的那些图片。 */
export function orphanImageIds() {
  const used = usedImageIds();
  return images.ids().filter(id => !used.has(id));
}

// ---- files 域：谁在用哪一个 ----
//
// 音视频、字体、书的正文都存在 files 域，而且是**原样存的**（图片进来时会
// 转成 WebP 压一道，这些不会）。所以占地方的大头在这儿，一个没转码的片子
// 几百兆就进去了。
//
// 存储页原来只给一个总数「音频与视频 X GB」，看不到是哪几个、各多大、
// 还在不在用 —— 想清理都不知道从哪下手。下面这一份就是为了那一页。
//
// **和 usedImageIds 同一个道理：漏一处就是删一批。** 往 files 里存东西的
// 地方都要在这里留一行。目前六处：
//
//   videos.fileId          视频库里的片子
//   songs.audioId          音乐库里的歌
//   messages.audioId       会话里的语音
//   ebooks.fileId          书的正文
//   settings.fonts[].fileId    自己传的字体
//   settings.notify.soundFileId 自己传的提示音
//   layout.pages[].cells[].config.fileId  主界面上自己传的 HTML 挂件

/** 每个 file 是被谁用着的。返回 Map<fileId, {kind, label}>。 */
export function fileUsers() {
  const by = new Map();
  const put = (id, kind, label) => { if (id && !by.has(id)) by.set(id, { kind, label }); };

  videos.all().forEach(v => put(v.fileId, 'video', v.title || '未命名视频'));
  songs.all().forEach(g => put(g.audioId, 'song', g.title || '未命名歌曲'));
  ebooks.all().forEach(b => put(b.fileId, 'book', b.title || '未命名书籍'));

  // 语音消息。标上是哪个会话的，删之前看得出要紧不要紧
  messages.all().forEach(m => {
    if (!m.audioId) return;
    const chat = chats.get(m.chatId);
    const who = (chat?.characterIds || [])
      .map(id => characters.get(id)?.name).filter(Boolean).join('、');
    put(m.audioId, 'voice', who ? `与${who}的语音` : '会话中的语音');
  });

  const s = settings.get();
  (s.fonts || []).forEach(f => put(f.fileId, 'font', f.name || '自定义字体'));
  put((s.notify || {}).soundFileId, 'sound', '自定义提示音');
  // 主界面上自己传的挂件是一个 HTML 文件，也在 files 里
  (layout.get().pages || []).forEach(p => (p.cells || [])
    .forEach(c => put(c.config?.fileId, 'widget', c.config?.name || '自定义挂件')));

  return by;
}

export const FILE_KINDS = {
  video: '视频', song: '歌曲', voice: '语音', book: '书籍',
  font: '字体', sound: '提示音', widget: '挂件',
};

/**
 * files 域里每个文件一行，**大的在前**。界面照这个列。
 *
 * 没人引用的那些 use 为 null —— 它们是删起来最安全的一批。
 * 不另给一个「列出无引用的」函数：从这一份里筛一下就是，
 * 两个函数各算一遍迟早会算出两个不一样的答案。
 */
export function fileReport() {
  const by = fileUsers();
  return files.list()
    .map(f => ({ ...f, use: by.get(f.id) || null }))
    .sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
}
