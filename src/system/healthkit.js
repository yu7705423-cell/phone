import * as health from './health.js';

// 从 iOS 的「健康」app 读数据。
//
// **网页要不到这个。** 浏览器没有读 Apple 健康的 API，这件事只能由原生那层做。
// 所以只有装成 ipa 的时候才有；浏览器里、加到主屏幕的 PWA 里、安卓上，
// 一律没有，界面要照常能用。
//
// ---- 为什么它可能装了也不能用 ----
//
// 读健康数据要 `com.apple.developer.healthkit` 这个 entitlement，
// 而 entitlement 是**签名时**写进去的。这个项目发出去的是未签名的 ipa，
// 各人自己签，拿不拿得到那个权限因人而异：
//
//   TrollStore、付费开发者账号   拿得到
//   免费 Apple ID + Sideloadly   多半拿不到
//
// 所以这里不假设它一定能用：先问外壳有没有这座桥，再问系统给不给授权，
// 两道都过了才算数。**拿不到就把原话显示出来** —— 那是签名的事，不是坏了，
// 用户得看得出区别，否则只会觉得这个功能是坏的。

const BRIDGE = () => window.webkit?.messageHandlers?.health;

/** 这台设备上有没有这座桥。外壳在文档一开始注入 window.phoneHealth。 */
export const available = () => !!(window.phoneHealth && BRIDGE());

async function call(action, payload = {}) {
  const bridge = BRIDGE();
  if (!bridge) throw new Error('这个版本没有连接系统健康数据的通道');
  const got = await bridge.postMessage({ action, ...payload });
  if (got && got.error) throw new Error(String(got.error));
  return got || {};
}

/**
 * 问系统要授权。弹的是系统那张勾选表，给不给、给哪几项都由用户在那张表上定。
 *
 * 回来的 granted 只表示「这次询问走完了」，不表示每一项都给了 ——
 * HealthKit 出于隐私不告诉应用用户拒了哪一项，读不到就是空的。这是系统的设计。
 */
export function request() { return call('request'); }

/** 系统那边现在是什么状态。用来决定界面上那一行写什么。 */
export function status() { return call('status'); }

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * 拉最近 days 天写进本地。回来的是实际动了几天。
 *
 * **只填系统给得出的那几项**（睡眠、步数、体重、喝水），
 * 心情、症状、备注、用药是手记的，一个字都不碰 —— 同步不该把人写的东西冲掉。
 * 某一项系统没给（没授权、或者压根没数据），那一项也不动，保留原来手填的值。
 */
export async function pull(days = 30) {
  const got = await call('read', { days: Math.max(1, Math.round(days) || 1) });
  const rows = Array.isArray(got.days) ? got.days : [];
  let touched = 0;
  for (const r of rows) {
    const date = String(r?.date || '').slice(0, 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(date)) continue;
    const patch = { source: 'healthkit' };
    // 0 与「没给」在这里是同一回事：系统不会给 0 步，只会不给
    if (num(r.sleepMin) > 0) patch.sleepMin = Math.round(num(r.sleepMin));
    if (num(r.steps) > 0) patch.steps = Math.round(num(r.steps));
    if (num(r.weightKg) > 0) patch.weight = +num(r.weightKg).toFixed(2);
    if (num(r.water) > 0) patch.water = Math.round(num(r.water));
    if (Object.keys(patch).length === 1) continue;   // 只有 source，等于没数据
    health.set(health.ME, date, patch);
    touched += 1;
  }
  return { days: touched, read: rows.length };
}
