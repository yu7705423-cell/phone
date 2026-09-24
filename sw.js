// 小手机的 Service Worker。只干一件事：显示通知。
//
// 这里故意没有 fetch 处理函数，一个字节都不缓存。
// 无构建方案本来就被 HTTP 缓存坑过一次（见设置里的「强制更新」），
// 再加一层 SW 缓存只会更难查。它存在的唯一理由是 Web Push 必须要有 SW。

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// iOS 有个硬规矩：收到 push 却没弹出通知，系统会直接把订阅作废。
// 所以无论负载解析成什么样，都必须走到 showNotification。
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }

  const title = data.title || 'Eira';
  const options = {
    body: data.body || '有新消息',
    icon: data.icon || 'icon-192.png',
    badge: data.badge || 'icon-192.png',
    tag: data.tag || 'phone-msg',
    renotify: true,
    data: { route: data.route || null, appId: data.appId || null, url: data.url || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const info = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 已经开着就叫到前台，顺便告诉它要跳到哪儿，不要再开一个
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        c.postMessage({ type: 'notification-click', ...info });
        return;
      }
    }
    // 一个窗口都没有：只能新开一个，那就把去处写在地址里 ——
    // 冷启动没有谁可以 postMessage，不带着这一段，点开就只是回到锁屏
    if (self.clients.openWindow) {
      const to = info.appId && info.route
        ? `./index.html#n=${encodeURIComponent(`${info.appId}|${info.route}`)}`
        : (info.url || './index.html');
      await self.clients.openWindow(to);
    }
  })());
});
