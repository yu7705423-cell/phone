import { settings } from './db/index.js';
import { on as busOn, EVENTS } from './bus.js';
import { open as openIntent } from './intents.js';

// 系统通知与 Web Push 的客户端这一半。
// 说明：真要在「app 完全关着」的时候把手机叫醒，必须有一台服务器替你发推送，
// 这是 Web Push 的设计，前端绕不过去。这里把订阅、VAPID、点击回跳都做好，
// 接上服务器只差把订阅对象交给它。

export const supported = () =>
  'serviceWorker' in navigator && 'Notification' in window;

export const pushSupported = () => supported() && 'PushManager' in window;

// iOS 只给「添加到主屏幕」之后的 PWA 发通知，标签页里申请了也没用
export const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const permission = () =>
  ('Notification' in window) ? Notification.permission : 'unsupported';

let reg = null;

export async function register() {
  if (!supported()) throw new Error('这个浏览器没有 Service Worker 或通知能力');
  reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}

export async function registration() {
  if (reg) return reg;
  if (!supported()) return null;
  reg = await navigator.serviceWorker.getRegistration();
  return reg;
}

// 必须由一次真实点击触发，否则 Safari 直接拒
export async function ask() {
  if (!supported()) throw new Error('这个浏览器不支持通知');
  await register();
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error(p === 'denied'
    ? '通知被拒了。iOS 要到「设置 - 通知 - 小手机」里重新打开'
    : '没有授权');
  return p;
}

// 真正的系统通知。iOS 上不能用 new Notification()，只有 SW 的 showNotification 有效
export async function show({ title, body, route, appId, icon }) {
  if (permission() !== 'granted') throw new Error('还没有通知权限');
  const r = await registration() || await register();
  await r.showNotification(title || '小手机', {
    body: body || '',
    icon: icon || 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'phone-msg',
    renotify: true,
    data: { route: route || null, appId: appId || null },
  });
}

const VAPID_HINT = '订阅需要服务器的 VAPID 公钥，在下面填';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushConfig() {
  const s = settings.get().push || {};
  return { vapidPublicKey: s.vapidPublicKey || '', reportUrl: s.reportUrl || '', endpoint: s.endpoint || '' };
}

export async function subscription() {
  const r = await registration();
  if (!r || !r.pushManager) return null;
  return r.pushManager.getSubscription();
}

export async function subscribe() {
  if (!pushSupported()) throw new Error('这个浏览器没有 Push API');
  const { vapidPublicKey, reportUrl } = pushConfig();
  if (!vapidPublicKey) throw new Error(VAPID_HINT);
  if (permission() !== 'granted') await ask();
  const r = await registration() || await register();

  let sub = await r.pushManager.getSubscription();
  if (sub) {
    // 换了公钥就得退掉重订，否则服务器发不动
    const cur = sub.options?.applicationServerKey;
    const want = urlBase64ToUint8Array(vapidPublicKey);
    if (!cur || new Uint8Array(cur).toString() !== want.toString()) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    sub = await r.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  settings.set({ push: { ...(settings.get().push || {}), endpoint: sub.endpoint } });

  if (reportUrl) {
    const res = await fetch(reportUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub),
    });
    if (!res.ok) throw new Error(`订阅上报失败 ${res.status}。订阅本身是好的，可以手动复制`);
  }
  return sub;
}

export async function unsubscribe() {
  const sub = await subscription();
  if (sub) await sub.unsubscribe();
  settings.set({ push: { ...(settings.get().push || {}), endpoint: '' } });
}

// 点系统通知回到这边，交给 intents 统一跳转，和横幅、锁屏那条路一样
export function installClickBridge() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type !== 'notification-click') return;
    if (d.appId) openIntent(d.appId, d.route ? { route: d.route } : null);
  });
}

// 系统通知开着、而且页面不在前台时，就交给系统弹，不再弹应用内横幅
export function shouldUseSystem() {
  return (settings.get().notify || {}).system === true
    && permission() === 'granted'
    && document.visibilityState !== 'visible';
}

export function installBridge() {
  installClickBridge();
  busOn(EVENTS.notify, item => {
    if (!shouldUseSystem()) return;
    show({
      title: item.title, body: item.body,
      route: item.payload?.route, appId: item.appId,
    }).catch(err => console.warn('[push] 系统通知没弹出来:', err.message || err));
  });
}
