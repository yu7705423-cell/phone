import { BUILD } from '../version.js';
import { forceUpdate } from './refresh.js';

// 更新之后一直开着的页面，要换成新版本（ARCHITECTURE 4.243）。
//
// 启动时的比对（main.js）只管「打开的那一刻」。一个页面开着好几天（电脑上的标签页、没被系统回收的主屏幕应用），
// 在重新打开之前一直跑旧代码 —— 新版本里修掉的问题，包括会反复扣费的那种，对它不生效。
//
// 做法：每次回到前台（最多十分钟问一次），不走缓存取一遍 index.html，看里面的构建号和本页的是不是同一个。
// 不同就换：清缓存、重新载入。**不打断正在做的事**：输入框里有字、正在通话、正在生成时先不换，
// 下一次回到前台再看。
//
// 自动化测试里默认不开（好几个测试会换 index.html 造场景），专门测它的那一个在 localStorage 里放 eira-newbuild-test。

const EVERY = 10 * 60 * 1000;
let every = EVERY;
let lastCheck = 0;
let pending = false;

async function latest() {
  const res = await fetch(`${location.pathname}?nb=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return '';
  const html = await res.text();
  return (html.match(/<meta name="build" content="([^"]+)"/) || [])[1] || '';
}

async function busy() {
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && String(el.value || '').trim()) return true;
  try { if ((await import('./call.js')).active()) return true; } catch { /* 读不到当作没在通话 */ }
  try { const q = (await import('./ai/queue.js')).stats(); if (q.active || q.waiting) return true; } catch { /* 同上 */ }
  return false;
}

async function check() {
  if (!pending) {
    if (Date.now() - lastCheck < every) return false;
    lastCheck = Date.now();
    let b = '';
    try { b = await latest(); } catch { return false; }
    if (!b || b === BUILD) return false;
    pending = true;
  }
  if (await busy()) return false;
  await forceUpdate().catch(() => {});
  location.reload();
  return true;
}

export function install() {
  if (typeof document === 'undefined') return;
  let on = true;
  if (navigator.webdriver) {
    try { on = localStorage.getItem('eira-newbuild-test') === '1'; } catch { on = false; }
    every = 0;   // 测试里不等十分钟
  }
  if (!on) return;
  lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check().catch(() => {});
  });
}
