// 本机的锁屏密码。见 ARCHITECTURE 4.231
//
// 设了之后，**每次打开应用**都先停在锁屏上，输对了才进得去。切到后台再回来不要
// （用户选的就是「仅每次打开时」）。
//
// ---- 门挂在外壳上，不挂在导航上 ----
//
// 从锁屏离开的路不止一条：上滑、点锁屏上的通知、点系统通知直接跳进某段会话、
// 外壳的深链接。它们各自调 nav.unlock() / nav.openApp()。一条条去拦，漏一条就是
// 「不用密码也进得去」。所以这里只记一个 locked，`shell/Root.js` 见它为真就只画锁屏，
// 导航底下怎么动都不露出来；输对了才放开，那时导航停在哪儿就露出哪儿 ——
// 点了通知的人，解锁之后正好落在那段会话里。
//
// ---- 存什么 ----
//
// settings.lockPin = { hash, salt, len }。存的是加盐的 SHA-256，不存密码本身。
// 四位、六位的数字，哈希挡不住穷举，挡的是「随手翻到设置里看一眼」。
//
// ---- 忘了怎么办 ----
//
// 数据只在本机，没有后台能替谁重置。用登录用的账号密码验证一次（auth.login，
// 同一台设备重新登录，不多占设备名额），验证过了就清掉锁屏密码，数据一点不动。
// 没开账号服务的站点没有这条路，设密码的那一页会先说清楚。
import { createStore } from './store.js';
import { settings } from './db/index.js';

export const pinStore = createStore({ locked: false });

export const LENGTHS = [4, 6];

export const hasPin = () => !!settings.get().lockPin?.hash;
export const pinLength = () => (settings.get().lockPin?.len === 6 ? 6 : 4);

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return hex(a);
}

async function digest(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  if (crypto?.subtle) return hex(await crypto.subtle.digest('SHA-256', data));
  // 非安全上下文（直接用 IP 打开的 http）拿不到 subtle。退回一个不那么强的散列，照样不存原文
  let h = 2166136261;
  for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  return `f${h.toString(16)}`;
}

const valid = (pin, len) => typeof pin === 'string' && pin.length === len && /^\d+$/.test(pin);

export async function setPin(pin) {
  const len = String(pin).length;
  if (!LENGTHS.includes(len) || !valid(pin, len)) throw new Error('密码为 4 位或 6 位数字');
  const salt = randomSalt();
  settings.set({ lockPin: { hash: await digest(pin, salt), salt, len } });
  clearFails();
}

export function clearPin() {
  settings.set({ lockPin: null });
  clearFails();
  release();
}

// ---- 输错之后的等待 ----
//
// 连错五次开始要等，越错等得越久。记在 localStorage：重开应用不会把等待清零
const FAIL_KEY = 'eira-pin-fail';
const WAITS = [30, 60, 300, 900];        // 第 5、6、7、8 次及以后，秒
const FREE = 5;

function readFails() {
  try { return JSON.parse(localStorage.getItem(FAIL_KEY) || 'null') || { n: 0, until: 0 }; }
  catch { return { n: 0, until: 0 }; }
}
function writeFails(v) {
  try { localStorage.setItem(FAIL_KEY, JSON.stringify(v)); } catch { /* 隐私模式记不住，认了 */ }
}
function clearFails() { try { localStorage.removeItem(FAIL_KEY); } catch { /* 同上 */ } }

/** 还要等几秒才能再试。0 表示现在就能输 */
export const waitLeft = () => Math.max(0, Math.ceil((readFails().until - Date.now()) / 1000));
export const failCount = () => readFails().n;

/** 核对。对了清掉错次；错了记一次，到了次数开始计时。给回 true / false */
export async function check(pin) {
  const p = settings.get().lockPin;
  if (!p?.hash) return true;
  if (waitLeft() > 0) return false;
  if ((await digest(String(pin), p.salt)) === p.hash) { clearFails(); return true; }
  const f = readFails();
  const n = f.n + 1;
  const wait = n >= FREE ? WAITS[Math.min(n - FREE, WAITS.length - 1)] : 0;
  writeFails({ n, until: wait ? Date.now() + wait * 1000 : 0 });
  return false;
}

/** 开机时调一次：设了密码就先锁上 */
export function lockAtBoot() {
  if (hasPin()) pinStore.set({ locked: true });
}

export function release() { pinStore.set({ locked: false }); }
