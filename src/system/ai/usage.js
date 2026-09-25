// 接口调用的账本。见 ARCHITECTURE 4.166
//
// 「用量与上限」算的是**会**花多少（一轮几次、开着哪几项），这里记的是**已经**
// 花了多少：最近这些天，每一种任务实际打出去几次。从前没有这一本 ——
// 账单上多出几块钱，只能对着代码猜是哪一项在跑（2026-09 重排那一回就是这样）。
//
// 记在哪儿：每个真正发请求的出口各记一笔。文字模型走 engine.send，那是唯一的门；
// 向量、重排、识图、语音识别、语音合成、生图、生成视频各有各的出口，各记各的。
// 重试、失败后换一套，每一次都真的发出去了，所以每一次都记。
//
// 存法：按小时汇总，{ 小时起点: { 任务: 次数 } }，放在 localStorage。
// 一条一条存的话，一天几百次、存一个月就是几十万条，localStorage 装不下；
// 按小时汇总，一个月也只有七百多个格子。设备本地的统计，不进备份 ——
// 换一台设备，那台的账从零记起，本来也不是同一份账单。
//
// 留 30 天。这是账本的保存期，不是能力的上限（CLAUDE.md 第 13 条说的是「一次能做多少」）。

import { createStore } from '../store.js';

const KEY = 'phone.usage';
const HOUR = 3600000;
const KEEP = 30 * 24 * HOUR;

/**
 * 任务 id 到界面名字。auto 表示「没人在屏幕前等它」—— 到点了自己跑、
 * 或者顺带在背后做的。总览页按这个分成两组。
 * 没登记的 id 照样记、照样显示，只是名字就是 id 本身。
 */
export const TASKS = {
  'chat.reply':          { label: '聊天回复' },
  'chat.call':           { label: '通话' },
  'scene.write':         { label: '线下正文' },
  'chat.proactive':      { label: '角色主动发消息', auto: true },
  'char.alt':            { label: '角色开设小号', auto: true },
  'char.snap':           { label: '角色自己存照片', auto: true },
  'day.plan':            { label: '当日日程', auto: true },
  'memory.extract':      { label: '总结记忆', auto: true },
  'memory.bond':         { label: '关系底色', auto: true },
  'memory.import':       { label: '导入记忆' },
  'moment.create':       { label: '角色发朋友圈', auto: true },
  'moment.comment':      { label: '朋友圈评论', auto: true },
  'moment.reply':        { label: '朋友圈回复', auto: true },
  'inner.voice':         { label: '心声', auto: true },
  'translate.lines':     { label: '翻译' },
  'chat.vision-describe': { label: '发给角色的图写成描述', auto: true },
  'chat.face-describe':  { label: '头像写成外貌描述', auto: true },
  'call.summary':        { label: '通话小结', auto: true },
  'scene.summary':       { label: '线下小结', auto: true },
  'work.summary':        { label: '长篇小结', auto: true },
  'review.write':        { label: '书评影评', auto: true },
  'badge.year':          { label: '年度回顾' },
  'card.import':         { label: '导入角色卡' },
  'card.npc':            { label: '生成 NPC' },
  'card.core':           { label: '核心设定' },
  'card.appearance':     { label: '外貌' },
  'event.batch':         { label: '生成随机事件' },
  'health.day':          { label: '角色身体状态', auto: true },
  'closet.daily':        { label: '角色每日穿搭', auto: true },
  'recipe.batch':        { label: '生成食谱' },
  'shelf.batch':         { label: '生成书架' },
  'closet.wardrobe':     { label: '生成角色衣帽间' },
  'shelf.impression':    { label: '书架读后感' },
  'trip.plan':           { label: '出行行程' },
  'trip.tickets':        { label: '出行找票' },
  'para.crew':           { label: '段评' },
  'para.readers':        { label: '段评' },
  'para.one':            { label: '段评' },
  'read.ahead':          { label: '一起读', auto: true },
  'watch.outline':       { label: '一起看提纲' },
  'phone.album':         { label: '查看角色手机' },
  'phone.chat':          { label: '查看角色手机' },
  'phone.chats':         { label: '查看角色手机' },
  'phone.lock':          { label: '查看角色手机' },
  'phone.notes':         { label: '查看角色手机' },
  'phone.reply':         { label: '查看角色手机' },
  'phone.visits':        { label: '查看角色手机' },
  'preset.test':         { label: '测试接口' },
  embed:                 { label: '向量', auto: true },
  rerank:                { label: '重排', auto: true },
  vision:                { label: '识图' },
  asr:                   { label: '语音识别' },
  tts:                   { label: '语音合成' },
  image:                 { label: '生图' },
  video:                 { label: '生成视频' },
};

export const labelOf = id => TASKS[id]?.label || id;
export const isAuto = id => !!TASKS[id]?.auto;

export const usageStore = createStore({ v: 0 });

let book = null;
let timer = 0;

function load() {
  if (book) return book;
  try { book = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { book = {}; }
  prune();
  return book;
}

function prune(now = Date.now()) {
  for (const h of Object.keys(book)) if (Number(h) < now - KEEP) delete book[h];
}

// 一次请求写一次 localStorage 太勤，攒两秒一起写。页面在这两秒里关掉的话
// 丢最后几笔 —— 统计用的账，能接受
function flush() {
  timer = 0;
  try { localStorage.setItem(KEY, JSON.stringify(book)); } catch { /* 隐私模式会抛 */ }
}

/** 记一笔。每个真正发请求的出口调一次 */
export function note(task, now = Date.now()) {
  load();
  const h = Math.floor(now / HOUR) * HOUR;
  const row = book[h] || (book[h] = {});
  row[task] = (row[task] || 0) + 1;
  if (!timer) timer = setTimeout(flush, 2000);
  usageStore.set({ v: now });
}

/**
 * 最近 ms 毫秒里每种任务几次。回 [{ label, auto, n }]，多的在前。
 * 按界面名字合并：查手机那几页、段评那几种在账上各是一个 id，在人眼里是同一件事
 */
export function since(ms, now = Date.now()) {
  load();
  const from = now - ms;
  const sum = new Map();
  for (const [h, row] of Object.entries(book)) {
    // 这一小时的格子只要有一部分落在区间里就算进来。按小时汇总的代价：
    // 「最近 24 小时」实际是最近 24 到 25 个小时
    if (Number(h) + HOUR <= from) continue;
    for (const [id, n] of Object.entries(row)) {
      const label = labelOf(id);
      const cur = sum.get(label) || { label, auto: isAuto(id), n: 0 };
      cur.n += n;
      sum.set(label, cur);
    }
  }
  return [...sum.values()].sort((a, b) => b.n - a.n);
}

/** 最早那一笔在哪个小时。界面上写「记录自某日起」 */
export function firstAt() {
  load();
  const hs = Object.keys(book).map(Number);
  return hs.length ? Math.min(...hs) : 0;
}

export function clear() {
  book = {};
  flush();
  usageStore.set({ v: Date.now() });
}
