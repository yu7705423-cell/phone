import { settings, messages } from './db/index.js';
import { notify } from './notify.js';

/**
 * 防丢。见 ARCHITECTURE 4.165
 *
 * 所有数据都只在这台设备的浏览器里。清一次网站数据、换一台手机、浏览器空间
 * 紧张时自己清掉一批 —— 几个月的聊天、记忆、照片一起没了，而且没有任何地方
 * 能找回来。这个文件管两件不花钱的事：
 *
 *   一、向浏览器申请「持久存储」。申请到了，空间紧张时浏览器不会自己清这个站的数据
 *      （用户手动清除仍然会清）。从前一次都没申请过
 *   二、多久没备份了就提醒一次。备份方式在「设置 - 存储与备份」：导出文件，
 *      或者备份到 GitHub（system/ghbackup.js）
 */

const DAY = 86400000;
const REMIND_KEY = 'phone.safekeep.reminded';

/** 提醒间隔（天）。0 表示不提醒 */
export const remindDays = () => {
  const n = Number(settings.get().backupRemindDays);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 7;
};

export const lastBackupAt = () => Number(settings.get().lastBackupAt) || 0;

/** 备份成功之后记一笔。导出文件与 GitHub 两条路都调它 */
export function markBackedUp(at = Date.now()) {
  settings.set({ lastBackupAt: at });
}

/** 浏览器有没有答应不自动清。不支持这个接口的浏览器返回 null */
export async function persisted() {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : null; }
  catch { return null; }
}

/** 申请持久存储。已经有了就不再问 */
export async function askPersist() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

/** 距上次备份多少天。从没备份过的，从最早那条消息算起 */
export function daysSince(now = Date.now()) {
  const last = lastBackupAt();
  let from = last;
  if (!from) {
    let first = 0;
    messages.each(m => { if (m.createdAt && (!first || m.createdAt < first)) first = m.createdAt; });
    from = first;
  }
  return from ? Math.floor((now - from) / DAY) : 0;
}

let asked = false;

/** 挂在 proactive.tick 上。到了间隔就提醒一次，一天最多一次 */
export function tick(now = Date.now()) {
  if (!asked) { asked = true; askPersist(); }
  const days = remindDays();
  if (!days || !messages.count()) return;
  const gap = daysSince(now);
  if (gap < days) return;
  const today = new Date(now).toDateString();
  let done = '';
  try { done = localStorage.getItem(REMIND_KEY) || ''; } catch { /* 隐私模式 */ }
  if (done === today) return;
  try { localStorage.setItem(REMIND_KEY, today); } catch { /* 隐私模式 */ }
  notify({
    title: '备份', icon: 'download', appId: 'settings', payload: { route: '/storage' },
    body: lastBackupAt()
      ? `距上次备份已有 ${gap} 天。数据只保存在这台设备上，清除浏览器数据会一并清除。`
      : `尚未备份过。数据只保存在这台设备上，清除浏览器数据会一并清除。`,
  });
}
