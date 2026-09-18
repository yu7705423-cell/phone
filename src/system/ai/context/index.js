import { character, user, time } from './basic.js';
import * as lorebook from './lorebook.js';
import * as memory from './memory.js';
import * as spaceBlock from './space.js';
import * as dayBlock from './day.js';
import * as avatarBlock from './avatar.js';
import * as geoBlock from './geo.js';

export const BLOCKS = {
  character,
  // 世界书拆成两块：一块在角色卡之前，一块在之后。哪一条落在哪一块
  // 由条目自己的 part 决定，这里只是两个可以单独排位置的注入点。
  lorebook: { meta: lorebook.meta, build: lorebook.build },
  loreAfter: { meta: lorebook.metaAfter, build: lorebook.buildAfter },
  user,
  time,
  memory: { meta: memory.meta, build: memory.build },
  space: { meta: spaceBlock.meta, build: spaceBlock.build },
  day: { meta: dayBlock.meta, build: dayBlock.build },
  avatar: { meta: avatarBlock.meta, build: avatarBlock.build },
  geo: { meta: geoBlock.meta, build: geoBlock.build },
};

export const DEFAULT_ORDER = ['lorebook', 'character', 'loreAfter', 'user', 'time', 'day', 'avatar', 'geo', 'memory', 'space'];

// 读出一份干净的顺序:丢掉不认识的 id,补上配置里缺失的。
// 没有这一步,以后每新增一个区块,老用户配置里就少一项,该区块永远不注入,
// 而且是静默失败。见 ARCHITECTURE 4.2 B2
export function resolveOrder(raw) {
  const known = Object.keys(BLOCKS);
  const seen = new Set();
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(id => {
    if (known.includes(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  });
  DEFAULT_ORDER.forEach(id => { if (!seen.has(id)) { seen.add(id); out.push(id); } });
  return out;
}

// 每个区块单独 try/catch,一个区块出错不拖垮整个 prompt
export function assemble(order, ctx) {
  let out = '';
  const failed = [];
  for (const id of resolveOrder(order)) {
    const block = BLOCKS[id];
    if (!block) continue;
    let text = '';
    try { text = block.build(ctx) || ''; }
    catch (err) { failed.push(id); console.error(`[prompt] 区块 ${id} 构建失败`, err); }
    if (text) out += text;
  }
  return { text: out, failed };
}
