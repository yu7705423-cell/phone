import { settings, chats, characters } from '../db/index.js';
import * as svc from './services.js';

// 一轮聊天会打几次接口。
//
// **规矩（CLAUDE.md 第 15 条）：一次回复默认只允许一次接口调用。**
// 凡是会让它变成两次以上的，一律给开关，一律默认关着。
//
// 这个文件是那份开关的**唯一清单**。三个地方读它：
//   「用量与上限」那一页，把账摆出来；
//   scripts/check-calls.mjs，拦「新加了一项却默认开着」；
//   以后再加这类功能时，加在这里，别处不必改。
//
// 漏登记的后果是安静的：功能照跑，账单照涨，而界面上那个「这一轮 1 次」
// 仍然写着 1。所以新增一项会多调接口的东西，第一件事是在这里加一行。

/**
 * off  这一项处在「不会多调接口」的状态时，设置里应该是什么值。
 *      check-calls.mjs 拿它比对 DEFAULT_SETTINGS，对不上就报错。
 * on   现在开着没有。有些项还要看接口配全了没有，所以是个函数。
 * when 什么时候会真的多打一次。给界面用。
 */
export const EXTRA_CALLS = [
  {
    id: 'bondAuto',
    label: '自动重压关系底色',
    setting: 'bondAuto', off: false,
    on: s => s.bondAuto === true,
    when: 'S 级记忆有增删改之后的第一条消息',
  },
  {
    id: 'autoSummarizeInterval',
    label: '自动总结记忆',
    setting: 'autoSummarizeInterval', off: 0,
    on: s => Number(s.autoSummarizeInterval) > 0,
    when: s => `每累计 ${s.autoSummarizeInterval} 条角色回复`,
  },
  {
    id: 'chatFallback',
    label: '主用接口失败时改用副用',
    setting: 'chatFallback', off: false,
    on: s => s.chatFallback === true,
    when: '仅在主用接口报错时',
  },
  {
    id: 'retryMax',
    label: '自动重试',
    setting: 'retryMax', off: 0,
    on: s => Number(s.retryMax) > 0,
    when: s => `接口返回 429 或 5xx 时，最多再试 ${retryMax()} 次`,
  },
  {
    id: 'memoryVector',
    label: '记忆按语义检索',
    setting: 'memoryVector', off: false,
    on: s => s.memoryVector === true && svc.embedReady(),
    when: '每一轮各取一次查询向量（走向量接口，不是聊天接口）',
  },
  {
    id: 'readNotesAuto',
    label: '一起读时自动预读批注',
    setting: 'readNotesAuto', off: false,
    on: s => s.readNotesAuto === true,
    when: '一起读翻到还没批过的那一页时，多打一次（一次批若干页）',
  },
  {
    id: 'reviewAuto',
    label: '看完自动写一篇评',
    setting: 'reviewAuto', off: false,
    on: s => s.reviewAuto === true,
    when: '一起看或一起读收场时，各多写一篇',
  },
  {
    id: 'translate',
    label: '单独的翻译接口',
    setting: null,
    on: () => svc.translateMode() === 'api',
    when: '这段对话开了翻译时，每一轮一次',
  },
  {
    // 挂在会话上，不是全局设置，所以没有 setting 要比对
    id: 'inner',
    label: '心声单独生成',
    setting: null,
    on: () => chats.all().some(c => c.innerMode === 'apart'),
    when: '开了这一档的对话，每一轮在整轮说完之后再一次',
  },
  {
    id: 'dayOn',
    label: '角色的当日日程',
    setting: null,
    on: () => characters.all().some(c => c.dayOn),
    when: '每个开了的角色，每天第一条消息一次',
  },
];

// 重试次数。上限写死 3 —— 再多也救不回来，只是把同一个错误的账单乘以四。
export const RETRY_CAP = 3;
export function retryMax() {
  const n = Math.round(Number(settings.get().retryMax) || 0);
  return Math.max(0, Math.min(RETRY_CAP, Number.isFinite(n) ? n : 0));
}

/** 现在开着的那几项。 */
export function active() {
  const s = settings.get();
  return EXTRA_CALLS.filter(x => {
    try { return x.on(s); } catch { return false; }
  }).map(x => ({
    ...x,
    whenText: typeof x.when === 'function' ? x.when(s) : x.when,
  }));
}

/**
 * 这段对话发一条消息，最少会打几次接口。
 *
 * 只数**每一轮都会发生**的那些：重试要报错才有，记忆总结要攒够条数，
 * 日程一天只一次 —— 那些算在 active() 里说明白，不计进这个数。
 */
export function perTurn(chatId) {
  let n = 1;                                   // 聊天回复本身
  const s = settings.get();
  const chat = chats.get(chatId);
  if (s.memoryVector === true && svc.embedReady()) n += 1;
  if (chat?.translateTo && svc.translateMode() === 'api') n += 1;
  // 心声「单独生成」那一档是整轮说完之后另起的一次调用
  if (chat?.innerMode === 'apart') n += 1;
  return n;
}
