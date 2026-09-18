import { settings } from '../db/index.js';
import { createStore } from '../store.js';
import { estimate } from './tokens.js';

// 每一轮到底发出去了什么。
//
// 排查 prompt 只有两条路：对着代码数，或者把真正发出去的东西摆出来。
// 前者数不清 —— 注入块有九个，世界书按深度插，能力目录按用没用过给，
// 光看代码永远说不准这一轮实际长什么样。
//
// **这是调试用的，默认关着。** 关着的时候一条都不记，也不占内存。
// 平时用不该知道有这东西，所以入口收在「存储与数据」的最下面。

const KEY_ON = 'traceOn';
const KEY_MAX = 'traceMax';

export const traceStore = createStore({ v: 0 });

// 只在内存里。刷新就没了 —— 它是「刚才那一轮发了什么」，不是日志档案，
// 落库还要额外的清理与配额，不值当。
let rows = [];
let seq = 0;

export const isOn = () => settings.get()[KEY_ON] === true;
export function setOn(on) {
  settings.set({ [KEY_ON]: !!on });
  if (!on) clear();
  else bump();
}

// 留几条。填 0 表示不限（CLAUDE.md 第 13 条）。
export const maxOf = () => {
  const n = Math.round(Number(settings.get()[KEY_MAX]) ?? 20);
  return Number.isFinite(n) && n >= 0 ? n : 20;
};
export const setMax = n => settings.set({ [KEY_MAX]: Math.max(0, Math.round(Number(n) || 0)) });

const bump = () => traceStore.set({ v: Date.now() });

export function clear() { rows = []; seq = 0; bump(); }
export const list = () => rows;
export const get = id => rows.find(r => r.id === id) || null;

/**
 * 记一次请求。返回一个句柄，请求结束时调 done / fail 把结果补上。
 * 没开就返回一个空壳，调用方不必到处写 if。
 */
const NOOP = { done() {}, fail() {} };

export function begin({ taskId, preset, model, system, messages: msgs, stream }) {
  if (!isOn()) return NOOP;
  const row = {
    id: `t${++seq}`,
    at: Date.now(),
    taskId: taskId || '未命名',
    preset: preset || '',
    model: model || '',
    stream: !!stream,
    system: String(system || ''),
    messages: (msgs || []).map(m => ({
      role: m.role,
      content: String(m.content || ''),
      // 图片只记「有一张」，不把 dataURL 抄进来：一张就几十上百 KB
      image: m.image ? (m.image.mediaType || '图片') : null,
    })),
    tokens: estimate(String(system || '')) + (msgs || []).reduce((n, m) => n + estimate(String(m.content || '')), 0),
    reply: '', error: '', ms: 0,
  };
  rows.unshift(row);
  const cap = maxOf();
  if (cap && rows.length > cap) rows.length = cap;
  bump();

  const start = Date.now();
  return {
    done(text) { row.reply = String(text || ''); row.ms = Date.now() - start; bump(); },
    fail(err) { row.error = String(err?.message || err || '失败'); row.ms = Date.now() - start; bump(); },
  };
}

/** 整条记录导出成文本，供复制。 */
export function asText(row) {
  if (!row) return '';
  const head = [
    `时间：${new Date(row.at).toLocaleString('zh-CN', { hour12: false })}`,
    `任务：${row.taskId}`,
    `接口：${row.preset || '未命名'} · ${row.model || '未知模型'}`,
    `耗时：${row.ms} 毫秒 · 约 ${row.tokens} tokens`,
  ].join('\n');
  const body = row.messages
    .map((m, i) => `--- 消息 ${i + 1} · ${m.role}${m.image ? ' · 含图片' : ''} ---\n${m.content}`)
    .join('\n\n');
  return `${head}\n\n=== system ===\n${row.system}\n\n=== 消息 ===\n${body}`
    + `\n\n=== 回复 ===\n${row.error ? '（失败）' + row.error : row.reply}`;
}
