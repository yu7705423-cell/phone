import { settings, chats, characters } from '../db/index.js';
import * as svc from './services.js';
import { isVideoReady as videoReady } from './video.js';

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
    id: 'cropKeptPhoto',
    label: '角色存你发的照片时按它说的裁',
    setting: 'cropKeptPhoto', off: false,
    on: s => s.cropKeptPhoto === true,
    when: '角色写了 [存图：…] 而你刚发过一张照片（走识图接口）',
  },
  {
    id: 'chatFallback',
    label: '接口失败时自动换下一套',
    setting: 'chatFallback', off: false,
    on: s => s.chatFallback === true,
    when: () => {
      const n = swapCount();
      return n > 0 ? `仅在接口报错时，最多再换 ${n} 套` : '仅在接口报错时（当前没有别的接口可换）';
    },
  },
  {
    id: 'retryMax',
    label: '自动重试',
    setting: 'retryMax', off: 0,
    on: s => Number(s.retryMax) > 0,
    when: s => `接口返回 429 或 5xx 时，最多再试 ${retryMax()} 次`,
  },
  {
    id: 'videoOn',
    label: '角色自己发视频',
    setting: 'videoOn', off: false,
    on: s => s.videoOn === true && videoReady(),
    when: '角色每写一个 [视频：…]，多一次视频生成（走视频接口，按秒计费）',
  },
  {
    id: 'writeImagePrompt',
    label: '生图前先写一遍提示词',
    setting: 'writeImagePrompt', off: false,
    on: s => s.writeImagePrompt === true,
    when: '角色每写一个 [图片：…]，先多一次接口把它改写成完整描述（走副用接口）',
  },
  {
    id: 'writeVideoPrompt',
    label: '生成视频前先写一遍提示词',
    setting: 'writeVideoPrompt', off: false,
    on: s => s.writeVideoPrompt === true,
    when: '角色每写一个 [视频：…]，先多一次接口把它改写成完整描述（走副用接口）',
  },
  {
    id: 'writeVoicePrompt',
    label: '合成语音前先写成台本',
    setting: 'writeVoicePrompt', off: false,
    on: s => s.writeVoicePrompt === true,
    // 通话里是让通话模型在台词里直接标，不另打一次，所以这里只算聊天那一路
    when: '角色每发一条语音，先多一次接口在原句中标出停顿、情绪与声音（走副用接口；通话中随台词一并标出，不另计）',
  },
  {
    id: 'groupPerChar',
    label: '群聊中每个角色单独调用',
    setting: 'groupPerChar', off: false,
    on: s => s.groupPerChar === true,
    when: '群聊每轮按开口的成员各调用一次：被 @ 的成员，或未 @ 时的全体成员',
  },
  {
    id: 'callSummary',
    label: '打完电话自动总结',
    setting: 'callSummary', off: false,
    // 默认开着：没写过这一项的按开着算（例外见 check-calls.mjs 的 ALLOW_ON）
    on: s => s.callSummary !== false,
    when: '每通接通过的电话挂断时一次（走副用接口）',
  },
  {
    // 开关是那段对话自己的「翻译」设置，不是全局一项，所以没有 setting 要比对。
    // 普通聊天在「随回复给出」那一档不另花钱，通话里一律另翻一道 ——
    // 台词里夹着的译文会被念出来（见 system/call.js 的 plain）
    id: 'callTranslate',
    label: '通话中翻译角色的话',
    setting: null,
    on: () => chats.all().some(c => !!c.translateTo),
    when: '开了翻译的对话里打电话时，角色每说完一轮一次（有单独的翻译接口就走它，否则走副用）',
  },
  {
    id: 'rerankOn',
    label: '召回之后重排一遍',
    setting: 'rerankOn', off: false,
    on: s => s.rerankOn === true && svc.rerankReady(),
    when: '每一轮各一次（走重排接口，不是聊天接口）。通话不走重排',
  },
  {
    id: 'memoryVector',
    label: '记忆按语义检索',
    setting: 'memoryVector', off: false,
    on: s => s.memoryVector === true && svc.embedReady(),
    when: '每一轮各取一次查询向量（走向量接口，不是聊天接口）',
  },
  {
    id: 'banReroll',
    label: '写了禁写词就重新生成',
    setting: 'banReroll', off: 0,
    on: s => Number(s.banReroll) > 0 && (Array.isArray(s.banPhrases) ? s.banPhrases.length : 0) > 0,
    when: s => `角色的回复命中禁写词时，最多再生成 ${Math.max(0, Math.round(Number(s.banReroll) || 0))} 次`,
  },
  {
    id: 'sceneSummary',
    label: '线下一场收尾时生成摘要',
    setting: 'sceneSummary', off: false,
    on: s => s.sceneSummary === true,
    when: '线下点「收场」时多跑一次（走副用或记忆接口）',
  },
  {
    id: 'workSummary',
    label: '「我们」一篇收尾时生成摘要',
    setting: 'workSummary', off: false,
    on: s => s.workSummary === true,
    when: '「我们」里点「收篇」时多跑一次（走副用或记忆接口）',
  },
  {
    id: 'sceneCompress',
    label: '线下把窗口外的段落压成摘要',
    setting: 'sceneCompress', off: false,
    on: s => s.sceneCompress === true,
    when: '线下有段落被窗口挡在外面时，每隔一段压一次（走副用或记忆接口）',
  },
  {
    id: 'reviewAuto',
    label: '看完自动写一篇评',
    setting: 'reviewAuto', off: false,
    on: s => s.reviewAuto === true,
    when: '一起看或一起读收场时，各多写一篇',
  },
  {
    // 挂在通话界面那个喇叭上，不是全局设置，所以没有 setting 要比对
    id: 'callVoice',
    label: '通话时出声',
    setting: null,
    on: () => settings.get().callSpeak === true && svc.voiceConfig().enabled,
    when: '通话中角色每说一句，走一次语音合成接口（不是聊天接口）',
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
    // 挂在角色身上，不是全局设置，所以没有 setting 要比对
    id: 'snap',
    label: '角色自己往相册存照片',
    setting: null,
    on: () => characters.all().some(c => c.snap === true),
    when: '每个开了的角色，每隔设定的天数一次（想拍什么一次，画出来一次）',
  },
  {
    id: 'dayOn',
    label: '角色的当日日程',
    setting: null,
    on: () => characters.all().some(c => c.dayOn),
    when: '每个开了的角色，每天第一条消息一次',
  },
];

/**
 * 失败之后最多再换几套。
 *
 * **填 0 是「其余的全试」，不是「一套都不试」**（第 13 条：能改到「全都要」）。
 * 关不关这件事归 `chatFallback` 那个开关管，不归这个数字管 —— 两个都能关
 * 的话，用户会在两处之间来回猜到底哪个说了算。
 */
export function failoverMax() {
  const n = Math.round(Number(settings.get().failoverMax));
  if (!Number.isFinite(n) || n < 0) return 1;
  return n === 0 ? Infinity : n;
}

/** 填全了的聊天接口有几套。没填全的不算 —— 换过去也是白撞一次墙。 */
export const usableChatCount = () =>
  svc.chatPresets().filter(p => p && p.apiKey && p.model).length;
const usablePresets = usableChatCount;

/** 这一次失败之后，实际还能换几套。 */
export function swapCount() {
  if (settings.get().chatFallback !== true) return 0;
  return Math.max(0, Math.min(failoverMax(), usablePresets() - 1));
}

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
  // 重排只对语义召回的候选生效，向量没开就不会跑
  if (s.rerankOn === true && svc.rerankReady() && s.memoryVector === true && svc.embedReady()) n += 1;
  if (chat?.translateTo && svc.translateMode() === 'api') n += 1;
  // 心声「单独生成」那一档是整轮说完之后另起的一次调用
  if (chat?.innerMode === 'apart') n += 1;
  // 群聊按人头算的那一档：回复本身从 1 次变成成员数那么多次（没 @ 人时全体都说）
  const size = (chat?.characterIds || []).filter(id => characters.get(id)).length;
  if (size > 1 && s.groupPerChar === true) n += size - 1;
  return n;
}

/**
 * **一次调用失败时，实际会打出去几个请求。**
 *
 * 要紧的是这两项**相乘**，不是相加：
 *
 *   「失败改用副用」把一次调用变成两个请求；
 *   「自动重试」重的是**整轮**，连同那次换套一起再来一遍。
 *
 * 两个都开着，一次回复失败就是四个请求。从前这一页只把它们各算一项加进去，
 * 于是界面上写「这一轮 2 次」，账单上是 4 次 —— 正是第 15 条要拦的那种
 * 「功能照跑，账单照涨，而界面仍然写着 1」。
 */
export function attemptsPerCall() {
  // 聊天那几处 enqueue 给的 retries 都写的 1，真正试几次取它与 retryMax 里小的那个
  const tries = 1 + Math.min(1, retryMax());
  // 换几套要按**真能换出去几套**算：开关开着但只配了一套，换不出去，
  // 那就还是 1。界面上写「最多 4 次」而实际只有 2 次，同样是把账说错
  const swap = 1 + swapCount();
  return tries * swap;
}

/** 全都失败时，这一轮最多会打出去几个请求。顺利时是 perTurn。 */
export function worstPerTurn(chatId) {
  return perTurn(chatId) * attemptsPerCall();
}
