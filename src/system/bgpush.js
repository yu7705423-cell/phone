import { SITE } from '../site.js';
import { settings, chats, characters, messages } from './db/index.js';
import * as push from './push.js';
import { prepareTextTask, isConfigured } from './ai/engine.js';
import * as proactive from './ai/proactive.js';
import { renderTurn } from './ai/reply.js';
import { note } from './ai/usage.js';

// 后台消息：app 关着的时候，角色照样按「主动找你」的时间发消息来（ARCHITECTURE 4.226）。
//
// 网页关着就什么都跑不了，所以找一台服务器值班（worker/push.js，部署见 worker/PUSH.md）：
//
//   离开 app 时：每个开了「主动找你」的角色，接下来几次开口的时间，连同到时候要发给模型的
//     那一次完整请求（和平时 sendProactive 同一份，engine.prepareTextTask），一起交给服务器。
//   服务器到点替你发请求，拿到角色的话，用 Web Push 推到手机上。
//   回到 app 时：把服务器写好的那几条取回来，照平时的样子落进会话，再请服务器删掉。
//
// **请求里带着接口密钥和聊天上下文。** 服务器收下时用它自己的密钥加密再存进数据库，
// 数据库里看不到原文；到点解开、发完、结果同样加密存着，取回后删除。界面上写明了这一条。
//
// **不多花一次调用。** 这是本来就会发生的「主动找你」换了个地方发：app 开着时本机发，
// 关着时服务器发，同一次开口不会两边都发 —— app 开着的这段时间每隔几分钟报一次到（/alive，
// 只报到、不交任务），服务器看见最近报过到就先不发（等 app 自己发），离开时交任务并报一句「走了」。
//
// **拼任务不调任何接口。** 离开一次拼一次，所以拼的时候不取查询向量（proactivePayload 的 vec: false，
// 记忆检索退回关键词）；同一次离开触发了两遍（pagehide 与 visibilitychange）只交一次。
// 服务器那边另有封顶（每台设备每天几次、同一段会话最短间隔、急停），见 worker/push.js 开头。
//
// **通知通道**：借别的 app 送通知（worker/push.js 的 sendChannel），给没有 Web Push 的安装版应用用：
// Bark（iPhone，点通知打开 eira://chat/会话，ipa 外壳接住后跳到那段会话，可加密）、PushPlus（经微信）。
// 配置在 settings.bgPush.channel，跟着每次交任务一起交给服务器。
//
// **没有 Web Push 的地方照样能用**（装成 apk / ipa 的外壳里没有）：登记时不带订阅，服务器照样到点替角色发、
// 存着，只是不推通知；打开应用时取回，落进会话，时间是它当时发出的那一刻。

const DEV_KEY = 'eira-bgpush-device';     // 本机在服务器上的登记：{ server, id, token, endpoint }
const ALIVE_EVERY = 4 * 60 * 1000;        // app 开着时多久报一次到（服务器那边看 6 分钟）
export const PER_CHAR = 2;                // 每个角色离开期间最多发几次，默认值（设置里可改）

export const server = () => String(settings.get().bgPush?.server || SITE.pushServer || '').trim().replace(/\/+$/, '');
export const available = () => !!server();
/** 这台设备能不能收到推送通知。不能的话消息只在打开应用时出现 */
export const canNotify = () => push.pushSupported();
export const isOn = () => settings.get().bgPush?.on === true;
export const perChar = () => Math.max(1, Math.round(Number(settings.get().bgPush?.perChar) || PER_CHAR));

function readDev() {
  try { return JSON.parse(localStorage.getItem(DEV_KEY) || 'null'); } catch { return null; }
}
function writeDev(d) {
  try { d ? localStorage.setItem(DEV_KEY, JSON.stringify(d)) : localStorage.removeItem(DEV_KEY); } catch { /* 隐私模式 */ }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const base = server();
  if (!base) throw new Error('没有配置推送服务器');
  const headers = { 'content-type': 'application/json' };
  if (auth) {
    const d = readDev();
    if (!d || d.server !== base) throw new Error('本机还没有在推送服务器上登记');
    headers.authorization = `Bearer ${d.id}.${d.token}`;
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error(data?.error || `推送服务器返回 ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data || {};
}

/**
 * 订阅并在服务器上登记本机。必须由一次点击触发（系统要问通知权限）。
 * 订阅换了（清过数据、换了公钥）就重新登记
 */
async function ensureDevice() {
  const base = server();
  // 没有 Web Push：不订阅，只登记
  if (!canNotify()) {
    const d = readDev();
    if (d && d.server === base && !d.endpoint) return d;
    const got = await api('/device', { method: 'POST', auth: false, body: {} });
    const dev = { server: base, id: got.id, token: got.token, endpoint: '' };
    writeDev(dev);
    return dev;
  }
  const { publicKey } = await api('/vapid', { auth: false });
  if (!publicKey) throw new Error('推送服务器还没有配置 VAPID 密钥');
  settings.set({ push: { ...(settings.get().push || {}), vapidPublicKey: publicKey, reportUrl: '' } });
  const sub = await push.subscribe();
  const d = readDev();
  if (d && d.server === base && d.endpoint === sub.endpoint) return d;
  const got = await api('/device', { method: 'POST', auth: false, body: { subscription: sub.toJSON() } });
  const dev = { server: base, id: got.id, token: got.token, endpoint: sub.endpoint };
  writeDev(dev);
  return dev;
}

/** 打开：要通知权限、订阅、登记。回来时已经开着 */
export async function enable() {
  if (!available()) throw new Error('本站没有配置推送服务器');
  await ensureDevice();
  settings.set({ bgPush: { ...(settings.get().bgPush || {}), on: true } });
  await plan({ away: false }).catch(() => {});
}

/** 关掉：服务器上这台设备与它的任务一并删掉 */
export async function disable() {
  settings.set({ bgPush: { ...(settings.get().bgPush || {}), on: false } });
  if (readDev()) await api('/device', { method: 'DELETE' }).catch(() => {});
  writeDev(null);
}

/** 让服务器马上推一条试试 */
export const test = () => api('/test', { method: 'POST' });

// ---- 通知通道 ----

export const channelOf = () => ({ kind: '', url: '', key: '', iv: '', token: '', hide: false, ...(settings.get().bgPush?.channel || {}) });

/** Bark 的加密填得对不对：Key 16、24 或 32 位，IV 16 位；都不填是不加密 */
export function barkCrypto(ch) {
  const k = String(ch.key || ''), v = String(ch.iv || '');
  if (!k && !v) return 'off';
  return [16, 24, 32].includes(new TextEncoder().encode(k).length) && new TextEncoder().encode(v).length === 16 ? 'ok' : 'bad';
}

/** 交给服务器的那一份。没选通道是 null（服务器那边就关掉） */
export function channelOut(ch = channelOf()) {
  if (ch.kind === 'bark') {
    if (!String(ch.url || '').trim()) return null;
    const c = barkCrypto(ch);
    // 加密填错了不能退回明文发：退成只写「发来一条消息」
    return { kind: 'bark', url: ch.url.trim(), hide: ch.hide === true || c === 'bad',
      icon: new URL('icon-192.png', location.href).href,
      ...(c === 'ok' ? { key: ch.key, iv: ch.iv } : {}) };
  }
  if (ch.kind === 'pushplus') {
    if (!String(ch.token || '').trim()) return null;
    return { kind: 'pushplus', token: ch.token.trim(), hide: ch.hide === true };
  }
  return null;
}

export function setChannel(patch) {
  settings.set({ bgPush: { ...(settings.get().bgPush || {}), channel: { ...channelOf(), ...patch } } });
}

/** 按现在填的通道发一条试试 */
export async function testChannel() {
  const ch = channelOf();
  if (ch.kind === 'bark' && barkCrypto(ch) === 'bad') throw new Error('加密的 Key 须为 16、24 或 32 位，IV 须为 16 位');
  const out = channelOut(ch);
  if (!out) throw new Error(ch.kind === 'bark' ? '请先填写 Bark 推送地址' : ch.kind === 'pushplus' ? '请先填写 PushPlus token' : '请先选择通知通道');
  return api('/test', { method: 'POST', body: { channel: out } });
}

// ---- 离开时交任务 ----

const MARK_TIME = '{{bg_time}}';
const MARK_GAP = '{{bg_gap}}';
const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

/** 这一刻要交给服务器的任务。每个角色一条，里面带着接下来几次的时间 */
export async function jobsNow(now = Date.now()) {
  if (!isConfigured()) return [];
  const out = [];
  for (const char of characters.all()) {
    if (!proactive.configOf(char).proactive) continue;
    const chat = proactive.chatReady(char.id);
    if (!chat) continue;
    const room = proactive.roomLeft(chat);
    const count = room ? Math.min(room, perChar()) : perChar();
    const times = proactive.upcoming(char.id, count, now);
    if (!times.length) continue;
    const msgs = messages.all().filter(m => m.chatId === chat.id && m.status !== 'error');
    const lastAt = msgs.reduce((a, m) => Math.max(a, m.createdAt || 0), 0);
    // 「现在几点」「多久没说话」留两个记号，服务器到点按那一刻填（见 worker/push.js 的 fill）
    const payload = await proactive.proactivePayload(chat, char, { time: MARK_TIME, gap: MARK_GAP, vec: false });
    let request;
    try { request = prepareTextTask('chat.proactive', payload); } catch { continue; }
    out.push({
      due: times, chatId: chat.id, charId: char.id, title: char.name || 'Eira',
      lastAt, tz: timeZone(), closing: proactive.PROACTIVE_CLOSING, request,
    });
  }
  return out;
}

// 一次一次排着交：前一次还没交完又来一次（开着时的报到撞上了离开），后一次等前一次
let queue = Promise.resolve();
/**
 * 把任务交给服务器，顺便报到。away: true 是「app 要退到后台了」，服务器从这一刻起到点就发；
 * 否则是「app 还开着」，最近报过到的设备服务器先不发
 */
let lastPlan = { at: 0, away: null };
export function plan({ away = false } = {}) {
  if (!isOn() || !readDev()) return Promise.resolve(null);
  // 同一件事十秒内只交一次（离开时 pagehide 与 visibilitychange 各来一遍）
  const now = Date.now();
  if (lastPlan.away === away && now - lastPlan.at < 10000) return Promise.resolve(null);
  lastPlan = { at: now, away };
  const run = async () => api('/plan', { method: 'POST', body: { away, channel: channelOut(), jobs: await jobsNow() } });
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

// ---- 回来时取结果 ----

/**
 * 把服务器替你发出去的那几条取回来，落进会话。回来的是落了几条
 */
export async function collect() {
  if (!readDev()) return 0;
  const { results = [] } = await api('/results');
  if (!results.length) return 0;
  let n = 0;
  const touched = new Set();
  for (const r of results.sort((a, b) => (a.firedAt || 0) - (b.firedAt || 0))) {
    if (r.status === 'failed') { console.warn('[bgpush] 服务器没替你发成:', r.error || '原因不明'); continue; }
    const chat = chats.get(r.chatId);
    const char = characters.get(r.charId);
    if (!chat || !char || !r.text) continue;
    note('chat.proactive', r.firedAt || Date.now());
    try {
      const made = await renderTurn({ chat, char, raw: String(r.text).trim(), turnId: `bg-${r.id}`, instant: true });
      // 落在服务器发出去的那一刻，不是取回来的这一刻
      made.forEach((m, i) => messages.update(m.id, { createdAt: (r.firedAt || Date.now()) + i }));
      chats.update(chat.id, { unread: (chats.get(chat.id)?.unread || 0) + made.length,
        lastMessageAt: Math.max(chats.get(chat.id)?.lastMessageAt || 0, (r.firedAt || 0) + made.length) });
      n += made.length;
      touched.add(char.id);
    } catch (err) { console.warn('[bgpush] 落不进会话:', err.message || err); }
  }
  await api('/ack', { method: 'POST', body: { ids: results.map(r => r.id) } }).catch(() => {});
  // 刚替它发过，本机这边重新掷一次落点，不然一打开 app 它又立刻开口
  touched.forEach(id => proactive.reschedule(id));
  return n;
}

// ---- 跟着 app 前后台走 ----

// 报到：只告诉服务器「应用还开着」，不拼任务、不交任务
function alive() {
  if (!isOn() || !readDev()) return;
  api('/alive', { method: 'POST' }).catch(() => {});
}

let timer = null;
export function install() {
  if (typeof document === 'undefined') return;
  const onShow = () => {
    if (!isOn()) return;
    collect().catch(err => console.warn('[bgpush] 取回失败:', err.message || err));
    alive();
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState === 'visible') alive(); }, ALIVE_EVERY);
  };
  const onHide = () => {
    clearInterval(timer); timer = null;
    if (isOn()) plan({ away: true }).catch(err => console.warn('[bgpush] 没交上任务:', err.message || err));
  };
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? onShow() : onHide()));
  window.addEventListener('pagehide', onHide);
  if (document.visibilityState === 'visible') onShow();
}
