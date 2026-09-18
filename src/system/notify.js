import { createStore, uid } from './store.js';
import { emit, EVENTS } from './bus.js';

const MAX = 30;
export const notifications = createStore({ items: [] });

export function notify({ title, body, icon = 'bell', appId, payload, avatar }) {
  const item = { id: uid('n'), title, body, icon, appId, payload, avatar, createdAt: Date.now(), read: false };
  const items = [item, ...notifications.get().items].slice(0, MAX);
  notifications.set({ items });
  // 横幅和提示音都挂在这个事件上，notify 本身不管怎么呈现
  emit(EVENTS.notify, item);
  return item.id;
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

