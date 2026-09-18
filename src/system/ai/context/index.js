import { character, user, time } from './basic.js';
import * as lorebook from './lorebook.js';
import * as memory from './memory.js';
import * as spaceBlock from './space.js';
import * as dayBlock from './day.js';

export const BLOCKS = {
  character,
  lorebook: { meta: lorebook.meta, build: lorebook.build },
  user,
  time,
  memory: { meta: memory.meta, build: memory.build },
  space: { meta: spaceBlock.meta, build: spaceBlock.build },
  day: { meta: dayBlock.meta, build: dayBlock.build },
};

export const DEFAULT_ORDER = ['character', 'lorebook', 'user', 'time', 'day', 'memory', 'space'];

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
