// 搬家：换了网址，把旧网址上的数据整份带到新网址（ARCHITECTURE 4.220）。
//
// 浏览器里的数据是按网址（源）分开存的。换了网址，新网址上一条都没有 —— 角色、聊天记录、
// 图片都还留在旧网址那边。两边跑的是同一份代码（都从 release 分支部署），所以做成两个窗口之间
// 直接传：一边把整份备份（backup.build，连同图片、文件与接口密钥）打成一个包，
// 用 postMessage 交给另一边，另一边 backup.restore。不经过任何服务器。
//
// 两个方向，用哪个都行：
//   推  在旧网址上点「搬到新网址」：打开新网址（?move=in），新网址说「好了」，旧网址把包发过去
//   拉  在新网址上点「从旧网址搬过来」：打开旧网址的 move.html，它打好包发回来
//
// **只和 site.js 里写死的那一个网址说话。** 发的时候 postMessage 的目标源写死成对方，
// 收的时候核对 event.origin。别的网页开这个窗口、冒充对方，一个字节都拿不到。
//
// iPhone 上加到主屏幕的那种（PWA）和 Safari 各存各的：从主屏幕打开的旧网址点「搬到新网址」，
// 新网址会在 Safari 里打开，数据落在 Safari 那一边。那时在 Safari 里把新网址加到主屏幕即可；
// 还不行就走备份文件（存储页的导出与恢复），那条路哪里都通。
import { SITE } from '../site.js';
import * as backup from './backup.js';
import { ready } from './db/index.js';

const originOf = u => { try { return new URL(u).origin; } catch { return ''; } };
const slash = u => String(u || '').replace(/\/?$/, '/');

export const fromOrigin = () => originOf(SITE.moveFrom);
export const toOrigin = () => originOf(SITE.moveTo);
const both = () => !!fromOrigin() && !!toOrigin() && fromOrigin() !== toOrigin();

/** 这里是旧网址：该提示搬到新网址 */
export const isOld = () => both() && location.origin === fromOrigin();
/** 这里是新网址：可以从旧网址搬过来 */
export const isNew = () => both() && location.origin === toOrigin();
export const newUrl = () => slash(SITE.moveTo);

const TYPE = 'eira-move';
const WAIT = 10 * 60 * 1000;   // 图片多的时候打包要一会儿

// 打包。接口密钥一起带上：这是同一个人把自己的东西从旧家搬到新家
const pack = onProgress => backup.build({ media: true, keys: true, onProgress });

// ---- 推：旧网址这一侧 ----

/** 在旧网址上：打开新网址，等它准备好，把整份数据发过去 */
export function push({ onStatus } = {}) {
  if (!isOld()) return Promise.reject(new Error('这里不是旧网址'));
  const to = toOrigin();
  const win = window.open(`${newUrl()}?move=in`, 'eira-move');
  if (!win) return Promise.reject(new Error('新窗口被拦下了。请允许本站打开新窗口后再试'));
  return new Promise((resolve, reject) => {
    let sent = false;
    const done = (fn, v) => { clearTimeout(timer); window.removeEventListener('message', on); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('新网址一直没有回应。请确认新网址能打开后再试')), WAIT);
    const on = async e => {
      if (e.origin !== to || e.source !== win || e.data?.type !== TYPE) return;
      const d = e.data;
      if (d.step === 'ready' && !sent) {
        sent = true;
        onStatus?.('正在打包');
        try {
          const blob = await pack(p => onStatus?.(`正在打包 ${Math.round(p * 100)}%`));
          onStatus?.('正在发送');
          win.postMessage({ type: TYPE, step: 'data', blob }, to);
        } catch (err) { done(reject, err); }
      } else if (d.step === 'done') done(resolve, d.result || {});
      else if (d.step === 'error') done(reject, new Error(d.error || '新网址没能收下'));
    };
    window.addEventListener('message', on);
  });
}

/**
 * 在新网址上、被旧网址用 ?move=in 打开时：告诉旧网址可以发了，收到就恢复。
 * 不是这种情况返回 null
 */
export function receive({ onStatus } = {}) {
  const asked = new URLSearchParams(location.search).get('move') === 'in';
  if (!asked || !isNew() || !window.opener) return null;
  const from = fromOrigin();
  const opener = window.opener;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('旧网址一直没有把数据发过来')); }, WAIT);
    const on = async e => {
      if (e.origin !== from || e.source !== opener || e.data?.type !== TYPE || e.data.step !== 'data') return;
      clearTimeout(timer);
      window.removeEventListener('message', on);
      try {
        await ready;
        onStatus?.('正在放进新网址');
        const result = await backup.restore(e.data.blob, { onProgress: p => onStatus?.(`正在放进新网址 ${Math.round(p * 100)}%`) });
        opener.postMessage({ type: TYPE, step: 'done', result }, from);
        resolve(result);
      } catch (err) {
        opener.postMessage({ type: TYPE, step: 'error', error: String(err.message || err) }, from);
        reject(err);
      }
    };
    window.addEventListener('message', on);
    opener.postMessage({ type: TYPE, step: 'ready' }, from);
  });
}

// ---- 拉：新网址这一侧 ----

/** 在新网址上：打开旧网址的 move.html，它打好包发回来，收到就恢复 */
export function pull({ onStatus } = {}) {
  if (!isNew()) return Promise.reject(new Error('这里不是新网址'));
  const from = fromOrigin();
  const win = window.open(`${slash(SITE.moveFrom)}move.html?to=${encodeURIComponent(location.origin)}`, 'eira-move');
  if (!win) return Promise.reject(new Error('新窗口被拦下了。请允许本站打开新窗口后再试'));
  return new Promise((resolve, reject) => {
    const done = (fn, v) => { clearTimeout(timer); window.removeEventListener('message', on); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('旧网址一直没有把数据发过来。请确认旧网址能打开后再试')), WAIT);
    const on = async e => {
      if (e.origin !== from || e.source !== win || e.data?.type !== TYPE) return;
      const d = e.data;
      if (d.step === 'status') { onStatus?.(d.text); return; }
      if (d.step === 'error') { done(reject, new Error(d.error || '旧网址没能打包')); return; }
      if (d.step !== 'data') return;
      try {
        onStatus?.('正在放进新网址');
        const result = await backup.restore(d.blob, { onProgress: p => onStatus?.(`正在放进新网址 ${Math.round(p * 100)}%`) });
        try { win.close(); } catch { /* 关不掉也不要紧 */ }
        done(resolve, result);
      } catch (err) { done(reject, err); }
    };
    window.addEventListener('message', on);
  });
}

/**
 * 旧网址上的 move.html 调它：核对是谁开的这个窗口，打好包发回去。
 * 返回一句给那一页显示的话
 */
export async function serve() {
  const to = new URLSearchParams(location.search).get('to') || '';
  if (!isOld() || !window.opener || originOf(to) !== toOrigin()) {
    return '这个页面只能从新网址的「从旧网址搬过来」打开。';
  }
  const target = toOrigin();
  const say = text => window.opener.postMessage({ type: TYPE, step: 'status', text }, target);
  try {
    await ready;
    say('旧网址正在打包');
    const blob = await pack(p => say(`旧网址正在打包 ${Math.round(p * 100)}%`));
    window.opener.postMessage({ type: TYPE, step: 'data', blob }, target);
    return '已经发给新网址。新网址那边完成后，这个页面可以关闭。';
  } catch (err) {
    window.opener.postMessage({ type: TYPE, step: 'error', error: String(err.message || err) }, target);
    return `打包失败：${err.message || err}`;
  }
}
