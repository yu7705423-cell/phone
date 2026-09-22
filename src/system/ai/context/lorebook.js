import { lorebooks } from '../../db/index.js';
import { takeTopWithin } from '../tokens.js';

// 世界书激活。见 ARCHITECTURE 4.4
// 扫描窗口与 B 级记忆共用,不是只看最后一条消息。
//
// 每个条目有两个位置属性：
//
//   part   'before' / 'after' —— 在角色卡**之前**还是**之后**。
//          世界观那种「先有世界再有人」的设定放前面，
//          「这个人在这个世界里的处境」放后面。
//   depth  0 就留在设定区（按 part 定位）；N ≥ 1 从设定区拿出来，
//          插进对话历史里**倒数第 N 条之前**。
//
// 深度这件事要的是「越靠近当前对话，模型越当真」。整段设定堆在最前面，
// 聊上几十轮之后它就成了远处的背景音；一条插在最后一句前面的规则，
// 模型几乎不可能忽略。所以「这一条要不要被无视」由用户自己按深度决定。

export const PARTS = ['before', 'after'];
export const partOf = e => (PARTS.includes(e?.part) ? e.part : 'before');
export const depthOf = e => Math.max(0, Math.round(Number(e?.depth) || 0));

/**
 * 「只用于生图」的那种书。见 ARCHITECTURE 4.122
 *
 * **两边互斥。** 标了这个的一律不进聊天，没标的一律不进生图提示词。
 * 一本书要是两边都进，画风描述（「柔和的侧光，胶片颗粒」）就会漏进对话，
 * 角色开口就是一股说明书味 —— 那正是要拆出这一档的原因。
 */
export const isImageBook = b => b?.forImage === true;

/** 这个角色用得上的书。`forImage` 决定取哪一半。 */
function booksFor(char, forImage) {
  const attached = new Set(char?.lorebookIds || []);
  return lorebooks.all().filter(b =>
    isImageBook(b) === forImage && (b.global || attached.has(b.id)));
}

/** 关键词命中没有。常驻的一律算命中。 */
function hits(e, text, lower) {
  if (e.constant) return true;
  const keys = (e.keys || []).filter(Boolean);
  if (!keys.length) return false;
  const match = k => (e.caseSensitive ? text : lower).includes(e.caseSensitive ? k : k.toLowerCase());
  if (!keys.some(match)) return false;
  const sec = (e.secondaryKeys || []).filter(Boolean);
  if (sec.length && !sec.some(match)) return false;
  if (e.probability != null && e.probability < 100) {
    if (Math.random() * 100 >= e.probability) return false;
  }
  return true;
}

function pick(char, scanText, forImage) {
  const text = String(scanText || '');
  const lower = text.toLowerCase();
  const entries = [];
  for (const book of booksFor(char, forImage)) {
    for (const e of book.entries || []) {
      if (!e.enabled) continue;
      entries.push({ ...e, bookName: book.name, bookId: book.id });
    }
  }
  return entries.filter(e => hits(e, text, lower)).sort(compare);
}

export function activate(char, scanText, budget) {
  return takeTopWithin(pick(char, scanText, false), budget, e => e.content || '');
}

/**
 * 生图那一份。拿**画面描述**去扫，命中的原样拼进生图提示词。
 *
 * 不设预算：生图提示词本来就短，而且这一份是用户自己写、自己关的
 * （CLAUDE.md 第 13 条）。`part` 与 `depth` 在这里没有意义 ——
 * 生图请求里没有「对话历史」可插，所以编辑页上那两项对这种书不显示。
 */
export const activateImage = (char, scanText) => pick(char, scanText, true);

// 注入顺序：先按 part（角色前在先），同一部分里深的排在浅的前面
//（深度大 = 离当前对话远），再按优先级、再按手填的序号。
export function compare(a, b) {
  return (partOf(a) === 'before' ? 0 : 1) - (partOf(b) === 'before' ? 0 : 1)
    || depthOf(b) - depthOf(a)
    || (b.priority ?? 100) - (a.priority ?? 100)
    || (a.order ?? 0) - (b.order ?? 0);
}

/**
 * 把命中的条目按「注入到哪儿」分好。
 *   system.before / system.after  留在设定区的那些
 *   depths                        Map<深度, 条目[]>，要插进对话的那些
 */
export function split(items) {
  const before = [], after = [];
  const depths = new Map();
  for (const e of items) {
    const d = depthOf(e);
    if (d === 0) { (partOf(e) === 'before' ? before : after).push(e); continue; }
    if (!depths.has(d)) depths.set(d, []);
    depths.get(d).push(e);
  }
  return { before, after, depths };
}

// 注入时的原文。条目自己写的内容，一个字不加。
export const textOf = items => items.map(e => (e.content || '').trim()).filter(Boolean).join('\n');

// 一轮只激活一次：设定区和对话里各要一份，各算各的会把带概率的条目
// 掷两次骰子，两边对不上。所以由调用方算好一次，传给两边。
export function itemsFrom(ctx) {
  if (ctx.lore) return ctx.lore;
  const { char, scanText, budgets } = ctx;
  return char ? activate(char, scanText, budgets.lorebook).items : [];
}

function buildPart(ctx, part) {
  const { before, after } = split(itemsFrom(ctx));
  const list = part === 'before' ? before : after;
  const body = textOf(list);
  return body ? `\n\n[世界设定]\n${body}` : '';
}

export const build = ctx => buildPart(ctx, 'before');
export const buildAfter = ctx => buildPart(ctx, 'after');

export const meta = { id: 'lorebook', label: '世界书（角色前）', desc: '标为「角色前」且留在设定区的条目' };
export const metaAfter = { id: 'loreAfter', label: '世界书（角色后）', desc: '标为「角色后」且留在设定区的条目' };
