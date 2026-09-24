import { settings } from './db/index.js';
import { on as busOn, EVENTS } from './bus.js';
import { open as openIntent } from './intents.js';
import { shownBody } from './notify.js';

// 系统通知与 Web Push 的客户端这一半。
// 说明：真要在「app 完全关着」的时候把手机叫醒，必须有一台服务器替你发推送，
// 这是 Web Push 的设计，前端绕不过去。这里把订阅、VAPID、点击回跳都做好，
// 接上服务器只差把订阅对象交给它。
//
// ---- 装成 ipa 之后走的是另一条路 ----
//
// **WKWebView 没有 Notification，也没有 Service Worker 的 showNotification。**
// 那两样在 iOS 上只给 Safari 和「添加到主屏幕」的 PWA。所以装成 app 之后
// 网页这套一律报「这个浏览器不支持」，通知整个没了。
//
// 外壳因此自己发本地通知（ios/Sources/NotifyBridge.swift），并在文档一开始
// 注入 window.phoneNotify。**有那座桥就一律走桥**，下面每个动作都先问一句。
// 本地通知不需要 entitlement，各人怎么签都发得出来；代价是 app 被系统
// 彻底结束之后没人算「该提醒了」，那种仍然要靠服务器推。

const NATIVE = () => window.webkit?.messageHandlers?.notify;

/** 外壳有没有这座桥。 */
export const native = () => !!(window.phoneNotify && NATIVE());

async function callNative(action, payload = {}) {
  const got = await NATIVE().postMessage({ action, ...payload });
  if (got && got.error) throw new Error(String(got.error));
  return got || {};
}

// 原生那边问状态是异步的，而 permission() 到处都在同步地用。
// 所以记一份，开机时与每次问过之后刷新。还没问到就当「还没问过」
let nativePerm = 'default';

export const supported = () =>
  native() || ('serviceWorker' in navigator && 'Notification' in window);

export const pushSupported = () => !native()
  && 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;

// iOS 只给「添加到主屏幕」之后的 PWA 发通知，标签页里申请了也没用。
// 装成 ipa 的时候不看这个 —— 那一层不是浏览器
export const standalone = () => native()
  || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const permission = () => {
  if (native()) return nativePerm;
  return ('Notification' in window) ? Notification.permission : 'unsupported';
};

/** 跟原生那边对一次状态。开机时走一遍，界面上那一行才写得对。 */
export async function refresh() {
  if (!native()) return permission();
  try {
    const got = await callNative('status');
    nativePerm = got.permission || 'default';
  } catch { /* 问不到就维持原样，不要把它当成被拒 */ }
  return nativePerm;
}

let reg = null;

// 下面三个都是 Service Worker 那条路专用的。装成 ipa 时**根本没有
// navigator.serviceWorker**，supported() 却因为有原生桥而为真 ——
// 所以这里另外挡一道，不然一进通知设置页就是一个 TypeError
const swPath = () => !native() && 'serviceWorker' in navigator && 'Notification' in window;

export async function register() {
  if (!swPath()) throw new Error('这个浏览器没有 Service Worker 或通知能力');
  reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}

export async function registration() {
  if (reg) return reg;
  if (!swPath()) return null;
  reg = await navigator.serviceWorker.getRegistration();
  return reg;
}

// 必须由一次真实点击触发，否则 Safari 直接拒
export async function ask() {
  if (native()) {
    const got = await callNative('request');
    nativePerm = got.permission || 'default';
    if (nativePerm !== 'granted') {
      throw new Error('通知被拒了。到系统「设置 - 通知 - Eira」里重新打开');
    }
    return nativePerm;
  }
  if (!supported()) throw new Error('这个浏览器不支持通知');
  await register();
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error(p === 'denied'
    ? '通知被拒了。iOS 要到「设置 - 通知 - Eira」里重新打开'
    : '没有授权');
  return p;
}

// 真正的系统通知。iOS 上不能用 new Notification()，只有 SW 的 showNotification 有效
//
// tag 要每条不一样。同一个 tag 的通知会**顶掉**前一条，从前全用 'phone-msg'，
// 一轮五条落下来通知中心里只剩最后一条，看起来就是「只弹了一条」。
export async function show({ title, body, route, appId, icon, tag }) {
  if (permission() !== 'granted') throw new Error('还没有通知权限');
  if (native()) {
    await callNative('show', { title, body, route: route || '', appId: appId || '', tag: tag || '' });
    return;
  }
  const r = await registration() || await register();
  await r.showNotification(title || 'Eira', {
    body: body || '',
    icon: icon || 'icon-192.png',
    badge: 'icon-192.png',
    tag: tag || `phone-${Date.now()}`,
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

// 点通知要跳到哪一页。三条路进来（外壳、SW、冷启动那个地址），出口只有这一个
const PENDING = 'notify-open';
const jump = d => { if (d && d.appId) openIntent(d.appId, d.route ? { route: d.route } : null); };

/**
 * 外壳喊的那个。**回 true 是回执**，外壳只认这个值：回别的它当作「这张页面上
 * 没有这个函数」—— 网页进程在后台被回收、再拉起来的是一张空文档，正是这样 ——
 * 于是重载一遍再交。所以跳转本身出了错也要回 true：那是本机的 bug，
 * 重载救不回来，只会让它再炸一遍。
 */
const take = d => {
  try { jump(d); } catch (err) { console.warn('[push] 点通知跳转失败:', err.message || err); }
  return true;
};

/**
 * 补上在 js 起来之前点的那一下。
 *
 * **点通知这件事常常跑在网页前面**：外壳（或系统）先把网页重新载入，
 * 再喊 phoneNotifyOpen；那一下落在 index.html 里那个占位函数上，存下来。
 * 启动时不来兑现，人看到的就是「点了通知，手机只是重新刷一遍，还停在原处」。
 *
 * sessionStorage 那一份是为了熬过启动时那次自愈重载（见 main.js）。
 */
function drainPending() {
  let d = window.__notifyOpen || null;
  window.__notifyOpen = null;
  if (!d) {
    try { d = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch { d = null; }
  }
  try { sessionStorage.removeItem(PENDING); } catch { /* 隐私模式会抛 */ }
  jump(d);
}

/**
 * 冷启动时地址里带着要去哪儿：`#n=appId|route`。
 *
 * app 整个没在跑的时候，SW 只能新开一个窗口，没有谁可以 postMessage。
 * 所以把去处写在地址上，这边读完就抹掉 —— 留着的话下次刷新又跳一次。
 */
function fromHash() {
  const m = String(location.hash || '').match(/^#n=(.+)$/);
  if (!m) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* 忽略 */ }
  const [appId, ...rest] = decodeURIComponent(m[1]).split('|');
  if (appId) jump({ appId, route: rest.join('|') });
}

// 点系统通知回到这边，交给 intents 统一跳转，和横幅、锁屏那条路一样
export function installClickBridge() {
  // 原生那边点开通知之后喊这个。和下面 SW 那条走同一个出口
  if (native()) {
    window.phoneNotifyOpen = take;
    drainPending();
    return;
  }
  fromHash();
  if (!('serviceWorker' in navigator)) { drainPending(); return; }
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type !== 'notification-click') return;
    jump(d);
  });
  drainPending();
}

// 系统通知开着、而且页面不在前台时，就交给系统弹，不再弹应用内横幅
export function shouldUseSystem() {
  return (settings.get().notify || {}).system === true
    && permission() === 'granted'
    && document.visibilityState !== 'visible';
}

export function installBridge() {
  installClickBridge();
  // 原生那边的授权状态是异步问来的，开机时对一次，界面上那一行才写得对
  refresh();
  busOn(EVENTS.notify, item => {
    if (!shouldUseSystem()) return;
    show({
      title: item.title, body: shownBody(item), tag: item.id,
      route: item.payload?.route, appId: item.appId,
    }).catch(err => console.warn('[push] 系统通知没弹出来:', err.message || err));
  });
}
