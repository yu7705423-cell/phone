import { chats, messagesOf } from './db/index.js';
import * as accounts from './accounts.js';

// 搜聊天记录。
//
// 十几万条的时候，一次全表 includes 在桌面上是十几毫秒，在手机上是一两百 ——
// 每敲一个字卡一下。这里不建倒排索引：中文没有词边界，要建就得建二元组，
// 十几万条是几百万个 posting，内存和维护成本都不值。靠三件事撑住这个规模：
//
//   1. **不另存一份**。每个会话的消息本来就有一份按时间排好的缓存
//      （db 的 messagesOf，见 3.95），搜索直接扫它，不再抄一份全局快照 ——
//      抄一份十几万条的快照本身就要一百多毫秒，而且哪条消息一变就得重抄。
//   2. **按时间归并着扫**。几十个会话各自有序，用一个小顶堆从尾往前归并，
//      扫到的天然就是最新的那条。于是**够数就能停** —— 「晚」这种到处都是的词，
//      扫几百条就凑满一屏，不必把十几万条都过一遍。
//   3. **分片**。一片跑满 SLICE_MS 就让出主线程。片长是按时间算的，
//      不是按条数，所以手机慢就多切几片，**每一片始终只占一帧**。
//      罕见词要扫全库也一样，扫得再久界面都不停。

const SLICE_MS = 8;         // 一片最多占用主线程这么久
const CHECK_EVERY = 512;    // 每扫这么多条查一次表，每条都查太贵
const DEFAULT_LIMIT = 200;

// 让出主线程。setTimeout 有 4ms 下限，切几百片就白等好几百毫秒；
// MessageChannel 没有这个下限，歇的那一下就是浏览器真正要用的那一下。
const yieldToBrowser = (() => {
  if (typeof MessageChannel !== 'function') return fn => setTimeout(fn, 0);
  const ch = new MessageChannel();
  let queue = [];
  ch.port1.onmessage = () => { const q = queue; queue = []; q.forEach(fn => fn()); };
  return fn => { queue.push(fn); ch.port2.postMessage(0); };
})();

// ---- 小顶堆的反面：按 at 最大的先出 ----
// 会话数量不多，但罕见词要把十几万条都过一遍，每条都在几十个会话里挑一遍最大的
// 就是几百万次比较。堆把这一步压到 log(会话数)。
function siftDown(h, i) {
  for (;;) {
    let big = i;
    const l = i * 2 + 1, r = l + 1;
    if (l < h.length && h[l].at > h[big].at) big = l;
    if (r < h.length && h[r].at > h[big].at) big = r;
    if (big === i) return;
    [h[i], h[big]] = [h[big], h[i]];
    i = big;
  }
}
function siftUp(h, i) {
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].at >= h[i].at) return;
    [h[i], h[p]] = [h[p], h[i]];
    i = p;
  }
}

function chatIdsFor(scope) {
  if (scope) return [scope];
  const me = accounts.currentId();
  return chats.all()
    .filter(c => (c.personaId || me) === me)
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
    .map(c => c.id);
}

/**
 * 搜。返回 { cancel, done }。
 *
 * onBatch(hits, finished) 每扫完一片调一次。hits 是按时间倒序的消息 id，
 * 一片一片往上加，界面照着它随扫随显示。
 *
 * done 给出 { hits, finished, truncated }。truncated 为 true 表示是凑满 limit
 * 提前停的，后面还有更多没扫 —— 所以界面写「仅显示最近 200 条」而不是报个总数：
 * 报总数就得把十几万条全过一遍，为了一个数字白扫一遍不划算。
 *
 * chatId 传了就只搜这一段对话。
 */
export function searchMessages(query, { chatId = '', limit = DEFAULT_LIMIT, onBatch } = {}) {
  const q = String(query || '').trim().toLowerCase();
  let cancelled = false;
  const hits = [];

  if (!q) {
    onBatch && onBatch(hits, true);
    return { cancel() {}, done: Promise.resolve({ hits, finished: true, truncated: false }) };
  }

  const ids = chatIdsFor(chatId);
  const heap = [];
  let prepared = 0;     // 已经放进堆里的会话数
  let scanned = 0;

  const done = new Promise(resolve => {
    const finish = (finished, truncated) => {
      onBatch && onBatch(hits, finished);
      resolve({ hits, finished, truncated });
    };

    const step = () => {
      if (cancelled) { resolve({ hits, finished: false, truncated: false }); return; }
      const until = performance.now() + SLICE_MS;

      // 先把各个会话的游标架起来。messagesOf 第一次调到某个会话要排一次序，
      // 所以这一步也放在分片里，一个会话一个会话地来。
      while (prepared < ids.length) {
        const list = messagesOf(ids[prepared++]);
        if (list.length) {
          heap.push({ list, i: list.length - 1, at: list[list.length - 1].createdAt || 0 });
          siftUp(heap, heap.length - 1);
        }
        if (performance.now() >= until) { yieldToBrowser(step); return; }
      }

      // 归并：堆顶永远是所有会话里还没看过的最新那条
      while (heap.length) {
        const top = heap[0];
        const m = top.list[top.i];

        if (m && m.content && m.kind !== 'typing') {
          // 取小写是为了英文能不分大小写地匹配。中文这一步等于没动，
          // V8 对没有大写字母的字符串直接返回原串，不会多占内存。
          if (String(m.content).toLowerCase().includes(q)) {
            hits.push(m.id);
            if (hits.length >= limit) { finish(true, true); return; }
          }
        }

        if (--top.i < 0) {
          const last = heap.pop();
          if (heap.length) { heap[0] = last; siftDown(heap, 0); }
        } else {
          top.at = top.list[top.i].createdAt || 0;
          siftDown(heap, 0);
        }

        if ((++scanned % CHECK_EVERY) === 0 && performance.now() >= until) {
          onBatch && onBatch(hits, false);
          yieldToBrowser(step);
          return;
        }
      }
      finish(true, false);
    };

    step();
  });

  return { cancel() { cancelled = true; }, done };
}

// 搜到的那条，在正文里截一段给列表看。命中处前后各留一点，
// 太靠后的话前面加省略号 —— 否则一屏全是开头，看不出为什么匹配上了。
export function excerpt(text, query, span = 16) {
  const s = String(text || '');
  const q = String(query || '').trim();
  if (!q) return s.slice(0, span * 3);
  const at = s.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return s.slice(0, span * 3);
  const from = Math.max(0, at - span);
  const to = Math.min(s.length, at + q.length + span * 2);
  return (from > 0 ? '…' : '') + s.slice(from, to) + (to < s.length ? '…' : '');
}

// 把一段文字按命中处切成 [前, 命中, 后]，界面拿它做高亮。
// 不返回 HTML —— 拼 HTML 就要自己处理转义，界面直接渲染三段文本更省事也更安全。
export function splitHit(text, query) {
  const s = String(text || '');
  const q = String(query || '').trim();
  if (!q) return [s, '', ''];
  const at = s.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return [s, '', ''];
  return [s.slice(0, at), s.slice(at, at + q.length), s.slice(at + q.length)];
}
