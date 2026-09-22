import { settings, messagesOf, characters } from '../db/index.js';
import { template, fillTemplate } from './templates.js';
import { runTextTask } from './engine.js';
import { styleAsk } from './imageprompt.js';

/**
 * 把角色随手写的那一句，改写成一份真正能用的生成提示词。
 *
 * ---- 它解决的是哪个毛病 ----
 *
 * 角色在回复里写 `[图片：乃木喵和调色盘]`，这句话在对话里说得通，
 * 交给生图接口就什么都不是 —— **那个模型收不到这段对话**，
 * 「乃木喵」对它来说只是三个字。上游因此回过 400：
 * 「请说明需要生成的具体对象」。语音同理，一句话该用什么语气，
 * 只看那行字是读不出来的；视频更甚，它还要知道什么在动、怎么动。
 *
 * 所以这一步做的是：**把只有这段对话里成立的说法，翻成一份自带全部信息的描述。**
 *
 * ---- 为什么默认关着 ----
 *
 * 它是**实打实的第二次接口调用**（CLAUDE.md 第 15 条）：角色发一张图，
 * 就先写一次提示词、再生成一次。所以三样各一个开关，一律默认关着，
 * 并登记在 `cost.js` 的 `EXTRA_CALLS` 里，好让「用量与上限」那一页把账摆出来。
 *
 * 走的是**副用接口**（第 15 条那张表：只有对话回复与通话走主用）。
 * 写提示词慢一点没人会发现，不该和聊天抢同一套通常更贵的接口。
 *
 * ---- 写不出来就用原话 ----
 *
 * 这一步是锦上添花。它超时、报错、回一句空话，都只是退回角色本来写的那句，
 * **不让整张图发不出去**。为了改写而把生成断掉，比不改写更糟。
 *
 * ---- 只在聊天那条路上 ----
 *
 * 朋友圈配图与角色自拍的描述本来就是模型照一份任务规格写出来的，
 * 不是随手一句，没有这个毛病。这里只接聊天里那三个标记。
 */

export const imageOn = () => settings.get().writeImagePrompt === true;
export const videoOn = () => settings.get().writeVideoPrompt === true;
export const voiceOn = () => settings.get().writeVoicePrompt === true;

// 拿给改写用的上下文。**「乃木喵是什么」的答案就在这里面** ——
// 没有它，这一步只是把一句短话换成另一句短话，那个 400 照样会回来。
const CONTEXT_MSGS = 12;
const PERSONA_MAX = 600;

function contextOf(chatId, char) {
  const bits = [];
  const c = char || null;
  if (c?.name) bits.push(`[角色]\n${c.name}`);
  const persona = String(c?.persona || c?.description || '').trim();
  if (persona) bits.push(`[角色设定]\n${persona.slice(0, PERSONA_MAX)}`);
  if (chatId) {
    const recent = messagesOf(chatId).slice(-CONTEXT_MSGS)
      .map(m => `${m.role === 'user' ? '对方' : (characters.get(m.authorId)?.name || '角色')}：${m.content || ''}`)
      .join('\n').trim();
    if (recent) bits.push(`[最近的对话]\n${recent}`);
  }
  return bits.join('\n\n');
}

async function write(taskId, tplId, vars, key) {
  const out = await runTextTask(taskId, {
    system: fillTemplate(template(tplId), vars),
    user: 'Write it as instructed. Output the result only.',
    key, maxTokens: 500,
  });
  // 模型爱加一层引号或者「好的，这是……」。只取最后一段实体内容
  return String(out || '')
    .replace(/^\s*(?:```[a-z]*\s*)?/i, '').replace(/```\s*$/, '')
    .trim().replace(/^["'「『]|["'」』]$/g, '').trim();
}

/** 生图那一句。回来的仍然是一段**画面描述**，后面照旧接世界书与全局提示词。 */
export async function forImage(desc, { chatId, char, key } = {}) {
  const raw = String(desc || '').trim();
  if (!imageOn() || !raw) return raw;
  try {
    const out = await write('image.prompt', 'task.image-prompt',
      { desc: raw, context: contextOf(chatId, char), ask: styleAsk() }, key);
    return out || raw;
  } catch { return raw; }
}

/** 生成视频那一句。比图片多一样：什么在动、怎么动。 */
export async function forVideo(desc, { chatId, char, key } = {}) {
  const raw = String(desc || '').trim();
  if (!videoOn() || !raw) return raw;
  try {
    const out = await write('video.prompt', 'task.video-prompt',
      { desc: raw, context: contextOf(chatId, char), ask: styleAsk() }, key);
    return out || raw;
  } catch { return raw; }
}

/**
 * 这一句该用什么语气读。
 *
 * 和上面两个不一样：**它不改那行字**，只另外给一句语气说明。
 * 回来的东西交给语音那一层 —— MiniMax 只收固定的几个情绪词
 *（`voice.js` 的 `moodOf` 负责认），OpenAI 兼容那一档收的是自由文本。
 * 所以这里让它写得短，认得出就当情绪词用，认不出就当自由文本送过去。
 */
export async function forVoice(text, { chatId, char, key } = {}) {
  const raw = String(text || '').trim();
  if (!voiceOn() || !raw) return '';
  try {
    return await write('voice.prompt', 'task.voice-prompt',
      { line: raw, context: contextOf(chatId, char) }, key);
  } catch { return ''; }
}
