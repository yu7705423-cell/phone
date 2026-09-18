import { characters, memories } from './db/index.js';
import * as accounts from './accounts.js';

// 关系底色。
//
// S 级记忆是「关系的重大转折」。从前它们每一轮都逐条全量注入，于是
// 随口问一句今天吃什么，满眼也都是那几件大事。日常聊天不需要时时刻刻
// 惦着它们，但也不能当它们没发生过。
//
// 所以压成一段：**大事以底色的形式常驻，具体条目等到相关时再召回。**
//
// 按根账号分开存。同一个角色可以被两个大号分别聊，各自的关系不是一回事；
// 小号与大号共用（见 memory.listFor 的规则）。

export const bondsOf = char => (char && char.bonds) || {};

const keyFor = personaId => accounts.rootIdOf(personaId) || 'root';

export function get(char, personaId) {
  return bondsOf(char)[keyFor(personaId)] || null;
}

export const textOf = (char, personaId) => (get(char, personaId)?.text || '').trim();

function write(charId, personaId, patch) {
  const char = characters.get(charId);
  if (!char) return null;
  const key = keyFor(personaId);
  const next = { ...(bondsOf(char)[key] || {}), ...patch };
  characters.update(charId, { bonds: { ...bondsOf(char), [key]: next } });
  return next;
}

/** 手写或改写。改过之后就不再被自动重算覆盖。 */
export function set(charId, personaId, text) {
  return write(charId, personaId, {
    text: String(text || '').trim().slice(0, 600),
    manual: true, at: Date.now(), sig: signature(charId, personaId),
  });
}

/**
 * 交回自动。签名一并清掉 —— 点这个按钮的人要的是「重新按记忆生成一份」，
 * 而不是「等下一次 S 级变动」。不清的话，S 级没动过就永远不会重压。
 */
export function unlock(charId, personaId) {
  return write(charId, personaId, { manual: false, sig: '' });
}

// 这一份底色是照着哪些 S 级记忆压出来的。
// 记 id 与改动时间：增删改任意一种都会让签名变，变了就该重压。
export function sourceOf(charId, personaId) {
  const root = accounts.rootIdOf(personaId);
  return memories.where(m => {
    if (m.rank !== 'S') return false;
    if (m.charId && m.charId !== charId) return false;
    if (!root || !m.personaId) return true;
    return accounts.rootIdOf(m.personaId) === root;
  }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function signature(charId, personaId) {
  return sourceOf(charId, personaId).map(m => `${m.id}:${m.updatedAt || 0}`).join('|');
}

/**
 * 该不该重压。三件事都要：有 S 级记忆、没被手写锁住、签名和上次不一样。
 * 一条 S 级都没有的时候不压 —— 那时候还没有「关系」可言。
 */
export function stale(charId, personaId) {
  const char = characters.get(charId);
  if (!char) return false;
  const cur = get(char, personaId);
  if (cur?.manual) return false;
  const sig = signature(charId, personaId);
  if (!sig) return false;
  return sig !== (cur?.sig || '');
}

/**
 * 重压一遍。调接口，所以要花钱 —— 只在签名变了的时候跑，
 * 而且用户可以整项关掉（见「用量与上限」）。
 *
 * 动态 import：engine 那一串要用到 db 和模板，静态引进来会绕一大圈。
 */
export async function refresh(charId, personaId, { force = false } = {}) {
  if (!force && !stale(charId, personaId)) return null;
  const rows = sourceOf(charId, personaId);
  if (!rows.length) return null;

  const [engine, tpl] = await Promise.all([
    import('./ai/engine.js'), import('./ai/templates.js'),
  ]);
  if (!engine.isConfigured()) return null;

  const text = (await engine.runTextTask('memory.bond', {
    system: tpl.fillTemplate(engine.template('task.bond'), {
      events: rows.map(m => `- ${m.content}`).join('\n'),
    }),
    user: '请按要求输出。',
    key: `bond:${charId}:${keyFor(personaId)}`,
    maxTokens: 400,
  }) || '').trim();
  if (!text) return null;

  return write(charId, personaId, {
    text: text.slice(0, 600), manual: false,
    at: Date.now(), sig: signature(charId, personaId),
  });
}
