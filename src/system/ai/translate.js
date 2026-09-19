import { runJSONWithPreset } from './engine.js';
import { template, fillTemplate } from './templates.js';
import { translateConfig, translateMode, translateFilled } from './services.js';
import { settings } from '../db/index.js';

// 单独的翻译接口。
//
// 为什么要单独一套：从前译文是让聊天模型「回复的时候顺带给一行」。
// 那条路上，**人设、记忆、整段对话历史全在它眼前**，于是它不是在翻译，
// 是在用角色的语气重写一遍 —— 要么口语化得不像那句话，要么带着中文的骨架
// 把外语写成中文的样子。两种毛病来源是同一个：翻译这件事被塞进了演戏的语境里。
//
// 所以这里**只送两样东西**：要翻的那几行，和翻译规则。
// 人设、记忆、角色名、对话历史、世界书，一个字都不送。
// 这不是省 token，是这套接口能翻得准的前提 —— 下面那个 payload() 是全部入口，
// 加参数的时候先想清楚它要不要进 prompt。
//
// 没配、或者选的是「跟着回复一起给出」，就回落到 skeleton.translate 那条老路，
// 由聊天模型在回复里写 [译文：…]。翻译开着却一条译文都没有，比慢一点糟得多。

export const mode = translateMode;
export const filled = translateFilled;
export const ready = () => translateMode() === 'api';

/** 这套接口在 engine 那边长什么样。id 固定，队列按它去重。 */
function preset() {
  const t = translateConfig();
  return {
    id: 'translate', name: '翻译接口',
    provider: t.provider || 'openai',
    baseUrl: t.baseUrl, apiKey: t.apiKey, model: t.model,
  };
}

/**
 * 交给模型的全部内容。**出口只有这一处。**
 * lang 是译成什么语言，extra 是这段对话额外填的翻译要求，texts 是要翻的原文。
 * 除此之外没有第四样东西。
 */
export function payload(texts, { lang, extra } = {}) {
  const rules = String(extra || '').trim();
  const system = fillTemplate(template('task.translate'), {
    lang: lang || '中文',
    extra: rules ? `\n## Additional requirements for this conversation\n${rules}\n` : '',
  });
  const user = texts.map((t, i) => `${i + 1}. ${String(t).replace(/\n/g, ' ')}`).join('\n');
  return { system, user };
}

/**
 * 翻一批。回来的数组与传入的一一对应；某一条没翻出来就是空字符串，
 * 不拿原文顶上去 —— 原文当译文比没有译文更难发现出了问题。
 */
export async function run(texts, opts = {}) {
  const list = (texts || []).map(t => String(t || '').trim());
  if (!list.length) return [];
  if (!ready()) throw new Error('尚未配置翻译接口');

  const { system, user } = payload(list, opts);
  const r = await runJSONWithPreset(preset(), {
    system, user, taskId: 'translate.lines',
    key: `translate:${Date.now()}`,
    maxTokens: Math.max(600, list.join('').length * 4),
  });

  const rows = Array.isArray(r?.lines) ? r.lines : [];
  return list.map((_, i) => String(rows[i] ?? '').trim());
}

// ---- 行内译文：原文和译文写在同一行 ----
//
// 内置骨架让模型把译文单独写成一行 `[译文：…]`，reply.js 按那个形状剥。
// 但**用自己模板的人不会照着那个写**：有人要「原文（译文）」，有人要
// 「原文｜译文」，各人一个样。那些行现在整行当正文渲染出去，译文收不进
// 气泡里，看着就是翻译没生效。
//
// 所以让用户自己描述那个形状，一行一个，写多少条都行（第 13 条不设上限）。
// **默认一条都没有** —— 这套拆分是有代价的：一句正常的「他笑了（大概吧）」
// 也符合「原文（译文）」的样子，开着就会被拆开。只有自己知道模板长什么样的人
// 才该开它，所以不替任何人默认打开。

/** 模板里这两个记号代表原文与译文。其余字符原样匹配。 */
export const SLOT_SRC = '{原文}';
export const SLOT_OUT = '{译文}';

export const FORMAT_PRESETS = [
  `${SLOT_SRC}（${SLOT_OUT}）`,
  `${SLOT_SRC}(${SLOT_OUT})`,
  `${SLOT_SRC}｜${SLOT_OUT}`,
  `${SLOT_SRC} | ${SLOT_OUT}`,
  `${SLOT_SRC} / ${SLOT_OUT}`,
  `${SLOT_SRC}【${SLOT_OUT}】`,
];
// 预设只是常见的那几种，按一下填进去省得手打。**不是上限** ——
// 任何形状都可以自己写，包括用破折号分隔的那种（那一条没做成预设：
// check-prompt-tone 全库扫破折号插入语，为一条预设去给检查开后门不值）。

const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 一条模板编译成正则。两个记号各要且只要出现一次，否则不认这条。
 *
 * 两个捕获组都用贪婪的 `(.+)`：这样「他笑了（大概吧）（He smiled）」会拆成
 * 原文「他笑了（大概吧）」、译文「He smiled」—— 最后那一个括号才是译文，
 * 和人读到的一样。
 */
export function compileFormat(tpl) {
  const t = String(tpl || '').trim();
  if (!t) return null;
  const parts = t.split(SLOT_SRC);
  if (parts.length !== 2) return null;
  const [head, rest] = parts;
  const tail = rest.split(SLOT_OUT);
  if (tail.length !== 2) return null;
  const [mid, end] = tail;
  try {
    return new RegExp(`^${esc(head)}(.+)${esc(mid)}(.+)${esc(end)}$`);
  } catch { return null; }
}

/** 用户配的那几条，一行一个。空行与写坏的那几条自动跳过。 */
export const formats = () => String(settings.get().translateFormats || '')
  .split('\n').map(x => x.trim()).filter(Boolean);

export const compiled = () => formats().map(compileFormat).filter(Boolean);

/**
 * 这一行是不是「原文 + 译文」写在一起的。是就拆开，不是就返回 null。
 *
 * 一条都没配时直接返回 null —— 不猜，不拿括号当默认规则。
 */
export function splitInline(line, list = compiled()) {
  const t = String(line || '').trim();
  if (!t || !list.length) return null;
  for (const re of list) {
    const m = t.match(re);
    if (!m) continue;
    const text = String(m[1] || '').trim();
    const translation = String(m[2] || '').trim();
    // 两边都得有东西。空的那一半说明这一行只是碰巧长得像
    if (text && translation) return { text, translation };
  }
  return null;
}

/** 设置页的连接测试。只翻一句，不动别的。 */
export async function test(lang) {
  const out = await run(['今天天气很好，适合出门走走。'], { lang: lang || 'English' });
  const text = (out[0] || '').trim();
  if (!text) throw new Error('接口没有返回译文');
  return text;
}
