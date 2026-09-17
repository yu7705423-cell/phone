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

// ---- 行级写入合并 ----
//
// 流式回复每来一段就把同一行改一次，一条几百字的回复能改上几百次；
// 导入、批量生成也是一口气几百行。一次一个事务，中间那些版本没人读得到，
// 白白开销。这里按行攒着，同一行只留最后一版，到点一起写。
//
// 只有 collection 的行走这条路：它们写完之后只从内存镜像读，
// 不会有人立刻去 idb 把刚写的那行捞回来。图片和音频不一样,还是走 write()。
// 攒到下一个宏任务就写。一轮 JS 里改多少行都只开一个事务，
// 而落盘还是紧跟着这一轮 —— 不拿用户的数据换吞吐。
// 真正高频的那种（流式回复每来一段改一次）另有办法：调用方传
// persist: false，那一行干脆不落盘，见 collection.update。
const dirty = new Map();          // store -> Map<id, {op, row}>
let timer = null;

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flushWrites(); }, 0);
}

function queueOp(store, id, op) {
  let ops = dirty.get(store);
  if (!ops) dirty.set(store, ops = new Map());
  ops.set(id, op);              // 同一行后到的盖掉先到的
  schedule();
}

export function writeRow(store, row) { queueOp(store, row.id, { op: 'put', row }); }
export function deleteRow(store, id) { queueOp(store, id, { op: 'del' }); }
export function deleteRows(store, ids) { ids.forEach(id => deleteRow(store, id)); }

// 整表清空：攒着的那些还没写就作废了，但仍然排在同一条队列上，保证先后
export function clearRows(store) {
  dirty.delete(store);
  return write(store, () => idb.clear(store));
}

function bulk(store, puts, dels) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    puts.forEach(r => os.put(r));
    dels.forEach(id => os.delete(id));
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('事务被中止'));
  }));
}

// 把攒着的全写下去。页面要走了、或者调用方需要确认已落盘时用。
export function flushWrites() {
  if (timer) { clearTimeout(timer); timer = null; }
  const jobs = [];
  for (const [store, ops] of dirty) {
    const puts = [], dels = [];
    for (const [id, op] of ops) (op.op === 'put' ? puts.push(op.row) : dels.push(id));
    jobs.push(write(store, () => bulk(store, puts, dels)));
  }
  dirty.clear();
  return Promise.all([...jobs, ...queues.values()]);
}

if (typeof window !== 'undefined') {
  // 页面被收走之前尽量写下去。这时候浏览器不保证跑完，但窗口只有 FLUSH_MS，
  // 丢的最多是最后这一下。
  window.addEventListener('pagehide', flushWrites);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWrites();
  });
}
