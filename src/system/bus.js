// 系统级事件总线。只广播系统事件(锁屏、主题、通知点击),
// 业务事件一律不走这里,否则又变成隐式耦合。
const handlers = new Map();

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  return () => handlers.get(event)?.delete(fn);
}

export function emit(event, payload) {
  handlers.get(event)?.forEach(fn => {
    try { fn(payload); } catch (err) { console.error(`[bus] ${event} 处理出错`, err); }
  });
}

export const EVENTS = {
  lock: 'system:lock',
  unlock: 'system:unlock',
  theme: 'system:theme',
  notificationOpen: 'system:notification-open',
  appOpen: 'system:app-open',
};
