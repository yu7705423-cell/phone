// Eira 的 Service Worker。两件事：显示通知，以及把代码存在本机（ARCHITECTURE 4.220）。
//
// ---- 为什么现在要缓存了 ----
//
// 从前这里故意一个字节都不缓存：无构建方案被 HTTP 缓存坑过（新旧文件混着，见 system/refresh.js），
// 再加一层怕更难查。但服务器在海外，四百多个 js 一个一个取，大陆打开很慢。
//
// 所以缓存做成**整份按构建号换**，不会新旧混着：
//   - 缓存名是 eira-<构建号>，构建号由页面注册时带在地址上（sw.js?b=…，取 index.html 里的 meta）；
//     构建号一变，注册地址就变，浏览器装一个新的 Service Worker，旧的那份缓存在 activate 时整份删掉
//   - 页面本身（导航请求）永远先问网络：index.html 里写着「真实版本」，它必须是新的，
//     启动时那道构建号比对（main.js）才管用。断网时退回缓存里那一份
//   - js、css、图标这些同源静态文件先看缓存，没有才取，取到了放进去
//   - 带 cache:'reload' 的请求（强制更新那一遍）一律走网络，并覆盖缓存里那一条
//   - 跨域的（接口、网易云、字体）一律不碰
//
// 地址上带 cache=0 时不缓存，只管通知：自动化测试里默认这样（见 system/offline.js）。

const params = new URL(self.location.href).searchParams;
const BUILD = params.get('b') || 'dev';
const CACHING = params.get('cache') !== '0';
const CACHE = `eira-${BUILD}`;
const STATIC = /\.(m?js|css|json|png|svg|jpe?g|webp|gif|ico|woff2?|ttf|otf|webmanifest|wasm|txt)$/i;

self.addEventListener('install', () => self.skipWaiting());
// 激活时只做一件事：接管页面。**不等删旧缓存** —— 激活期间页面的请求全被挂起，
// 在这里等任何慢事，整页就卡在白屏上。别的构建号留下的缓存放到后台删，删不完下次再删
self.addEventListener('activate', e => {
  self.clients.claim().catch(() => {});
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('eira-') && k !== CACHE).map(k => caches.delete(k))))
    .catch(() => {});
});

async function network(req) {
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req.url.split('#')[0], copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', event => {
  if (!CACHING) return;
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  // 页面本身：先问网络，断网才用缓存里的
  if (req.mode === 'navigate') {
    event.respondWith(network(req).catch(async () =>
      (await caches.match(req, { ignoreSearch: true }))
      || (await caches.match(new URL('./index.html', self.location.href).href))
      || Response.error()));
    return;
  }
  if (!STATIC.test(url.pathname)) return;
  // 强制更新那一遍：走网络，覆盖缓存
  if (req.cache === 'reload' || req.cache === 'no-store' || req.cache === 'no-cache') {
    event.respondWith(network(req));
    return;
  }
  event.respondWith((async () => {
    const hit = await caches.match(req.url, { cacheName: CACHE });
    return hit || network(req);
  })());
});

// 页面启动完把已经加载过的文件报过来（第一次打开时 Service Worker 还没接管，那一批没经过它），
// 这里补进缓存。下一次打开就全从本机取
self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type !== 'warm' || !CACHING || !Array.isArray(d.urls)) return;
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const u of d.urls) {
      try {
        const url = new URL(u, self.location.href);
        if (url.origin !== self.location.origin || !STATIC.test(url.pathname)) continue;
        if (await c.match(url.href)) continue;
        const res = await fetch(url.href);
        if (res.ok) await c.put(url.href, res);
      } catch { /* 一个取不到不影响别的 */ }
    }
  })());
});

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
