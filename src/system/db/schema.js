export const DB_NAME = 'phone';
export const DB_VERSION = 23;

// 每个数据域一个对象仓库。新增仓库时提升 DB_VERSION 并在 upgrade 里补建。
export const STORES = [
  'characters', 'lorebooks', 'memories',
  'chats', 'messages', 'moments',
  'stickers',
  'looks', 'personas',
  'songs', 'playlists', 'videos',
  'spaceItems',
  'events', 'days', 'todos', 'notes', 'recipes', 'meals',
  'books', 'entries',
  'ebooks', 'reviews', 'readnotes',
  'health', 'cycles', 'meds',
  'albums', 'photos', 'shots',
  'phones', 'phoneChats',
  'trips',
  'scenes', 'beats', 'skins',
  'works', 'chapters',
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
export const DATA_VERSION = 8;

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

  // 4: 世界书条目的位置从一个 position 拆成两个字段。
  //    原来三档 system / beforeChat / afterChat 其实都落在同一个设定区里，
  //    只是排序不同 —— 名字里的 "chat" 骗了人，它们谁都没进过对话。
  //    现在 part 决定在角色卡前还是后，depth 决定插不插进对话、插多深。
  4({ lorebooks, settings }) {
    // 拆成两块之后，注入顺序里也要跟着分开：角色前那块挪到角色卡前面，
    // 角色后那块插在它后面。resolveOrder 只会把新区块补在**末尾**，
    // 老用户不改这一下的话，「角色前」会排在角色卡后面，名不副实。
    const order = settings.get().injectOrder;
    if (Array.isArray(order) && order.includes('character')) {
      const rest = order.filter(id => id !== 'lorebook' && id !== 'loreAfter');
      const at = rest.indexOf('character');
      rest.splice(at, 0, 'lorebook');
      rest.splice(at + 2, 0, 'loreAfter');
      settings.set({ injectOrder: rest });
    }

    lorebooks.all().forEach(b => {
      if (!Array.isArray(b.entries)) return;
      lorebooks.update(b.id, {
        entries: b.entries.map(e => {
          if (e.part) return e;
          const pos = e.position;
          return {
            ...e,
            part: pos === 'system' ? 'before' : 'after',
            // afterChat 想待在对话之后，深度 0 正是那个位置
            depth: 0,
          };
        }),
      });
    });
  },

  // 5: 记忆拆成两层，注入顺序里多了「关系底色」。
  //    和迁移 4 同一个道理：resolveOrder 只把新区块补在末尾，
  //    不改这一下的话，底色会排在角色卡后面，而它讲的是「你们是什么关系」，
  //    应当先于人设出现。
  5({ settings }) {
    const order = settings.get().injectOrder;
    if (!Array.isArray(order) || !order.includes('character')) return;
    const rest = order.filter(id => id !== 'bond');
    rest.splice(rest.indexOf('character'), 0, 'bond');
    settings.set({ injectOrder: rest });
  },

  // 6: 提示词模板不再整套存进 settings。
  //
  //    老版本把 DEFAULT_TEMPLATES 整个抄进 settings 并落库，而 template()
  //    优先读 settings —— 于是代码里改了默认提示词，老库一个字都吃不到，
  //    而且界面上每一条都显示「已修改」，虽然用户从没动过。
  //
  //    这里把存着的那一套整体挪到 promptTemplatesLegacy，清空 promptTemplates。
  //    新的内置版本立刻生效，此前的文本仍可在模板编辑页里逐条找回。
  6({ settings }) {
    const cur = settings.get().promptTemplates;
    if (!cur || !Object.keys(cur).length) return;
    settings.set({ promptTemplates: {}, promptTemplatesLegacy: cur });
  },

  // 7: 注入顺序里多了「正在一起看」。和迁移 4、5 同一个道理：
  //    resolveOrder 只把新区块补在**末尾**，而它讲的是此刻正在发生的事，
  //    应当排在记忆之前、贴着对话。
  7({ settings }) {
    const order = settings.get().injectOrder;
    if (!Array.isArray(order) || order.includes('watch')) return;
    const rest = [...order];
    const at = rest.indexOf('memory');
    rest.splice(at < 0 ? rest.length : at, 0, 'watch');
    settings.set({ injectOrder: rest });
  },

  // 8: 会话一次画的条数，默认从 200 降到 60。
  //    settings.set 存的是整份合并后的对象，所以只要用户改过任何一项，
  //    老默认值 200 就已经落在库里了，改 DEFAULT_SETTINGS 到不了他那儿。
  //    仍然是 200 的按新默认走；自己改成别的数的不动。
  8({ settings }) {
    if (settings.get().chatPage === 200) settings.set({ chatPage: 60 });
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
