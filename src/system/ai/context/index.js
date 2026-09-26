import { character, user, time } from './basic.js';
import * as lorebook from './lorebook.js';
import * as memory from './memory.js';
import * as spaceBlock from './space.js';
import * as dayBlock from './day.js';
import * as avatarBlock from './avatar.js';
import * as geoBlock from './geo.js';
import * as musicBlock from './music.js';
import * as watchBlock from './watch.js';
import * as billBlock from './bill.js';
import * as tripBlock from './trip.js';
import * as healthBlock from './health.js';
import * as bridgeBlock from './bridge.js';
import * as planBlock from './plan.js';
import * as badgesBlock from './badges.js';
import * as momentsBlock from './moments.js';
import * as closetBlock from './closet.js';

import * as altsBlock from './alts.js';

export const BLOCKS = {
  character,
  // 世界书拆成两块：一块在角色卡之前，一块在之后。哪一条落在哪一块
  // 由条目自己的 part 决定，这里只是两个可以单独排位置的注入点。
  lorebook: { meta: lorebook.meta, build: lorebook.build },
  loreAfter: { meta: lorebook.metaAfter, build: lorebook.buildAfter },
  user,
  time,
  // 记忆分两层：底色常驻在设定区，召回按深度插进对话（见 4.91）
  bond: { meta: memory.metaBond, build: memory.buildBond },
  // 钉住的与忌讳的。和底色一样常驻，所以挨着它放
  pinned: { meta: memory.metaPinned, build: memory.buildPinned },
  // 最近记下的那几条。不问相关不相关，按时间带上 —— 召回的候选池只收
  // 线索命中的和还没了结的，昨天的事一个词都对不上就进不去（见 memory.js）
  recent: { meta: memory.metaRecent, build: memory.buildRecent },
  memory: { meta: memory.meta, build: memory.build },
  space: { meta: spaceBlock.meta, build: spaceBlock.build },
  day: { meta: dayBlock.meta, build: dayBlock.build },
  avatar: { meta: avatarBlock.meta, build: avatarBlock.build },
  geo: { meta: geoBlock.meta, build: geoBlock.build },
  music: { meta: musicBlock.meta, build: musicBlock.build },
  watch: { meta: watchBlock.meta, build: watchBlock.build },
  bill: { meta: billBlock.meta, build: billBlock.build },
  trip: { meta: tripBlock.meta, build: tripBlock.build },
  health: { meta: healthBlock.meta, build: healthBlock.build },
  // 线上与线下之间那一段。两边各看到对面的一点，方向由 ctx.side 决定
  bridge: { meta: bridgeBlock.meta, build: bridgeBlock.build },
  // 用户自己记下的事。待办一直存着，却从来没进过 prompt
  plan: { meta: planBlock.meta, build: planBlock.build },
  // 互动标识。这段对话开了「让角色知道」才有内容
  badges: { meta: badgesBlock.meta, build: badgesBlock.build },
  // 用户自己发的朋友圈。从前角色一条都看不到
  moments: { meta: momentsBlock.meta, build: momentsBlock.build },
  // 衣帽间：今天穿的、聊到穿搭时的清单、隔很久才出现一次的快用完
  closet: { meta: closetBlock.meta, build: closetBlock.build },
  // 本体与小号互相知道对方那边最近聊了什么（4.259）
  alts: { meta: altsBlock.meta, build: altsBlock.build },
};

export const DEFAULT_ORDER = ['lorebook', 'bond', 'pinned', 'recent', 'character', 'loreAfter', 'user', 'alts', 'time', 'day', 'avatar', 'geo', 'music', 'watch', 'trip', 'bill', 'health', 'closet', 'memory', 'space', 'plan', 'moments', 'bridge', 'badges'];

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

// ---- 每轮都变的那几块要下沉 ----
//
// prompt 缓存只认**完全相同的前缀**（Anthropic 的前缀按 tools、system、
// messages 的次序生成，OpenAI 那边是自动前缀缓存）。而时间块每分钟都不一样，
// 它从前排在设定区第八位 —— 它下面的一切，包括消息规则、整份能力清单、
// 核心设定这几段又长又稳的，**每一轮都得重新算一遍钱**。
//
// 所以把「不需要用户动手也会自己变」的那几块从设定区搬到对话末尾，和本轮
// 召回放在一起。两头都合算：设定区连成一整段稳定前缀，缓存命中；而末尾
// 恰恰是注意力最强的位置（Lost in the Middle 那条 U 形曲线的右端），
// 「现在几点」「你们正在看到哪儿」本来就该贴着最后一句话。
//
// 不在这张表里的（世界书、人设、关系底色、用户资料、距离、你们之间）
// 只在用户改了设定或数据时才变，留在设定区。
export const VOLATILE = new Set([
  'time',     // 每分钟
  'day',      // 时段一过就换，事项勾一下就换
  'music',    // 正在听哪一首、听到哪一句
  'watch',    // 正在看哪一段、刚过去的几句台词
  'avatar',   // 本来就只出现一轮
  'trip',     // 第几天、今天排了什么
  'bill',     // 余额随转账变
  'health',   // 今天的那几项
  'bridge',   // 对面刚发生的事，每一条消息、每一段正文都在变
  'plan',     // 勾掉一条就少一条，到点了措辞也变
  'badges',   // 每天都在变，解锁了就多一行
  'moments',  // 「多久以前」每天都在变，发一条、评一句也变
  'closet',   // 今天穿的每天换；清单随聊的话题出现、消失
  'recent',   // 一提取就换一批，而且「多久以前」每天都在变
]);

/**
 * 只拼指定的那几块，不补齐缺的。群聊用：设定区里有的块全群共用一份（世界书、
 * 你是谁、时间），有的块每个成员各一份（人设、记忆）—— 两边各拼各的，
 * 走 assemble 的话 resolveOrder 会把没点名的块全补回来。
 */
export function assembleOnly(ids, ctx) {
  let out = '';
  let hot = '';
  for (const id of ids) {
    const block = BLOCKS[id];
    if (!block) continue;
    let text = '';
    try { text = block.build(ctx) || ''; }
    catch (err) { console.error(`[prompt] 区块 ${id} 构建失败`, err); }
    if (!text) continue;
    if (VOLATILE.has(id)) hot += text; else out += text;
  }
  return { text: out, volatile: hot };
}

// 每个区块单独 try/catch,一个区块出错不拖垮整个 prompt。
// 回来的是两段：留在设定区的，和要下沉到对话末尾的。
export function assemble(order, ctx) {
  let out = '';
  let hot = '';
  const failed = [];
  for (const id of resolveOrder(order)) {
    const block = BLOCKS[id];
    if (!block) continue;
    let text = '';
    try { text = block.build(ctx) || ''; }
    catch (err) { failed.push(id); console.error(`[prompt] 区块 ${id} 构建失败`, err); }
    if (!text) continue;
    if (VOLATILE.has(id)) hot += text; else out += text;
  }
  return { text: out, volatile: hot, failed };
}
