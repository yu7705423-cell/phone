import { personas, chats, settings } from './db/index.js';
import { dropChat } from './purge.js';

// 用户身份树。一个根账号（大号）下面挂若干小号。
//
// 规则来自使用场景：
//  - 不同根账号之间完全独立，互相看不见对方的会话和记忆
//  - 同一个根下的小号，角色仍然记得大号那边的事（它还是同一个角色），
//    但对小号这个「人」是陌生的 —— 见 ai/context 里怎么分层注入

export function all() { return personas.all(); }
export function get(id) { return personas.get(id); }

export function roots() {
  return personas.all().filter(p => !p.parentId)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function altsOf(rootId) {
  return personas.all().filter(p => p.parentId === rootId)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// 小号的根就是它的大号；大号的根是它自己。只往上找一层，不做深树。
export function rootOf(id) {
  const p = personas.get(id);
  if (!p) return null;
  return p.parentId ? (personas.get(p.parentId) || p) : p;
}

export const rootIdOf = id => rootOf(id)?.id || null;
export const isAlt = id => !!personas.get(id)?.parentId;

export function current() {
  const id = settings.get().activePersonaId;
  return personas.get(id) || roots()[0] || null;
}

export const currentId = () => current()?.id || null;

export function switchTo(id) {
  if (!personas.get(id)) throw new Error('这个账号不存在');
  settings.set({ activePersonaId: id });
  return personas.get(id);
}

export function createRoot(init = {}) {
  return personas.create({
    name: init.name || '新账号', avatar: null, cover: null,
    signature: '', description: '', parentId: null, ...init,
  });
}

export function createAlt(rootId, init = {}) {
  const root = rootOf(rootId);
  if (!root) throw new Error('先有大号才能开小号');
  return personas.create({
    name: init.name || `${root.name}的小号`, avatar: null, cover: null,
    signature: '', description: '', parentId: root.id, ...init,
  });
}

// 删一个身份，连带它的小号和它们的会话。记忆留着由调用方决定
export function remove(id) {
  const p = personas.get(id);
  if (!p) return;
  const ids = [id, ...(p.parentId ? [] : altsOf(id).map(a => a.id))];
  ids.forEach(pid => {
    // 会话连同挂在它身上的一切（消息、空间、线下、出行、段评）一起走。
    // 从前这里只删会话行和空间，几千条消息留成孤儿，还占着图片和语音。
    // purge 只依赖 db 与 looks，不会绕回本模块
    chats.where(c => c.personaId === pid).forEach(c => dropChat(c.id));
    personas.remove(pid);
  });
  if (ids.includes(settings.get().activePersonaId)) {
    const next = roots()[0];
    settings.set({ activePersonaId: next?.id || null });
  }
}

export function label(p) {
  if (!p) return '';
  return p.parentId ? `${p.name}（小号）` : p.name;
}
