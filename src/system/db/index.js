import { idb } from './idb.js';
import { makeCollection } from './collection.js';
import { images } from './images.js';
import { files } from './files.js';
import { KV, DATA_VERSION, runMigrations } from './schema.js';
import { DEFAULT_SETTINGS, DEFAULT_PERSONA, DEFAULT_LAYOUT } from './defaults.js';
import { createStore } from '../store.js';

export const characters = makeCollection('characters', 'char');
export const lorebooks  = makeCollection('lorebooks', 'lb');
export const memories   = makeCollection('memories', 'mem');
export const chats      = makeCollection('chats', 'chat');
export const messages   = makeCollection('messages', 'msg', { indexBy: 'chatId' });
export const moments    = makeCollection('moments', 'mo');
export const stickers   = makeCollection('stickers', 'stk');
export const looks      = makeCollection('looks', 'look');
export const personas   = makeCollection('personas', 'me');
export const songs      = makeCollection('songs', 'song');
export const playlists  = makeCollection('playlists', 'pl');
export const videos     = makeCollection('videos', 'vid');
// 情侣空间里自己存的那两样：纪念日、还没寄出的信。别的都是消息的视图。
export const spaceItems = makeCollection('spaceItems', 'si', { indexBy: 'chatId' });
// 随机事件库。按「领域 × 色彩」分格，索引就建在这个格子上。
export const events     = makeCollection('events', 'ev', { indexBy: 'cell' });
// 角色的一天：一个角色一天一条。日程、抽中的随机事件、当天的大运都在里面。
export const days       = makeCollection('days', 'day', { indexBy: 'charId' });
// 用户自己的待办。角色的日程是 days，你们之间的约定在 spaceItems
export const todos      = makeCollection('todos', 'td');
// 用户自己的备忘。和待办同一个 app 里的两个标签页，但不是一回事：
// 待办是「要做的事」，备忘是「要留着的字」，混在一域里两边的查询都会互相绊
export const notes      = makeCollection('notes', 'nt');
// 食谱库按地区分，地区留空的是通用的。吃饭记录按角色分，抽的时候要回头看。
export const recipes    = makeCollection('recipes', 'rc', { indexBy: 'region' });
export const meals      = makeCollection('meals', 'ml', { indexBy: 'charId' });
// 记账。账本很少，账户内嵌在账本里；流水很多，按账本建索引。
export const books      = makeCollection('books', 'bk');
export const ebooks     = makeCollection('ebooks', 'ebk');
export const reviews    = makeCollection('reviews', 'rev');
export const readnotes  = makeCollection('readnotes', 'rn', { indexBy: 'chatId' });
// 健康。每人每天一行，按「谁」建索引 —— 翻某个人的历史是最常做的事
export const health     = makeCollection('health', 'hl', { indexBy: 'who' });
export const cycles     = makeCollection('cycles', 'cy');
export const meds       = makeCollection('meds', 'md');
// 相册。照片按相册建索引 —— 翻某一本是最常做的事。
// shots 存「存卡片那一刻的美化 CSS 原文」，按内容哈希去重，多张卡片共用一份
export const albums     = makeCollection('albums', 'alb');
export const photos     = makeCollection('photos', 'pho', { indexBy: 'albumId' });
export const shots      = makeCollection('shots', 'sht');
export const entries    = makeCollection('entries', 'en', { indexBy: 'bookId' });
// 角色手机。一个角色一台，锁屏密码、壁纸、图标、备忘录、浏览记录都在这一行里
// —— 那几样都不多，摊成几个域只会多几处要记得登记进备份的地方。
export const phones     = makeCollection('phones', 'ph', { indexBy: 'charId' });
// 那台手机里的聊天。一条会话一行，消息内嵌 —— 生成出来的会话就几十句，
// 不值得再开一个消息域；而且「进去之后再生成」改的正好是一整行。
export const phoneChats = makeCollection('phoneChats', 'pc', { indexBy: 'charId' });
// 一次出行。挂在一段会话上 ——「一起去」这件事长在关系上，和情侣空间同一个理由。
// 攻略条目与票内嵌在行里：那两样总是跟着一次出行一起读、一起删
export const trips      = makeCollection('trips', 'tr', { indexBy: 'chatId' });

const COLLECTIONS = { characters, lorebooks, memories, chats, messages, moments, stickers, looks, personas, songs, playlists, videos, spaceItems, events, days, todos, notes, recipes, meals, books, entries, ebooks, reviews, readnotes, health, cycles, meds, albums, photos, shots, phones, phoneChats, trips };

// ---- kv: settings / persona / layout ----
function makeKV(key, fallback, { deep = false } = {}) {
  const store = createStore(structuredClone(fallback));
  return {
    store,
    get() { return store.get(); },
    async load() {
      const row = await idb.get('kv', key);
      if (!row) { store.replace(structuredClone(fallback)); return; }
      const merged = deep
        ? { ...fallback, ...row.v, promptTemplates: { ...fallback.promptTemplates, ...(row.v.promptTemplates || {}) } }
        : { ...fallback, ...row.v };
      store.replace(merged);
    },
    set(patch) {
      const next = { ...store.get(), ...(typeof patch === 'function' ? patch(store.get()) : patch) };
      store.replace(next);
      idb.put('kv', { k: key, v: next });
      return next;
    },
    replace(next) {
      store.replace(next);
      idb.put('kv', { k: key, v: next });
      return next;
    },
    reset() { return this.replace(structuredClone(fallback)); },
  };
}

export const settings = makeKV(KV.settings, DEFAULT_SETTINGS, { deep: true });
export const persona  = makeKV(KV.persona, DEFAULT_PERSONA);
export const layout   = makeKV(KV.layout, DEFAULT_LAYOUT);

export { images, files };

// ---- 消息按会话取 ----
// 排好序的那份缓存住。会话页每渲染一帧要问一次，流式回复时一秒好几十帧；
// 消息列表一屏二十行，每行也要问一次。桶的版本没变就直接给上一次那份。
const sortedCache = new Map();   // chatId -> { v, list }
export function messagesOf(chatId) {
  const v = messages.indexVersion(chatId);
  const hit = sortedCache.get(chatId);
  if (hit && hit.v === v) return hit.list;
  const list = messages.byIndex(chatId).sort((a, b) => a.createdAt - b.createdAt);
  sortedCache.set(chatId, { v, list });
  return list;
}
export function lastMessageOf(chatId) {
  const list = messagesOf(chatId);
  return list.length ? list[list.length - 1] : null;
}

// 会话删掉之后，它那条缓存要跟着走，否则这个 Map 只涨不落。
//
// 不在三个删除点各写一行 —— 那样以后多一个删除点就又漏一个。挂在 chats 上
// 统一收：缓存条数没超过会话数时直接返回，所以平时这里等于不做事。
chats.store.subscribe(() => {
  if (sortedCache.size <= chats.count()) return;
  for (const id of sortedCache.keys()) if (!chats.has(id)) sortedCache.delete(id);
});

export const ready = (async function boot() {
  await Promise.all([
    ...Object.values(COLLECTIONS).map(c => c.load()),
    images.load(),
    files.load(),
    settings.load(),
    persona.load(),
    layout.load(),
  ]);

  // 上一次是在生成到一半时被收走的，库里可能留着一条「正在输入」的占位。
  // 现在这种占位不落盘了，旧版本留下的还在。开机清掉 —— 它只是个占位，
  // 留着就是一条永远停在那儿、点不开也删不掉的空气泡。
  messages.removeWhere(m => m.kind === 'typing');

  // 全新安装也从 0 跑一遍。迁移本身都是幂等的，而且新库同样需要
  // 迁移里那些「建根账号」之类的初始化。
  const row = await idb.get('kv', KV.schemaVersion);
  const from = row ? row.v : 0;
  if (from < DATA_VERSION) {
    const to = runMigrations(from, { ...COLLECTIONS, settings, persona, layout });
    await idb.put('kv', { k: KV.schemaVersion, v: to });
  }
})();

window.addEventListener('pagehide', () => { images.revokeAll(); files.revokeAll(); });

export const db = {
  characters, lorebooks, memories, chats, messages, moments, stickers, looks, personas,
  songs, playlists, videos, spaceItems, events, days, todos, notes, recipes, meals,
  books, entries, ebooks, reviews, readnotes, health, cycles, meds,
  albums, photos, shots, phones, phoneChats, trips,
  images, files, settings, persona, layout,
  messagesOf, lastMessageOf, ready,
};
