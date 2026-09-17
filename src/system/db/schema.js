export const DB_NAME = 'phone';
export const DB_VERSION = 4;

// 每个数据域一个对象仓库。新增仓库时提升 DB_VERSION 并在 upgrade 里补建。
export const STORES = [
  'characters', 'lorebooks', 'memories',
  'chats', 'messages', 'moments',
  'stickers',
  'looks',
  'images', 'files', 'kv',
];

// kv 仓库里的固定键
export const KV = {
  settings: 'settings',
  persona: 'persona',
  layout: 'layout',
  schemaVersion: 'schemaVersion',
};

// 业务层数据迁移。与 IndexedDB 的版本升级分开:
// 这里处理的是记录内部结构的变化,而不是仓库的增删。
export const DATA_VERSION = 1;

export const MIGRATIONS = {
  // 1: 初始结构,无需迁移
};

export function runMigrations(from, ctx) {
  let v = from;
  while (v < DATA_VERSION) {
    const step = MIGRATIONS[v + 1];
    if (step) step(ctx);
    v += 1;
  }
  return v;
}
