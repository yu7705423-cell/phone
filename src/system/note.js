import { notes } from './db/index.js';

/**
 * 备忘。**用户自己要留着的字。**
 *
 * 和同一个 app 里的待办分两个标签页：待办是「要做的事」，有没有做完、几点提醒；
 * 备忘是「要留着的字」，没有状态也没有时刻。两样混在一个数据域里，两边的查询
 * 都会互相绊 —— 所以是两个域。
 *
 * 角色手机里那份备忘录（system/theirs.js）是**角色的**，和这一份无关。
 *
 * ---- Apple 「备忘录」写不进去 ----
 *
 * 那个 app 没有公开的写入接口：没有 NotesKit，没有可用的 URL scheme。
 * 所以这一份存在本地，要送过去的时候走系统分享面板（见 shareOut）——
 * 点一下，在面板里选「备忘录」。不是悄悄写进去，是递过去。
 * iOS 上这已经是上限，不假装能做到别的。
 */

export const FROM_ME = 'manual';
export const FROM_CHAT = 'chat';     // 从对话里长按存下来的

export const fromLabel = f => (f === FROM_CHAT ? '来自对话' : '手动添加');

/** 列表上显示哪一行。备忘没有标题，就拿第一行顶上。 */
export function titleOf(row) {
  const first = String(row?.text || '').split(/\r?\n/).find(x => x.trim());
  return (first || '').trim().slice(0, 40) || '（空）';
}

/** 第一行之外还剩什么，列表上做副标题。一行都不剩就空着。 */
export function restOf(row) {
  const lines = String(row?.text || '').split(/\r?\n/);
  const at = lines.findIndex(x => x.trim());
  return lines.slice(at + 1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function add(text = '', { from = FROM_ME, chatId = '', charId = '' } = {}) {
  const at = Date.now();
  return notes.create({
    text: String(text || ''), from, chatId, charId,
    createdAt: at, updatedAt: at,
  });
}

export const get = id => notes.get(id);
export const remove = id => notes.remove(id);

export const update = (id, text) => notes.update(id, {
  text: String(text || ''), updatedAt: Date.now(),
});

/**
 * 全部，改得最近的在前 —— 备忘是随手翻的东西，不按建的时间排。
 *
 * 时间一样时再按建的时间、最后按 id 兜底：同一毫秒里建的两条本来分不出先后，
 * 不兜这一手，列表顺序会在两次渲染之间自己跳。
 */
export const all = () => notes.all().sort((a, b) =>
  (b.updatedAt || 0) - (a.updatedAt || 0)
  || (b.createdAt || 0) - (a.createdAt || 0)
  || String(b.id).localeCompare(String(a.id)));

export function search(q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return all();
  return all().filter(r => String(r.text || '').toLowerCase().includes(t));
}

/** 这台设备递得出去吗。桌面浏览器多半没有这个。 */
export const canShare = () => typeof navigator !== 'undefined'
  && typeof navigator.share === 'function';

/**
 * 递给系统分享面板。选「备忘录」就落进 Apple 备忘录。
 *
 * 必须由一次真实点击触发（Web Share 要 transient activation），
 * 所以这个函数只能从按钮的 onClick 里调，不能在别处替用户调。
 *
 * 用户在面板上按取消会抛 AbortError —— 那不是出错，是他改主意了，
 * 界面上不该弹一条红的。
 */
export async function shareOut(row) {
  const text = String(row?.text || '').trim();
  if (!text) throw new Error('这条备忘是空的');
  if (!canShare()) throw new Error('当前环境没有系统分享面板');
  try {
    await navigator.share({ title: titleOf(row), text });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return false;
    throw err;
  }
}
