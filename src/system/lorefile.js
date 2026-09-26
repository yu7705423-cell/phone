// 世界书的文件：批量导入与导出。见 ARCHITECTURE 4.235
//
// 只认 txt 与 docx，外加把它们装在一起的 zip。**不做 JSON**（CLAUDE.md 第 17 条）：
// 别家的世界书 schema 不归我们管，认了它就要跟着它改。
//
// ---- 一个文件就是一本 ----
//
// 导出用我们自己的一种文本写法，导回来能原样还原每一条的设置：
//
//     # 书名
//     用途：对话
//     全局生效：否
//
//     ## 条目标题
//     关键词：甲、乙
//     常驻：否
//     启用：是
//     位置：角色前
//     深度：0
//
//     正文……
//
// 别处来的文字（一篇设定文档）也照这个读：有 `## ` 小标题就一个小标题一条，
// 没有就整篇是一条，标题取文件名。条目开头那几行设置认得出就用，认不出就当正文。
// 读进来之后在确认页上逐本定用途、全局、启用、常驻、位置，确定了才入库。
import { lorebooks } from './db/index.js';
import { readText, toDocx } from './doctext.js';
import { zip, unzip } from './zip.js';
import { purposeOf, purposePatch } from './ai/context/lorebook.js';
import { uid } from './store.js';

export const ACCEPT = '.txt,.md,.docx,.zip,text/plain,application/zip,'
  + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PURPOSE_NAME = { chat: '对话', image: '生图', voice: '语音' };
const PURPOSE_OF = { 对话: 'chat', 生图: 'image', 语音: 'voice' };
const yes = v => /^(是|开|开启|true|yes|1)$/i.test(String(v).trim());
const yn = v => (v ? '是' : '否');

// ---- 写 ----

const partName = e => (e.part === 'after' ? '角色后' : '角色前');

/** 一本书写成文本 */
function toText(book) {
  const out = [`# ${book.name || '未命名世界书'}`,
    `用途：${PURPOSE_NAME[purposeOf(book)]}`,
    `全局生效：${yn(book.global)}`];
  if (book.description) out.push(`说明：${String(book.description).replace(/\n/g, ' ')}`);
  for (const e of book.entries || []) {
    out.push('', `## ${e.comment || String(e.content || '').slice(0, 18).replace(/\n/g, ' ') || '未命名条目'}`);
    if ((e.keys || []).length) out.push(`关键词：${e.keys.join('、')}`);
    if ((e.secondaryKeys || []).length) out.push(`次要关键词：${e.secondaryKeys.join('、')}`);
    out.push(`常驻：${yn(e.constant)}`, `启用：${yn(e.enabled !== false)}`,
      `位置：${partName(e)}`, `深度：${Math.max(0, Math.round(Number(e.depth) || 0))}`);
    if (e.priority != null && e.priority !== 100) out.push(`优先级：${e.priority}`);
    if (e.probability != null && e.probability !== 100) out.push(`概率：${e.probability}`);
    out.push('', String(e.content || '').trim());
  }
  return out.join('\n') + '\n';
}

// ---- 读 ----

const SETTING = /^(关键词|次要关键词|常驻|启用|位置|深度|优先级|概率)[:：]\s*(.*)$/;
const list = v => String(v).split(/[、,，;；]/).map(x => x.trim()).filter(Boolean);

function blankEntry() {
  return { id: uid('e'), comment: '', keys: [], secondaryKeys: [], content: '',
    enabled: true, constant: false, priority: 100, order: 0,
    part: 'before', depth: 0, caseSensitive: false, probability: 100 };
}

function entryOf(title, body) {
  const e = { ...blankEntry(), comment: title.trim() };
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  let set = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].trim().match(SETTING);
    if (!m) break;
    set += 1;
    const [, k, v] = m;
    if (k === '关键词') e.keys = list(v);
    else if (k === '次要关键词') e.secondaryKeys = list(v);
    else if (k === '常驻') e.constant = yes(v);
    else if (k === '启用') e.enabled = yes(v);
    else if (k === '位置') e.part = /后/.test(v) ? 'after' : 'before';
    else if (k === '深度') e.depth = Math.max(0, Math.round(Number(v) || 0));
    else if (k === '优先级') e.priority = Number(v) || 100;
    else if (k === '概率') e.probability = Math.max(0, Math.min(100, Number(v) || 100));
  }
  e.content = lines.slice(i).join('\n').trim();
  return { entry: e, set };
}

/**
 * 一段文本读成一本书的草稿。name 是取不到 # 标题时用的名字（文件名）。
 * own 为真表示条目里带着我们自己写的设置行（导出再导回来的那种），确认页默认保留它们
 */
export function fromText(text, name = '') {
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const lines = src.split('\n');
  const draft = { name: name || '未命名世界书', purpose: 'chat', global: false, description: '', entries: [], own: false };
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const h1 = lines[i]?.match(/^#\s+(.+)$/);
  if (h1) { draft.name = h1[1].trim(); i++; }
  // 书的设置行：到第一个 ## 或第一段正文为止
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const m = t.match(/^(用途|全局生效|说明)[:：]\s*(.*)$/);
    if (!m) break;
    if (m[1] === '用途') draft.purpose = PURPOSE_OF[m[2].trim()] || 'chat';
    else if (m[1] === '全局生效') draft.global = yes(m[2]);
    else draft.description = m[2].trim();
    draft.own = true;
  }
  const rest = lines.slice(i).join('\n');
  const parts = rest.split(/^##\s+/m);
  const lead = parts.shift().trim();
  if (!parts.length) {
    if (lead) draft.entries.push({ ...blankEntry(), comment: draft.name, content: lead, constant: true });
    return draft;
  }
  if (lead) draft.entries.push({ ...blankEntry(), comment: '前言', content: lead, constant: true });
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const title = nl < 0 ? p : p.slice(0, nl);
    const { entry, set } = entryOf(title, nl < 0 ? '' : p.slice(nl + 1));
    if (set) draft.own = true;
    draft.entries.push(entry);
  }
  return draft;
}

const baseName = n => String(n || '').split('/').pop().replace(/\.(txt|md|docx)$/i, '');
const readable = n => /\.(txt|md|docx)$/i.test(n) && !/(^|\/)(__MACOSX\/|\.)/.test(n);

/**
 * 选中的文件读成草稿。zip 里的 txt、md、docx 一个一本。
 * 读不了的记进 failed，不拦别的
 */
export async function readFiles(fileList) {
  const drafts = [];
  const failed = [];
  const one = async (blob, name) => {
    try {
      const file = blob instanceof File ? blob : new File([blob], name);
      const text = await readText(file);
      if (!text.trim()) { failed.push(`${name}：没有文字`); return; }
      drafts.push({ key: uid('d'), source: name, ...fromText(text, baseName(name)) });
    } catch (err) { failed.push(`${name}：${err.message || err}`); }
  };
  for (const f of fileList || []) {
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
      try {
        const files = await unzip(f);
        for (const [name, blob] of files) if (readable(name)) await one(blob, name);
      } catch (err) { failed.push(`${f.name}：${err.message || err}`); }
    } else await one(f, f.name);
  }
  return { drafts, failed };
}

// ---- 等着确认的那一批 ----
//
// 选文件在列表页、确认在导入页，中间隔着一次导航；工具箱里生成的世界观、世界书
// 也交到同一个确认页（跨 app 不能互相 import，所以放在这里）。
let pendingBatch = { drafts: [], failed: [] };
let batchNo = 0;
export function setPending(p) {
  pendingBatch = { drafts: p?.drafts || [], failed: p?.failed || [] };
  batchNo += 1;
}
export const pending = () => pendingBatch;
// 每一批一个编号。确认页按它当 key：上一批的勾选与设置不许带到下一批
export const batchKey = () => batchNo;

/** 一段文字（生成出来的、粘贴来的）读成一本草稿，交给确认页 */
export function draftFromText(text, name = '', source = '') {
  return { key: uid('d'), source: source || name || '生成结果', ...fromText(String(text || ''), name) };
}

/**
 * 确认页上定好的草稿入库。opts 是那一本在确认页上的设置：
 *   keepOwn   保留文件里每一条自己的设置（只对 own 的书有意义）
 *   enabled / constant / part / depth   不保留时，整本每一条都照这个
 */
export function save(draft, opts = {}) {
  const entries = (draft.entries || []).map(e => (opts.keepOwn && draft.own ? { ...e, id: uid('e') } : {
    ...e, id: uid('e'),
    enabled: opts.enabled !== false,
    constant: !!opts.constant,
    part: opts.part === 'after' ? 'after' : 'before',
    depth: Math.max(0, Math.round(Number(opts.depth) || 0)),
  }));
  return lorebooks.create({
    name: String(opts.name || draft.name || '未命名世界书').trim() || '未命名世界书',
    description: draft.description || '', global: !!opts.global, entries,
    ...purposePatch(opts.purpose || draft.purpose || 'chat'),
  });
}

// ---- 导出 ----

const safe = n => String(n || '世界书').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim().slice(0, 60) || '世界书';

function uniqueNames(books, ext) {
  const seen = new Map();
  return books.map(b => {
    const base = safe(b.name);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return `${n > 1 ? `${base} (${n})` : base}.${ext}`;
  });
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

/**
 * 导出。format 为 txt 或 docx；packed 为真时装进一个 zip，否则每本一个文件依次下载。
 * 回来的是导出了几个文件
 */
export async function exportBooks(books, { format = 'txt', packed = false } = {}) {
  const list = (books || []).filter(Boolean);
  if (!list.length) throw new Error('没有选中任何世界书');
  const names = uniqueNames(list, format);
  const blobs = [];
  for (const b of list) {
    const text = toText(b);
    blobs.push(format === 'docx' ? await toDocx(text) : new Blob([text], { type: 'text/plain;charset=utf-8' }));
  }
  if (packed) {
    const z = await zip(blobs.map((blob, i) => ({ name: names[i], blob })));
    saveBlob(new Blob([z], { type: 'application/zip' }), `世界书-${new Date().toISOString().slice(0, 10)}.zip`);
    return 1;
  }
  // 一个接一个地下载。隔一小会儿，不然浏览器会把后面的当成弹窗拦掉
  for (let i = 0; i < blobs.length; i++) {
    saveBlob(blobs[i], names[i]);
    if (i < blobs.length - 1) await new Promise(r => setTimeout(r, 400));
  }
  return blobs.length;
}
