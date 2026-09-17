export const DB_NAME = 'phone';
export const DB_VERSION = 6;

// 每个数据域一个对象仓库。新增仓库时提升 DB_VERSION 并在 upgrade 里补建。
export const STORES = [
  'characters', 'lorebooks', 'memories',
  'chats', 'messages', 'moments',
  'stickers',
  'looks', 'personas',
  'songs', 'playlists',
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
export const DATA_VERSION = 3;

export const MIGRATIONS = {
  // 1: 初始结构,无需迁移

  // 2: 用户人设从「只有一个」变成「一棵树」。原来那份 persona KV 收成根账号，
  //    已有的会话、记忆全部挂到它名下，等于原封不动地成为大号。
  2({ personas, chats, memories, persona, settings }) {
    const old = persona.get();
    let root = personas.all().find(p => !p.parentId);
    if (!root) {
      root = personas.create({
        name: old.name || '我', avatar: old.avatar || null, cover: old.cover || null,
        signature: old.signature || '', description: old.description || '',
        parentId: null,
      });
    }
    chats.all().forEach(c => { if (!c.personaId) chats.update(c.id, { personaId: root.id }); });
    memories.all().forEach(m => { if (!m.personaId) memories.update(m.id, { personaId: root.id }); });
    settings.set({ activePersonaId: root.id });
  },

  // 3: 记忆不再分「全局 / 角色 / 会话」三档，一律挂在某个角色身上。
  //    全局那一档和「全局世界书」本来就重了，聊天就是一个人一套记忆。
  //    老的 global 记忆没有归属，charId 留空，仍然对所有角色生效，
  //    界面上会单独列出来让你挑个角色或者删掉。
  3({ memories, chats }) {
    memories.all().forEach(m => {
      if (m.charId !== undefined) return;
      const scope = String(m.scope || '');
      let charId = null;
      if (scope.startsWith('character:')) charId = scope.slice(10);
      else if (scope.startsWith('chat:')) {
        charId = (chats.get(scope.slice(5))?.characterIds || [])[0] || null;
      }
      memories.update(m.id, { charId });
    });
  },
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
