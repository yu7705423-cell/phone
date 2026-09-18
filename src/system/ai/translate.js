import { runJSONWithPreset } from './engine.js';
import { template, fillTemplate } from './templates.js';
import { translateConfig, translateMode, translateFilled } from './services.js';

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

/** 设置页的连接测试。只翻一句，不动别的。 */
export async function test(lang) {
  const out = await run(['今天天气很好，适合出门走走。'], { lang: lang || 'English' });
  const text = (out[0] || '').trim();
  if (!text) throw new Error('接口没有返回译文');
  return text;
}
