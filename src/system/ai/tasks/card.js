import { characters } from '../../db/index.js';
import { template, runJSONTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { readText } from '../../doctext.js';

// 角色卡的导入与关联 NPC 生成。
// 资料字段（age / gender / birthday / signature）是纯展示用的，不进 prompt 主体，
// prompt 主体仍然是 persona。

const str = v => String(v ?? '').trim();

export async function parseCard(file) {
  const raw = await readText(file);
  if (!raw) throw new Error('这个文件是空的');
  const system = fillTemplate(template('task.card-import'), { raw: raw.slice(0, 12000) });
  const r = await runJSONTask('card.import', {
    system, key: `card-import:${Date.now()}`, maxTokens: 3000,
  });
  if (!r || !r.persona && !r.name) throw new Error('没能从这份资料里读出角色卡');
  return {
    name: str(r.name) || '未命名',
    age: str(r.age), gender: str(r.gender), birthday: str(r.birthday),
    signature: str(r.signature), persona: str(r.persona),
    scenario: str(r.scenario), firstMessage: str(r.firstMessage),
    exampleDialogue: str(r.exampleDialogue),
    raw,
  };
}

// ---- 关系 ----
// 存在角色自己身上：relations: [{ charId, label }]
// label 的含义统一成「对方是我的什么」，加的时候两边各写一条。

export const relationsOf = charId =>
  (characters.get(charId)?.relations || []).filter(r => characters.has(r.charId));

export function link(aId, bId, labelForA, labelForB) {
  if (!aId || !bId || aId === bId) return;
  const put = (id, otherId, label) => {
    const cur = (characters.get(id)?.relations || []).filter(r => r.charId !== otherId);
    characters.update(id, { relations: [...cur, { charId: otherId, label: str(label) }] });
  };
  put(aId, bId, labelForA);
  put(bId, aId, labelForB || labelForA);
}

export function unlink(aId, bId) {
  [[aId, bId], [bId, aId]].forEach(([id, otherId]) => {
    const c = characters.get(id);
    if (!c) return;
    characters.update(id, { relations: (c.relations || []).filter(r => r.charId !== otherId) });
  });
}

// 关系网：以某个角色为中心，往外走两层。
// 必须按广度走 —— 深度优先的话，一个既是直接关系、又能从别人那儿绕到的人，
// 会被先当成第二层记下来，画出来的圈就全乱了。
export function graphAround(charId, depth = 2) {
  const nodes = new Map();
  const edges = [];
  let frontier = [charId];
  const seen = new Set([charId]);

  for (let d = 0; d <= depth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const c = characters.get(id);
      if (!c) continue;
      nodes.set(id, { id, name: c.name, avatar: c.avatar, depth: d });
      relationsOf(id).forEach(r => {
        const key = [id, r.charId].sort().join('|');
        if (!edges.some(e => e.key === key)) {
          edges.push({ key, a: id, b: r.charId, label: r.label });
        }
        if (!seen.has(r.charId)) { seen.add(r.charId); next.push(r.charId); }
      });
    }
    frontier = next;
  }
  return { nodes: [...nodes.values()], edges: edges.filter(e => nodes.has(e.a) && nodes.has(e.b)) };
}

// ---- 批量生成关联 NPC ----
export async function generateNpcs(charId, count = 4, { signal } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const known = relationsOf(charId)
    .map(r => `- ${characters.get(r.charId)?.name}（${r.label}）`).join('\n');

  const system = fillTemplate(template('task.npc-batch'), {
    charName: char.name,
    charPersona: char.persona || '（没写人设）',
    count: Math.max(1, Math.min(8, count)),
    existing: known ? `## 她身边已经有这些人（别重复）\n${known}` : '',
  });

  const r = await runJSONTask('card.npc', {
    system, key: `npc-batch:${charId}:${Date.now()}`, maxTokens: 3000, signal,
  });
  const rows = Array.isArray(r?.npcs) ? r.npcs : [];
  if (!rows.length) throw new Error('模型没给出可用的 NPC');
  return rows.map(n => ({
    name: str(n.name), age: str(n.age), gender: str(n.gender),
    birthday: str(n.birthday), signature: str(n.signature),
    persona: str(n.persona), relation: str(n.relation), reverse: str(n.reverse),
  })).filter(n => n.name && n.persona);
}

// 把挑好的 NPC 真正建出来并连上关系
export function commitNpcs(charId, rows) {
  return rows.map(n => {
    const npc = characters.create({
      name: n.name, age: n.age, gender: n.gender, birthday: n.birthday,
      signature: n.signature, persona: n.persona,
      isNpc: true, relations: [],
      lorebookIds: [], canSendVoice: true, canSendImage: true,
    });
    // relation：在 NPC 眼里主角是什么；reverse：在主角眼里这个 NPC 是什么
    link(npc.id, charId, n.relation, n.reverse || n.relation);
    return npc;
  });
}
