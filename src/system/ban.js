import { settings } from './db/index.js';

/**
 * 不要写这些：用户自己列的禁写词。
 *
 * **默认一条都没有，内置也不会给一份。**
 * 内置一张「AI 味词表」就是替所有角色定文风，正是第 16 条禁的那件事 ——
 * 角色是什么样，由角色卡、世界书和用户自己写的模板决定。这一份从头到尾
 * 是用户的判断，代码只做两件机械的事：把它送到模型眼前，再检查它听没听。
 *
 * 两道都不完美，所以两道都要：
 *
 *   **送过去**  写进 prompt 的收尾段（贴着输出，见 engine.buildChatSystem）。
 *               否定式指令本来就不牢靠，而且把那句话摆进上下文还会抬高它的
 *               出现概率 —— 各家指引都偏好正面陈述，可「不要写空气中弥漫着」
 *               没有正面的写法。所以它只是第一道。
 *   **查回来**  回复落地时本地扫一遍，命中的在气泡下方标出来。这一道是确定的：
 *               它不依赖模型听不听话。要不要为此重掷，由用户自己定（默认不重）。
 */

/** 通配符。八股本来就是一个骨架配不同的填空，只认死字面量会漏掉一大半。 */
export const WILD = '*';

// 一个通配符最多跨多少字。跨太远就不是同一句话了，那是误伤
const GAP = 12;

/** 现在列着哪几条。空白行与重复的都已去掉。 */
export function list() {
  const raw = settings.get().banPhrases;
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n/);
  const out = [];
  for (const x of arr) {
    const t = String(x || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 列表存回去。界面上是一个多行输入框，一行一条。 */
export const setList = text => settings.set({
  banPhrases: String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
});

export const on = () => list().length > 0;

const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 一条词条编译成正则。认不出来的返回 null。
 *
 * 词条里的空白一律当「可有可无」：从聊天记录里复制出来的词常常多一个空格，
 * 差这一个空格就不认，用户只会觉得这个功能时灵时不灵。
 */
export function reOf(phrase) {
  const body = String(phrase || '').trim().split(WILD)
    .map(seg => esc(seg).replace(/\s+/g, '\\s*'))
    .join(`[^\\n]{0,${GAP}}`);
  if (!body) return null;
  try { return new RegExp(body, 'iu'); } catch { return null; }
}

/**
 * 这段话踩了哪几条。回来的是**词条原文**，不是匹配到的那几个字 ——
 * 气泡下面要显示的是「你禁的是哪一条」，不是「它写了什么」。
 */
export function scan(text, phrases = list()) {
  const t = String(text || '');
  if (!t.trim() || !phrases.length) return [];
  const hit = [];
  for (const p of phrases) {
    const re = reOf(p);
    if (re && re.test(t)) hit.push(p);
  }
  return hit;
}

/**
 * 送进 prompt 的那几行。通配符换成省略号 —— 星号是本地匹配的写法，
 * model 不认识它，照抄过去只会被当成字面量。
 */
export const promptLines = () => list()
  .map(p => '- ' + p.split(WILD).join('…'))
  .join('\n');

/**
 * 命中之后自动重掷几次。**默认 0**：每一次都是一整次接口调用（第 15 条），
 * 登记在 cost.js 的 EXTRA_CALLS 里。不设上限（第 13 条），账在界面上写清楚。
 */
export const rerollMax = () =>
  Math.max(0, Math.round(Number(settings.get().banReroll) || 0));
