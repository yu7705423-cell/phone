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
// 情侣空间里自己存的那两样：纪念日、还没寄出的信。别的都是消息的视图。
export const spaceItems = makeCollection('spaceItems', 'si', { indexBy: 'chatId' });
// 随机事件库。按「领域 × 色彩」分格，索引就建在这个格子上。
export const events     = makeCollection('events', 'ev', { indexBy: 'cell' });

const COLLECTIONS = { characters, lorebooks, memories, chats, messages, moments, stickers, looks, personas, songs, playlists, spaceItems, events };

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
  songs, playlists, spaceItems, events,
  images, files, settings, persona, layout,
  messagesOf, lastMessageOf, ready,
};
