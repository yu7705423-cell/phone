import { chats, characters, memories, messages, messagesOf, moments, personas, stickers,
         settings, layout, images, files } from './db/index.js';
import { allImageIds } from './looks.js';

// 把一个角色身上的东西清干净。
//
// **按角色算，不按会话算。** 同一个角色可以和好几个身份各有一段会话
// （记忆也是按 charId + personaId 分开存的），站在角色卡上说「清空」，
// 指的是这个角色名下的全部，不是你此刻碰巧开着的那一段。
// 所以每个动作都先把账摆出来：几段会话、多少条消息、多少条记忆。
//
// 图片和语音是另存的，删消息时要跟着删，否则它们会一直占着空间 ——
// 设置里那个「清理无引用图片」是补救，不该指望用户记得去按。

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
 *
 * memoryUpTo / memoryTriedId / summary 一并归零：它们记的是「提取到哪条了」，
 * 消息都没了还留着这几个游标，下次提取会从一个不存在的位置往后找。
 */
export function clearHistory(charId) {
  const list = chatsOf(charId);
  let n = 0;
  for (const chat of list) {
    for (const m of messagesOf(chat.id)) {
      if (m.imageId) images.remove(m.imageId);
      if (m.audioId) files.remove(m.audioId);
    }
    n += messages.removeWhere(m => m.chatId === chat.id);
    chats.update(chat.id, { memoryUpTo: null, memoryTriedId: null, summary: '', unread: 0 });
  }
  return n;
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
 *
 * **漏一处就是删一批。** 这张单子从前写在设置页里，只认角色头像、封面、
 * 动态、身份、壁纸、图标、表情和外观预设 —— 聊天记录里的图、角色的通话
 * 背景与脸部参考、头像池里的那些，一个都没算进去。按那张单子清一遍，
 * 这些会全部删掉，而按钮上写的是「删除未被任何角色或动态引用的图片」。
 *
 * 挪到这里，是因为「谁引用了图片」是数据层自己的事，不是某一个设置页的事。
 * 往 images 里存东西的地方，都要在这里留一行。
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

  // 外观预设里的图也算有引用，否则一清理，存好的预设就成了空壳
  allImageIds().forEach(add);
  // 字体存在 files 域，不在这一批里，删字体走「主题」那边
  return used;
}

/** 没有任何地方引用的那些图片。 */
export function orphanImageIds() {
  const used = usedImageIds();
  return images.ids().filter(id => !used.has(id));
}
