import { idb, write } from './idb.js';
import { createStore, uid } from '../store.js';

// 内存镜像 + 异步落盘。UI 同步读取,写入排队持久化。
export function makeCollection(name, prefix) {
  const map = new Map();
  const store = createStore({ v: 0 });
  const bump = () => store.set({ v: store.get().v + 1 });

  return {
    name,
    store,

    async load() {
      const rows = await idb.all(name);
      map.clear();
      rows.forEach(r => map.set(r.id, r));
      bump();
    },

    all() { return [...map.values()]; },
    get(id) { return map.get(id) || null; },
    has(id) { return map.has(id); },
    count() { return map.size; },

    where(fn) { return [...map.values()].filter(fn); },

    create(data = {}) {
      const now = Date.now();
      const row = { id: data.id || uid(prefix), createdAt: now, updatedAt: now, ...data };
      map.set(row.id, row);
      bump();
      write(name, () => idb.put(name, row));
      return row;
    },

    update(id, patch) {
      const cur = map.get(id);
      if (!cur) return null;
      const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), updatedAt: Date.now() };
      map.set(id, next);
      bump();
      write(name, () => idb.put(name, next));
      return next;
    },

    put(row) {
      map.set(row.id, row);
      bump();
      write(name, () => idb.put(name, row));
      return row;
    },

    remove(id) {
      if (!map.delete(id)) return false;
      bump();
      write(name, () => idb.del(name, id));
      return true;
    },

    removeWhere(fn) {
      const doomed = [...map.values()].filter(fn);
      if (!doomed.length) return 0;
      doomed.forEach(r => map.delete(r.id));
      bump();
      write(name, () => Promise.all(doomed.map(r => idb.del(name, r.id))));
      return doomed.length;
    },

    async clear() {
      map.clear();
      bump();
      await write(name, () => idb.clear(name));
    },
  };
}
