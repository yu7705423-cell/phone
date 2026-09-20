import { todos } from './db/index.js';
import * as todo from './todo.js';

/**
 * 系统闹钟。把一条待办交给 iOS 自己的闹钟去响。
 *
 * ---- 为什么非要原生 ----
 *
 * 网页做不到「关掉之后还能按时响」。iOS 上网页没有后台调度，Web Push 又要
 * 一个服务端（13.2 的 N3，还空着）。所以一条定了时刻的待办，在浏览器里
 * 只有开着 app 的时候才提醒得了 —— 这不是没做，是做不到。
 *
 * 装成 ipa 就不一样：AlarmKit 排的是**系统级的闹钟**，穿透静音与专注模式，
 * app 没在跑也照响，和「时钟」里自己定的那种是同一套。
 *
 * ---- 它不需要 entitlement，这一点和「健康」不同 ----
 *
 * HealthKit 要 `com.apple.developer.healthkit`，那是签名时写进去的，未签名的
 * ipa 自己签多半拿不到（见 healthkit.js 开头）。AlarmKit 不要 entitlement，
 * 只要 Info.plist 里的 `NSAlarmKitUsageDescription` 加一次运行时授权。
 * 所以这一样自己签也用得上。
 *
 * 代价是它要 **iOS 26**，而本项目最低支持到 15。拿不到就照实说，不假装。
 */

const BRIDGE = () => window.webkit?.messageHandlers?.alarm;

/** 这台设备上有没有这座桥。外壳在文档一开始注入 window.phoneAlarm。 */
export const available = () => !!(window.phoneAlarm && BRIDGE());

async function call(action, payload = {}) {
  const bridge = BRIDGE();
  if (!bridge) throw new Error('这个版本没有连接系统闹钟的通道');
  const got = await bridge.postMessage({ action, ...payload });
  if (got && got.error) throw new Error(String(got.error));
  return got || {};
}

/** 问系统要授权。弹的是系统那张询问表。 */
export const request = () => call('request');

/** 系统那边现在什么状态：granted / denied / notDetermined / unsupported。 */
export const status = () => call('status');

/** 系统里现在挂着哪几个本应用排的闹钟。用来对账 —— 排了没响是最难查的那种。 */
export const listNative = () => call('list');

/**
 * 逐条对账：本应用记着排了的那几条，系统那边认不认。
 *
 * 只给总数不够 —— 两个数一样也可能是各记各的。要能指到具体哪一条。
 */
export function reconcile(ids) {
  const sys = new Set(Array.isArray(ids) ? ids : []);
  return todos.where(r => r.alarmId).map(r => ({
    id: r.id, text: r.text, at: timeOf(r), known: sys.has(r.alarmId),
  })).sort((a, b) => a.at - b.at);
}

// ---- 一条待办的时刻 ----
//
// 存的是毫秒。日期那一栏（dueAt）是「哪天该做」，可以只有日期没有时刻；
// 闹钟要的是一个准确到分钟的时刻，所以单独一个字段，不从 dueAt 猜。

/** 把「2026-09-30」与「07:30」拼成一个时刻。拼不出来返回 0。 */
export function at(date, time) {
  const d = String(date || '').trim();
  const t = String(time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!hm) return 0;
  const ms = new Date(`${d}T${String(hm[1]).padStart(2, '0')}:${hm[2]}:00`).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** 这条待办上挂的时刻，毫秒。没挂就是 0。 */
export const timeOf = row => Number(row?.remindAt) || 0;

/** 已经过去的不再算数：排一个过去的时刻，系统那边要么报错要么当场就响。 */
export const isFuture = ms => Number(ms) > Date.now();

/** 挂着时刻、还没到、也还没做完的那几条。 */
export const upcoming = () => todos
  .where(r => r.state === todo.OPEN && isFuture(timeOf(r)))
  .sort((a, b) => timeOf(a) - timeOf(b));

/**
 * 给这条待办排一个系统闹钟。
 *
 * 没有桥就不排，也**不报错** —— 浏览器里定时刻仍然是有意义的：那一栏会显示，
 * app 开着时到点仍然提醒。报错会让人以为整件事没成。回来的 native 说明
 * 这一次到底有没有排进系统。
 */
export async function schedule(id) {
  const row = todos.get(id);
  if (!row) return { native: false, reason: 'gone' };
  const ms = timeOf(row);
  if (!isFuture(ms)) return { native: false, reason: 'past' };
  if (!available()) return { native: false, reason: 'nobridge' };

  const got = await call('schedule', { id: row.id, title: row.text, at: ms });
  // **一定要外壳把编号交回来才算排上。** 从前这里拿不到就退回用待办自己的 id
  // 顶上，于是界面照样写「已排入系统闹钟」—— 那是虚报：本地记着有，系统里
  // 一个都没有，而人要等到那个时刻没响才发现
  if (!got.alarmId) return { native: false, reason: 'noid' };
  // alarmAt 记的是「排出去的是哪个时刻」。光有 alarmId 判断不了时刻改没改过，
  // 而改过却没重排是最容易让人白等一场的那种
  todos.update(id, { alarmId: got.alarmId, alarmAt: ms });
  return { native: true, alarmId: got.alarmId };
}

/** 撤掉这条待办的系统闹钟。桥不在就只清掉本地那个记号。 */
export async function cancel(id) {
  const row = todos.get(id);
  if (!row) return false;
  if (row.alarmId && available()) {
    try { await call('cancel', { id: row.alarmId }); }
    catch (err) { console.warn('[alarm] 撤闹钟没成:', err.message || err); }
  }
  todos.update(id, { alarmId: '', alarmAt: 0 });
  return true;
}

/** 排出去的那个时刻和现在填的还是不是同一个。改过就得重排，不然白等。 */
export const stale = row =>
  !!row?.alarmId && Number(row.alarmAt || 0) !== timeOf(row);

/** 全撤了。攒了一堆对不上的时候用这个推倒重来。 */
export async function cancelAll() {
  const rows = todos.where(r => r.alarmId);
  for (const r of rows) await cancel(r.id);
  return rows.length;
}

/**
 * 改时刻：先撤旧的再排新的。
 *
 * 不做「改一下参数」那种原地修改 —— 系统那边认的是 id，撤了重排是唯一
 * 保证两边一致的写法。
 */
let busy = new Set();

export async function reschedule(id, ms) {
  if (busy.has(id)) return { native: false, reason: 'busy' };
  busy.add(id);
  try { return await redo(id, ms); } finally { busy.delete(id); }
}

async function redo(id, ms) {
  await cancel(id);
  todos.update(id, { remindAt: Number(ms) || 0 });
  return schedule(id);
}

/**
 * 到点了没有。**这是浏览器那一半**：app 开着的时候自己看表。
 *
 * 装了 ipa 的照样会走这条 —— 两边都响一次比一边不响强，而且系统那次是
 * 在锁屏上，这一次是在 app 里，看得见的位置不一样。
 */
export function due(now = Date.now()) {
  return todos.where(r => r.state === todo.OPEN
    && timeOf(r) > 0 && timeOf(r) <= now && !r.rungAt);
}

/** 记下这一条已经响过，免得每一轮都再响一次。 */
export const markRung = id => todos.update(id, { rungAt: Date.now() });

/**
 * 开着的时候自己看表。一分钟一次就够 —— 待办的精度本来就是分钟。
 *
 * 页面关着的这段时间不跑，所以回来时可能一次到点好几条。**照样一条一条弹**：
 * 过期不等于不用管，那正是人最想知道的那几条。
 */
const EVERY = 60000;
let timer = null;

export function start(ring) {
  if (timer) return () => {};
  const beat = () => {
    for (const row of due()) {
      markRung(row.id);
      try { ring(row); } catch (err) { console.warn('[alarm] 提醒没弹出来:', err.message || err); }
    }
  };
  beat();
  timer = setInterval(beat, EVERY);
  return () => { clearInterval(timer); timer = null; };
}
