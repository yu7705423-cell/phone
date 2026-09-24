import { SITE } from '../site.js';

// 登录账号。账号由运营方在管理页里发放，不开放注册（服务端见 worker/netease.js 的 /auth/ 部分）。
//
// **这是进门的那道门，不管数据。** 角色卡、聊天记录照旧只存在这台设备上，登录不会把它们传到任何地方，
// 换一个账号登录看到的仍是这台设备上的数据。
//
// 什么时候要登录：src/site.js 填了 accounts（账号服务的地址），而且那边真的开了账号功能
// （GET 回 accounts:true）。只填了地址、服务端还没设置好时照常放行 —— 运营方可以先发版、后开通，
// 中间不会把所有人关在门外。
//
// 凭证与设备号存在 localStorage，不进数据库、不进备份：备份发给别人，不该把自己的登录一起发过去。
//
// 离线：有凭证就放行（这时本来也用不了联网的功能），联网后下一次检查再说。
// 没凭证又连不上账号服务：上一次知道服务端没开账号功能就放行，否则停在登录页，写明连不上。

const KEY = 'eira-auth';          // { name, token, initial }
const DEVICE = 'eira-device';
const OFF = 'eira-auth-off';      // 上一次问到的：服务端没开账号功能
const NOTE = 'eira-auth-note';    // 被挤下线等原因，重开后在登录页上说一句
const CHECK_GAP = 30 * 60 * 1000; // 回到前台时，距上次检查超过这么久才再查

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 隐私模式 */ } },
};

export const serviceUrl = () => String(SITE.accounts || '').replace(/\/+$/, '');

function saved() {
  try { return JSON.parse(store.get(KEY) || 'null') || null; } catch { return null; }
}
function save(v) { store.set(KEY, v ? JSON.stringify(v) : null); }

export function deviceId() {
  let d = store.get(DEVICE);
  if (!d) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    d = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    store.set(DEVICE, d);
  }
  return d;
}

// 在管理页的设备列表里显示成什么
function deviceLabel() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return '其他设备';
}

/** 当前登录的账号名。没有账号功能或没登录给 '' */
export const currentName = () => saved()?.name || '';

/** 随请求带给账号服务、网易云转发的凭证 */
export const token = () => saved()?.token || '';

/** 还在用管理员发的初始密码（没自己改过） */
export const isInitial = () => saved()?.initial === true;

/** 当前是不是管理员自己（admin 的密码在 Cloudflare 后台改，不在这里） */
export const isAdmin = () => currentName() === 'admin';

async function post(path, body, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${serviceUrl()}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    let data = null;
    try { data = await r.json(); } catch { /* 不是 JSON */ }
    return { status: r.status, data: data || {} };
  } finally { clearTimeout(t); }
}

async function serverOn() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(serviceUrl(), { method: 'GET', signal: ctl.signal });
    const b = await r.json();
    return b?.accounts === true;
  } finally { clearTimeout(t); }
}

let lastCheck = 0;

/**
 * 开机时问一次：能不能进门。给回 { ok: true } 或 { ok: false, note, offline }。
 * note 是登录页上要说的那一句（被挤下线、已停用、连不上）；offline 为真时登录页给「重新连接」
 */
export async function gate() {
  if (!serviceUrl()) return { ok: true };
  const note = store.get(NOTE) || '';
  store.set(NOTE, null);
  const s = saved();
  if (s?.token) {
    try {
      const r = await post('/auth/check', { token: s.token }, 8000);
      if (r.status === 200 && r.data.token) {
        save({ name: r.data.name || s.name, token: r.data.token, initial: r.data.initial === true });
        store.set(OFF, null);
        lastCheck = Date.now();
        return { ok: true };
      }
      if (r.status === 503) { store.set(OFF, '1'); return { ok: true }; }   // 服务端关了账号功能
      if (r.data.relogin) { save(null); return { ok: false, note: r.data.error || '请重新登录' }; }
      return { ok: true };                                                // 别的错误不把人关在门外
    } catch {
      return { ok: true };                                                // 离线：有凭证就放行
    }
  }
  try {
    const on = await serverOn();
    store.set(OFF, on ? null : '1');
    return on ? { ok: false, note } : { ok: true };
  } catch {
    if (store.get(OFF)) return { ok: true };
    return { ok: false, offline: true, note: '暂时连接不上账号服务，请检查网络后重新连接。' };
  }
}

/** 登录。成功给回 { name, initial }，失败抛出写给人看的原因 */
export async function login(name, password) {
  const n = String(name || '').trim();
  if (!n || !password) throw new Error('请填写账号与密码');
  let r;
  try {
    r = await post('/auth/login', { name: n, password, device: deviceId(), label: deviceLabel() });
  } catch {
    throw new Error('暂时连接不上账号服务，请检查网络后重试。');
  }
  if (r.status !== 200 || !r.data.token) throw new Error(r.data.error || `登录没有成功（${r.status}）`);
  const got = { name: r.data.name || n, token: r.data.token, initial: r.data.initial === true };
  save(got);
  lastCheck = Date.now();
  return { name: got.name, initial: got.initial };
}

/** 自己改密码。改完之后别的设备退出，本机不退 */
export async function changePassword(old, next, again) {
  if (!old || !next) throw new Error('请填写原密码与新密码');
  if (again !== undefined && next !== again) throw new Error('两次输入的新密码不一致');
  let r;
  try {
    r = await post('/auth/password', { token: token(), old, password: next });
  } catch {
    throw new Error('暂时连接不上账号服务，请检查网络后重试。');
  }
  if (r.status !== 200) throw new Error(r.data.error || `修改没有成功（${r.status}）`);
  const s = saved();
  if (s) save({ ...s, initial: false });
  return true;
}

/** 退出登录。服务端那一步失败也照样在本机退出 */
export async function logout() {
  const t = token();
  save(null);
  if (t) { try { await post('/auth/logout', { token: t }, 5000); } catch { /* 本机已经退出了 */ } }
}

/**
 * 回到前台时复查（距上次超过 CHECK_GAP 才查）：被挤下线、被停用、密码被重置，
 * 在这台设备上的下一次回到前台时退出，重开到登录页并说明原因
 */
export function watch() {
  if (!serviceUrl() || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const s = saved();
    if (!s?.token || Date.now() - lastCheck < CHECK_GAP) return;
    lastCheck = Date.now();
    try {
      const r = await post('/auth/check', { token: s.token }, 8000);
      if (r.status === 200 && r.data.token) {
        save({ name: r.data.name || s.name, token: r.data.token, initial: r.data.initial === true });
        return;
      }
      if (r.data.relogin) {
        save(null);
        store.set(NOTE, r.data.error || '请重新登录');
        location.reload();
      }
    } catch { /* 离线：下次再查 */ }
  });
}

// ---- 管理员 ----

/** 管理页的一次操作。op 见 worker/netease.js 的 admin() */
export async function admin(password, op, extra = {}) {
  let r;
  try {
    r = await post('/auth/admin', { password, op, ...extra }, 20000);
  } catch {
    throw new Error('暂时连接不上账号服务，请检查网络后重试。');
  }
  if (r.status !== 200) throw new Error(r.data.error || `操作没有成功（${r.status}）`);
  return r.data;
}
