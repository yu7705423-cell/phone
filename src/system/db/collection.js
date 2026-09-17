import { idb, writeRow, deleteRow, deleteRows, clearRows } from './idb.js';
import { createStore, uid } from '../store.js';

// 内存镜像 + 异步落盘。UI 同步读取,写入排队持久化。
//
// indexBy 给一个字段名，就顺手维护一张二级索引。消息按 chatId 建了一张：
// 没有它的时候，翻一个会话的消息要把全库扫一遍，消息列表一屏二十个会话
// 就是二十遍全库扫描 —— 聊得越久越卡，而卡的地方跟这个会话有多长没关系。
//
// 每个桶还各自带一个版本号。改了 A 会话的消息只动 A 的版本，
// 读 B 的那份缓存不用跟着作废。
export function makeCollection(name, prefix, { indexBy = '' } = {}) {
  const map = new Map();
  const store = createStore({ v: 0 });
  const buckets = indexBy ? new Map() : null;   // 值 -> Map<id, row>
  const bucketV = indexBy ? new Map() : null;   // 值 -> 版本号
  const bump = () => store.set({ v: store.get().v + 1 });

  const touch = key => {
    if (key === undefined || key === null) return;
    bucketV.set(key, (bucketV.get(key) || 0) + 1);
  };
  const attach = row => {
    if (!indexBy) return;
    const key = row[indexBy];
    if (key === undefined || key === null) return;
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = new Map());
    b.set(row.id, row);
    touch(key);
  };
  const detach = row => {
    if (!indexBy || !row) return;
    const key = row[indexBy];
    const b = buckets.get(key);
    if (!b) return;
    b.delete(row.id);
    if (!b.size) buckets.delete(key);
    touch(key);
  };
  const reindex = (prev, next) => {
    if (!indexBy) return;
    if (prev && prev[indexBy] !== next[indexBy]) detach(prev);
    attach(next);
  };

  return {
    name,
    store,
    indexBy,

    async load() {
      const rows = await idb.all(name);
      map.clear();
      if (indexBy) { buckets.clear(); bucketV.clear(); }
      rows.forEach(r => { map.set(r.id, r); attach(r); });
      bump();
    },

    all() { return [...map.values()]; },
    // 不复制地遍历。十万条的时候 all() 光是把 Map 抄成数组就要几十毫秒，
    // 只是想过一遍的地方用这个。
    each(fn) { map.forEach(fn); },
    get(id) { return map.get(id) || null; },
    has(id) { return map.has(id); },
    count() { return map.size; },

    where(fn) { return [...map.values()].filter(fn); },

    // 索引桶里的行。没建索引就退回全表过滤，行为一样，只是慢。
    byIndex(key) {
      if (!indexBy) return this.where(r => r[indexBy] === key);
      const b = buckets.get(key);
      return b ? [...b.values()] : [];
    },
    // 这个桶的版本号。只要它没变，上一次算出来的结果就还能用。
    indexVersion(key) { return indexBy ? (bucketV.get(key) || 0) : store.get().v; },

    // persist: false —— 只改内存镜像和界面，不落盘。
    // 给流式回复那种「一秒改几十次、最后还要删掉」的占位行用：
    // 中间每一版都写一次盘，写的全是马上要作废的东西。
    create(data = {}, { persist = true } = {}) {
      const now = Date.now();
      const row = { id: data.id || uid(prefix), createdAt: now, updatedAt: now, ...data };
      map.set(row.id, row);
      attach(row);
      bump();
      if (persist) writeRow(name, row);
      return row;
    },

    update(id, patch, { persist = true } = {}) {
      const cur = map.get(id);
      if (!cur) return null;
      const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), updatedAt: Date.now() };
      map.set(id, next);
      reindex(cur, next);
      bump();
      if (persist) writeRow(name, next);
      return next;
    },

    put(row) {
      reindex(map.get(row.id), row);
      map.set(row.id, row);
      bump();
      writeRow(name, row);
      return row;
    },

    remove(id) {
      const cur = map.get(id);
      if (!map.delete(id)) return false;
      detach(cur);
      bump();
      deleteRow(name, id);
      return true;
    },

    removeWhere(fn) {
      const doomed = [...map.values()].filter(fn);
      if (!doomed.length) return 0;
      doomed.forEach(r => { map.delete(r.id); detach(r); });
      bump();
      deleteRows(name, doomed.map(r => r.id));
      return doomed.length;
    },

    async clear() {
      map.clear();
      if (indexBy) { buckets.forEach((_, k) => touch(k)); buckets.clear(); }
      bump();
      await clearRows(name);
    },
  };
}
