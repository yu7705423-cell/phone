import { DB_NAME, DB_VERSION, STORES } from './schema.js';

let dbp = null;

export function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'kv' ? 'k' : 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB 被其他标签页占用,请关闭后重试'));
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('事务被中止'));
  }));
}

export const idb = {
  all:    store => run(store, 'readonly',  s => s.getAll()),
  get:    (store, key) => run(store, 'readonly',  s => s.get(key)),
  put:    (store, value) => run(store, 'readwrite', s => s.put(value)),
  del:    (store, key) => run(store, 'readwrite', s => s.delete(key)),
  clear:  store => run(store, 'readwrite', s => s.clear()),
  putAll(store, values) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      values.forEach(v => os.put(v));
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    }));
  },
};

// 写入排队。避免高频写入时开出大量并发事务
const queues = new Map();
export function write(store, job) {
  const prev = queues.get(store) || Promise.resolve();
  const next = prev.then(job, job).catch(err => {
    console.error(`[db] ${store} 写入失败`, err);
  });
  queues.set(store, next);
  return next;
}
