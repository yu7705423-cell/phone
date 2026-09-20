import { memories } from './db/index.js';
import { gramsOf, sim } from './textsim.js';

// 记忆体检：同一件事的两个版本、以及互相打架的两条。
//
// ---- 为什么非要有这一层 ----
//
// 从前只有一道防线：提取的时候让模型用 updateId 指出「这条取代那条」。
// 它漏的时候很多 —— 发过去的已有记忆还可能被裁剪过（memoryDedupeList），
// 它根本没看见旧那条。**漏了之后永远不会再被发现**，没有任何地方回头
// 检查库里有没有打架的两条。于是「她说喜欢猫」和「她怕猫」并排躺着，
// 角色只能瞎猜，或者两句都顺着说。
//
// ---- 取代，不是删除 ----
//
// 旧那条标 supersededBy，不再参与召回，但**留在库里，页面上还看得见**。
// 删掉的是人的回忆，不能因为算出来两条像就悄悄抹掉一条。
//
// ---- 两道门槛 ----
//
// 像到 SURE 以上：同一句话的两个写法，自动取代，不问。
// 像在 DOUBT 与 SURE 之间：可能是同一件事，也可能只是句式像，**只标出来**，
// 由人在「体检」那一页决定。自动合并这一档会误伤 ——
// 「她喜欢猫」与「她喜欢狗」在字面上也很像。

export const SURE = 0.75;
export const DOUBT = 0.5;

// 天生只该有一个值的那几样。同一个槽位来了新的，旧的直接让位 ——
// 把矛盾在结构上消灭掉，比事后打捞省事。
//
// **只列最容易冲突的那几个。** 槽位表一长就成了第二套角色卡，
// 而角色卡本来就在那儿。
export const SLOTS = {
  occupation: '职业', location: '常住地', birthday: '生日',
  school: '学校', family: '家庭', contact: '联系方式',
};

const alive = m => !m.supersededBy;

/** 这个角色、这个身份下还在生效的记忆。 */
export function poolOf(charId, personaId, exceptId = '') {
  return memories.where(m => m.id !== exceptId && alive(m)
    && (!m.charId || !charId || m.charId === charId)
    && (!personaId || !m.personaId || m.personaId === personaId));
}

/** 和这一条最像的是哪一条。没有够像的就返回 null。 */
export function nearest(row, pool) {
  const g = gramsOf(row.content || '');
  let best = null;
  for (const m of pool) {
    const s = sim(g, gramsOf(m.content || ''));
    if (!best || s > best.score) best = { m, score: s };
  }
  return best && best.score >= DOUBT ? best : null;
}

/** 旧的让位给新的。回来的是被取代的那一条。 */
export function supersede(oldId, newId) {
  const old = memories.get(oldId);
  if (!old || old.id === newId) return null;
  memories.update(oldId, { supersededBy: newId });
  return memories.get(oldId);
}

/**
 * 刚落库的这一条要不要顶掉谁。回来的是被顶掉的那几条。
 *
 * 两种情况顶：同一个槽位（职业、常住地这些只该有一个值的），
 * 或者像到 SURE 以上。其余只在体检页上标出来，不动手。
 */
export function settleNew(row) {
  if (!row || !row.content) return [];
  const pool = poolOf(row.charId, row.personaId, row.id);
  const out = [];

  if (row.slot && SLOTS[row.slot]) {
    pool.filter(m => m.slot === row.slot).forEach(m => {
      const gone = supersede(m.id, row.id);
      if (gone) out.push(gone);
    });
    return out;
  }

  const near = nearest(row, pool);
  if (near && near.score >= SURE) {
    // 新的顶掉旧的。两条谁新看记的时间，不看谁后落库 ——
    // 补总结一段半年前的历史时，后落库的那条反而是旧事
    const a = Number(row.createdAt) || 0;
    const b = Number(near.m.createdAt) || 0;
    const gone = a >= b ? supersede(near.m.id, row.id) : supersede(row.id, near.m.id);
    if (gone) out.push(gone);
  }
  return out;
}

/**
 * 体检：库里还剩哪些疑似同一件事的成对条目。
 *
 * 只给还在生效的那些配对，已经让过位的不再参与 —— 它们已经有结论了。
 */
export function pairs(charId = '', personaId = '', limit = 50) {
  const list = poolOf(charId, personaId);
  const grams = list.map(m => gramsOf(m.content || ''));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const score = sim(grams[i], grams[j]);
      if (score >= DOUBT) out.push({ a: list[i], b: list[j], score });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** 已经让过位的那些。体检页上单列一栏，可以撤回。 */
export function superseded(charId = '') {
  return memories.where(m => m.supersededBy
    && (!charId || !m.charId || m.charId === charId));
}

/** 撤回一次让位。 */
export const restore = id => memories.update(id, { supersededBy: '' });
