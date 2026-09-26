import { works, chapters, beats } from './db/index.js';

// 长篇的大纲（ARCHITECTURE 4.263）。分三层：
//
//   总纲   主线、暗线、结局、关键反转、人物弧光      开书时一次请求（和卷纲一起）
//   卷纲   每卷的目标、起止章、这一卷揭晓什么
//   章纲   每章一行                                  按卷补：写到哪一卷生成哪一卷
//
// 三档：可见 / 隐藏 / 无。隐藏只是界面上不显示（悬疑灵异提前揭晓就没意思），写作时照样注入；
// 「揭晓到目前为止」只露已经写到的章。无大纲就自由创作，每章只带前情。

export const VISIBLE = 'visible';
export const HIDDEN = 'hidden';
export const NONE = 'none';
export const MODES = [
  { id: VISIBLE, label: '可见', desc: '生成后可以查看和修改' },
  { id: HIDDEN, label: '隐藏', desc: '生成后存着、写作时使用，但不显示。可随时揭晓' },
  { id: NONE, label: '无大纲', desc: '自由创作，每章只带前情' },
];

export const blankOutline = (mode = NONE) => ({
  mode: MODES.some(m => m.id === mode) ? mode : NONE,
  master: null, volumes: [], chapters: {}, revealed: 'none', drift: false, madeAt: 0,
});

const str = v => String(v || '').trim();
const num = (v, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };

/** 读出一份干净的大纲：坏值一律补齐 */
export function outlineOf(w) {
  const o = w?.outline && typeof w.outline === 'object' ? w.outline : {};
  const base = blankOutline(o.mode);
  const master = o.master && typeof o.master === 'object' ? {
    mainline: str(o.master.mainline), subline: str(o.master.subline), ending: str(o.master.ending),
    twists: Array.isArray(o.master.twists) ? o.master.twists.map(str).filter(Boolean) : [],
    arcs: Array.isArray(o.master.arcs) ? o.master.arcs.map(str).filter(Boolean) : [],
  } : null;
  const volumes = (Array.isArray(o.volumes) ? o.volumes : []).map((v, i) => ({
    no: num(v.no, i + 1), title: str(v.title), goal: str(v.goal), from: num(v.from, 1), to: num(v.to, 1), reveal: str(v.reveal),
  })).filter(v => v.to >= v.from);
  const chs = {};
  Object.entries(o.chapters || {}).forEach(([k, list]) => {
    if (!Array.isArray(list)) return;
    chs[k] = list.map(c => ({ no: num(c.no), title: str(c.title), line: str(c.line) })).filter(c => c.no > 0);
  });
  return { ...base, master, volumes, chapters: chs,
    revealed: ['none', 'written', 'all'].includes(o.revealed) ? o.revealed : 'none',
    drift: o.drift === true, madeAt: num(o.madeAt) };
}

export const hasOutline = w => { const o = outlineOf(w); return o.mode !== NONE && !!o.master; };

export function setOutline(workId, patch) {
  const w = works.get(workId);
  if (!w) return null;
  return works.update(workId, { outline: { ...outlineOf(w), ...patch }, updatedAt: Date.now() });
}

/** 模型给回来的总纲与卷纲写进去。章数少的那种把章纲一并带来 */
export function applyOutline(workId, made) {
  const volumes = (made?.volumes || []).map((v, i) => ({ ...v, no: num(v.no, i + 1) }));
  const chs = {};
  volumes.forEach(v => { if (Array.isArray(v.chapters) && v.chapters.length) chs[v.no] = v.chapters; });
  return setOutline(workId, { master: made?.master || null, volumes: volumes.map(({ chapters: _c, ...v }) => v), chapters: chs, drift: false, madeAt: Date.now() });
}

export function applyVolume(workId, volNo, list) {
  const o = outlineOf(works.get(workId));
  return setOutline(workId, { chapters: { ...o.chapters, [volNo]: list || [] } });
}

/** 第 no 章落在哪一卷 */
export function volumeOf(w, no) {
  return outlineOf(w).volumes.find(v => no >= v.from && no <= v.to) || null;
}

/** 第 no 章的章纲那一行 */
export function lineOf(w, no) {
  const o = outlineOf(w);
  const v = volumeOf(w, no);
  const list = v ? (o.chapters[v.no] || []) : Object.values(o.chapters).flat();
  return list.find(c => c.no === no) || null;
}

/** 写到这一卷时章纲还没补：给界面与写章前的提醒用 */
export function volumeMissing(w, no) {
  const o = outlineOf(w);
  const v = volumeOf(w, no);
  return v && !(o.chapters[v.no] || []).length ? v : null;
}

/** 写了几章、预计几章 */
export function progressOf(w) {
  const list = chapters.byIndex(w.id);
  const written = list.filter(c => beats.byIndex(c.id).some(b => b.role !== 'director' && str(b.text))).length;
  const total = num(w?.length?.chapters) || 0;
  return { written, started: list.length, total };
}

/** 总纲写成几行（给提示词与界面共用；不替角色作判断，只陈述） */
export function masterLines(master) {
  if (!master) return [];
  const out = [];
  if (master.mainline) out.push(`主线：${master.mainline}`);
  if (master.subline) out.push(`暗线：${master.subline}`);
  if (master.ending) out.push(`结局：${master.ending}`);
  if (master.twists?.length) out.push(`关键转折：${master.twists.join('；')}`);
  if (master.arcs?.length) out.push(`人物弧光：${master.arcs.join('；')}`);
  return out;
}

/**
 * 写这一章时带进提示词的那一块。隐藏大纲照样带 —— 隐藏的是界面，不是模型。
 * 只给事实：总纲、这一卷的目标、这一章那一行、进度。
 */
export function promptLines(w, chapter) {
  const o = outlineOf(w);
  const lines = [];
  const p = progressOf(w);
  const no = num(chapter?.no, 0);
  if (p.total) lines.push(`Progress: chapter ${no} of ${p.total} planned (${Math.round((no / p.total) * 100)}%).`);
  if (o.mode === NONE || !o.master) return lines;
  lines.push(...masterLines(o.master));
  const v = volumeOf(w, no);
  if (v) lines.push(`当前卷：第 ${v.no} 卷${v.title ? `　${v.title}` : ''}（第 ${v.from} 到 ${v.to} 章）：${v.goal}${v.reveal ? `；本卷揭晓：${v.reveal}` : ''}`);
  const line = lineOf(w, no);
  if (line) lines.push(`本章：${line.title ? `${line.title}　` : ''}${line.line}`);
  if (chapter?.plan) lines.push(`本章走向（已选定）：${str(chapter.plan)}`);
  if (o.drift) lines.push('The story has left the outline; the chosen direction takes precedence where they differ.');
  return lines;
}

/** 隐藏大纲时界面上能看的那一部分：none 什么都不给，written 只给写到的章，all 全给 */
export function visibleChapters(w) {
  const o = outlineOf(w);
  if (o.mode === VISIBLE || o.revealed === 'all') return null;   // null = 不限
  if (o.revealed === 'written') return progressOf(w).started;
  return 0;
}

