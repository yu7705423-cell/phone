import { createStore, uid } from './store.js';
import { emit, EVENTS } from './bus.js';
import { settings } from './db/index.js';

// 一条消息一条通知，一轮就是三到五条，攒的上限相应放宽
const MAX = 50;
export const notifications = createStore({ items: [] });

export function notify({ title, body, icon = 'bell', appId, payload, avatar }) {
  const item = { id: uid('n'), title, body, icon, appId, payload, avatar, createdAt: Date.now(), read: false };
  const items = [item, ...notifications.get().items].slice(0, MAX);
  notifications.set({ items });
  // 横幅和提示音都挂在这个事件上，notify 本身不管怎么呈现
  emit(EVENTS.notify, item);
  return item.id;
}

// 通知上显示的那一行正文。在显示这一层挡，不在存的那一层，
// 所以开关一开一关立刻生效。横幅、锁屏、系统通知三处都走这里。
const HIDDEN = '收到一条新消息';
export function shownBody(item) {
  if ((settings.get().notify || {}).preview === false) return HIDDEN;
  return item?.body || '';
}

export function markRead(id) {
  notifications.set({ items: notifications.get().items.map(n => n.id === id ? { ...n, read: true } : n) });
}

export function dismiss(id) {
  notifications.set({ items: notifications.get().items.filter(n => n.id !== id) });
}

export function openNotification(id) {
  const item = notifications.get().items.find(n => n.id === id);
  if (!item) return;
  markRead(id);
  emit(EVENTS.notificationOpen, item);
}

