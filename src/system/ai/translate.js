import { runJSONWithPreset, runJSONTask } from './engine.js';
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

// ---- 已经是那种语言了就不翻 ----
//
// 翻译开着、目标是中文，而这一句本来就是中文（用户的模板里写了「视频通话说中文」，
// 或者角色就是说中文的）：从前照翻不误，字幕底下再出一行一模一样的中文 ——
// 中译中，还白花一次接口。
//
// 只认几种能从字形上看出来的：中文、日文、韩文、英文。目标语言写的是别的
// （法语、西班牙语……），看不出来就照旧翻，不替人省这一次。
const count = (t, re) => (String(t).match(re) || []).length;
const SAME = [
  { lang: /中文|汉语|漢語|简体|简中|繁体|繁體|繁中|chinese|^zh/i,
    is: t => { const han = count(t, /[\u4e00-\u9fff]/g);
      return han > 0 && !count(t, /[\u3040-\u30ff\uac00-\ud7af]/g) && han * 2 >= count(t, /[A-Za-z]/g); } },
  { lang: /日[语語文本]|japanese|^ja/i, is: t => count(t, /[\u3040-\u30ff]/g) > 0 },
  { lang: /韩|韓|朝鲜|korean|^ko/i, is: t => count(t, /[\uac00-\ud7af]/g) > 0 },
  { lang: /英|english|^en/i,
    is: t => count(t, /[A-Za-z]/g) > 0 && !count(t, /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/g) },
];

/** 这句话是不是已经是 lang 那种语言了。看不出来一律当作不是 */
export function alreadyIn(text, lang) {
  const t = String(text || '').trim();
  const l = String(lang || '').trim();
  if (!t || !l) return false;
  const rule = SAME.find(r => r.lang.test(l));
  return !!rule && rule.is(t);
}

/** 译文和原文是同一句（模型照抄回来的）：不算译文 */
export const sameText = (a, b) => String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '');
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
 * 把模型回来的东西理成一个数组。
 *
 * 要的是 `{"lines":[…]}`，但真跑起来常见另外三种：整个就是一个数组、
 * 换了个键名、或者**整批挤在一条里用换行分开**。这三种都还原得回来，
 * 还原不了才算没翻出来 —— 少一行译文，用户看到的就是「又掉翻译了」。
 *
 * 顺带把「1. 」这种序号去掉：送过去的原文是编了号的，模型常照抄回来。
 */
function rowsOf(out, want) {
  let rows = Array.isArray(out) ? out
    : Array.isArray(out?.lines) ? out.lines
      : Array.isArray(out?.translations) ? out.translations
        : Array.isArray(out?.output) ? out.output : [];
  if (rows.length === 1 && want > 1 && /\n/.test(String(rows[0]))) {
    rows = String(rows[0]).split('\n').map(x => x.trim()).filter(Boolean);
  }
  return rows.map(x => String(x ?? '').trim().replace(/^\d+\s*[.、)）]\s*/, ''));
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

  const rows = rowsOf(r, list.length);
  return list.map((_, i) => String(rows[i] ?? '').trim());
}

/**
 * 翻一批，哪套接口都行。配了单独的翻译接口就走它，没配就走副用。
 *
 * **通话走这一条。** 普通聊天里「随回复给出」那一档是让模型在台词后面顺手
 * 写一行 `[译文：…]`，不另花钱；可通话里那一行会被**原样念出来**、原样混进
 * 字幕，而且 `skeleton.call` 明文禁止一切方括号标记 —— 两句话在同一份提示词里
 * 打架。所以通话一律另翻一道：台词只管说，翻译归翻译。
 *
 * 走副用时用的是**同一份** `payload()`：只送要翻的那几行和翻译规则，
 * 人设、记忆、对话一个字都不送（本文件开头那一段的理由在这里一样成立）。
 */
export async function runAny(texts, opts = {}) {
  const list = (texts || []).map(t => String(t || '').trim());
  if (!list.length) return [];
  if (ready()) return run(list, opts);
  const { system, user } = payload(list, opts);
  const r = await runJSONTask('translate.lines', {
    system, user,
    key: opts.key || `translate-any:${Date.now()}`,
    maxTokens: Math.max(600, list.join('').length * 4),
  });
  const rows = rowsOf(r, list.length);
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
//
// ---- 两类形状 ----
//
// **同一行**：模板里两个记号都有，例如 `{原文}（{译文}）`。整行拆成两半。
//
// **各占一行**：模板里只有 `{译文}`，例如 `（{译文}）`。这一整行都是译文，
// 挂到上面那一条上。说日语的角色常常这么写：
//
//     写真の日付がバラバラなんだよ
//     （照片的日期全是乱的）
//
// 内置骨架那条 `[译文：…]` 是带标签的，上面这种没有标签，所以要另外描述。
// 这一类比同一行那类更容易误伤 —— 「（她笑了笑）」这种整行的动作描写
// 长得一模一样。界面上写清楚了。

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
  `（${SLOT_OUT}）`,
  `(${SLOT_OUT})`,
];
// 预设只是常见的那几种，按一下填进去省得手打。**不是上限** ——
// 任何形状都可以自己写，包括用破折号分隔的那种（那一条没做成预设：
// check-prompt-tone 全库扫破折号插入语，为一条预设去给检查开后门不值）。

const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 一条模板编译成 { kind, re }。认不出来的返回 null。
 *
 *   pair  两个记号都有，整行拆成原文与译文
 *   line  只有 {译文}，整行都是译文，挂到上面那一条上
 *
 * 只有 {原文} 的不认：那等于「一整行都是原文」，也就是什么都没说。
 *
 * 捕获组都用贪婪的 `(.+)`：这样「他笑了（大概吧）（He smiled）」会拆成
 * 原文「他笑了（大概吧）」、译文「He smiled」—— 最后那一个括号才是译文，
 * 和人读到的一样。
 */
export function compileFormat(tpl) {
  const t = String(tpl || '').trim();
  if (!t) return null;
  const hasSrc = t.split(SLOT_SRC).length === 2;
  const outParts = t.split(SLOT_OUT);
  if (outParts.length !== 2) return null;          // {译文} 必须恰好一个

  try {
    if (!hasSrc) {
      if (t.includes(SLOT_SRC)) return null;       // {原文} 出现了但不止一次
      const [head, end] = outParts;
      return { kind: 'line', re: new RegExp(`^${esc(head)}(.+)${esc(end)}$`) };
    }
    const [head, rest] = t.split(SLOT_SRC);
    const tail = rest.split(SLOT_OUT);
    if (tail.length !== 2) return null;            // {译文} 在 {原文} 前面
    const [mid, end] = tail;
    return { kind: 'pair', re: new RegExp(`^${esc(head)}(.+)${esc(mid)}(.+)${esc(end)}$`) };
  } catch { return null; }
}

/** 用户配的那几条，一行一个。空行与写坏的那几条自动跳过。 */
export const formats = () => String(settings.get().translateFormats || '')
  .split('\n').map(x => x.trim()).filter(Boolean);

/** 编译好的两类。整轮回复编译一次，不要每行都重来。 */
export function compiled() {
  const all = formats().map(compileFormat).filter(Boolean);
  return {
    pairs: all.filter(x => x.kind === 'pair').map(x => x.re),
    lines: all.filter(x => x.kind === 'line').map(x => x.re),
  };
}

/**
 * 这一行是不是「原文 + 译文」写在一起的。是就拆开，不是就返回 null。
 *
 * 一条都没配时直接返回 null —— 不猜，不拿括号当默认规则。
 */
export function splitInline(line, forms = compiled()) {
  const t = String(line || '').trim();
  const list = forms?.pairs || [];
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

/**
 * 这一整行是不是一句译文（没有标签的那种，例如 `（照片的日期全是乱的）`）。
 * 是就返回译文正文，挂到上面那一条上；不是就返回 null。
 */
export function transLine(line, forms = compiled()) {
  const t = String(line || '').trim();
  const list = forms?.lines || [];
  if (!t || !list.length) return null;
  for (const re of list) {
    const m = t.match(re);
    const got = m && String(m[1] || '').trim();
    if (got) return got;
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
