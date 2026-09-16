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
export const messages   = makeCollection('messages', 'msg');
export const moments    = makeCollection('moments', 'mo');
export const stickers   = makeCollection('stickers', 'stk');

const COLLECTIONS = { characters, lorebooks, memories, chats, messages, moments, stickers };

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

// ---- 消息按会话索引 ----
export function messagesOf(chatId) {
  return messages.where(m => m.chatId === chatId).sort((a, b) => a.createdAt - b.createdAt);
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

  const row = await idb.get('kv', KV.schemaVersion);
  const from = row ? row.v : DATA_VERSION;
  if (from < DATA_VERSION) {
    const to = runMigrations(from, { ...COLLECTIONS, settings, persona, layout });
    await idb.put('kv', { k: KV.schemaVersion, v: to });
  } else if (!row) {
    await idb.put('kv', { k: KV.schemaVersion, v: DATA_VERSION });
  }
})();

window.addEventListener('pagehide', () => { images.revokeAll(); files.revokeAll(); });

export const db = {
  characters, lorebooks, memories, chats, messages, moments, stickers,
  images, files, settings, persona, layout,
  messagesOf, lastMessageOf, ready,
};
