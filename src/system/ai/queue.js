import { retryMax } from './cost.js';

// 所有模型请求都从这里出去。并发限制、去重、取消、重试。
// 组件里直接 fetch 是禁止的,见 CLAUDE.md 第 10 条。
//
// **重试要花钱，所以由用户说了算，默认一次都不重试。**
// 调用方给的 retries 只是「这件事最多值得重试几次」，真正试几次取它与
// 用户设的上限里较小的那个。上限写死 3 —— 再多也救不回来，
// 只是把同一个错误的账单乘以四。见 CLAUDE.md 第 15 条与 ai/cost.js。

const waiting = [];
const active = new Map();   // key -> { controller, promise }
let maxConcurrent = 2;

export function setConcurrency(n) { maxConcurrent = Math.max(1, n | 0); }

function pump() {
  while (active.size < maxConcurrent && waiting.length) {
    const job = waiting.shift();
    if (job.cancelled) continue;
    start(job);
  }
}

function start(job) {
  const controller = new AbortController();
  const entry = { controller, promise: null };
  active.set(job.key, entry);

  entry.promise = (async () => {
    let lastErr;
    for (let attempt = 0; attempt <= job.retries; attempt++) {
      try {
        return await job.fn(controller.signal);
      } catch (err) {
        lastErr = err;
        if (controller.signal.aborted) throw err;
        const retryable = err.status === 429 || (err.status >= 500 && err.status < 600)
          || err.name === 'TypeError';           // 网络中断
        if (!retryable || attempt === job.retries) throw err;
        await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)));
      }
    }
    throw lastErr;
  })();

  entry.promise
    .then(job.resolve, job.reject)
    .finally(() => { active.delete(job.key); pump(); });
}

export function enqueue(key, fn, { retries = 1, replace = false } = {}) {
  const want = Math.max(0, Math.round(Number(retries) || 0));
  retries = Math.min(want, retryMax());
  if (active.has(key)) {
    if (!replace) return active.get(key).promise;
    active.get(key).controller.abort();
  }
  const queued = waiting.find(j => j.key === key);
  if (queued) {
    if (!replace) return queued.promise;
    queued.cancelled = true;
  }

  const job = { key, fn, retries, cancelled: false };
  job.promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });
  waiting.push(job);
  pump();
  return job.promise;
}

export function cancel(key) {
  const a = active.get(key);
  if (a) { a.controller.abort(); return true; }
  const q = waiting.find(j => j.key === key);
  if (q) {
    q.cancelled = true;
    q.reject(Object.assign(new Error('已取消'), { name: 'AbortError' }));
    return true;
  }
  return false;
}

export function cancelAll() {
  waiting.forEach(j => {
    j.cancelled = true;
    j.reject(Object.assign(new Error('已取消'), { name: 'AbortError' }));
  });
  waiting.length = 0;
  active.forEach(a => a.controller.abort());
}

export function isRunning(key) { return active.has(key) || waiting.some(j => j.key === key); }
export function stats() { return { active: active.size, waiting: waiting.length }; }
export const isAbort = err => err && (err.name === 'AbortError' || /已取消/.test(err.message || ''));
