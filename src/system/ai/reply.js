import { messages, chats, characters, images, files, settings } from '../db/index.js';
import { uid } from '../store.js';
import * as imageSvc from './image.js';
import * as voiceSvc from './voice.js';
import { isImageReady } from './image.js';
import { isVoiceReady } from './voice.js';

// 角色回复里可以带这几种标记，由模型自己决定什么时候用。
// 中英文冒号都认，方括号也认全角。
const MARK = /[[【]\s*(图片|照片|image|pic|语音|voice|audio)\s*[:：]\s*([^\]】]+)[\]】]/gi;

const IMAGE_KINDS = new Set(['图片', '照片', 'image', 'pic']);

// 引用单独成行，挂在它下面那一条上，不自己占一个气泡。
const QUOTE_LINE = /^[[【(（]?\s*(?:引用|回复|quote)\s*[:：]\s*([^\n\]】)）]+)[\]】)）]?\s*$/i;

// 时间行同理。让模型自己写一遍当地时间，是目前最靠谱的时间感知 ——
// 写过一遍才算真看见。但它是给模型自己定位用的，不该显示给用户，
// 所以这里剥掉，只把内容记在消息上，回头再塞回上下文（见 engine.buildHistory）。
const STAMP_LINE = /^[[【(（]?\s*(?:时间|time)\s*[:：]\s*([^\n\]】)）]+)[\]】)）]?\s*$/i;

// 引用块只留一小段，长了在气泡上顶掉正文
export function snippet(text, max = 40) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// 把一整段回复拆成按顺序排列的若干条。空行分段，标记单独成条。
export function splitReply(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const parts = [];
  let last = 0;
  // 读到的标记行先记着，挂到紧随其后的那一条上
  let pendingQuote = null;
  let pendingStamp = null;

  const push = part => {
    if (pendingQuote) { part.quote = pendingQuote; pendingQuote = null; }
    if (pendingStamp) { part.stamp = pendingStamp; pendingStamp = null; }
    parts.push(part);
  };

  const pushText = chunk => {
    chunk.split(/\n\s*\n/).forEach(seg => {
      let t = seg.trim();
      if (!t) return;
      // 开头可能连着好几行标记（时间、引用），一行一行剥干净
      for (;;) {
        const lines = t.split('\n');
        const q = lines[0].match(QUOTE_LINE);
        const st = q ? null : lines[0].match(STAMP_LINE);
        if (!q && !st) break;
        if (q) pendingQuote = q[1].trim();
        else pendingStamp = st[1].trim();
        t = lines.slice(1).join('\n').trim();
        if (!t) break;
      }
      if (t) push({ type: 'text', text: t });
    });
  };

  MARK.lastIndex = 0;
  let m;
  while ((m = MARK.exec(text))) {
    pushText(text.slice(last, m.index));
    const kind = m[1].toLowerCase();
    const body = m[2].trim();
    if (body) {
      push(IMAGE_KINDS.has(kind)
        ? { type: 'image', prompt: body }
        : { type: 'voice', text: body });
    }
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return parts;
}

// 模型引用的是原话里的一小段，拿它回头去最近的消息里认领出处。
// 认不出来也不丢：原样存成 quoteText，气泡照样显示，只是点不动。
export function resolveQuote(chatId, text) {
  const q = String(text || '').replace(/\s+/g, '').trim();
  if (!q) return null;
  const recent = messages
    .where(m => m.chatId === chatId && m.content)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 40);
  for (const m of recent) {
    const nm = String(m.content).replace(/\s+/g, '');
    if (nm && (nm.includes(q) || q.includes(nm))) return m;
  }
  return null;
}

// 引用字段统一在这里拼。存一份快照，原消息被删了也还看得见引的是什么。
export function quoteFields(chatId, quote) {
  const q = String(quote || '').trim();
  if (!q) return {};
  const src = resolveQuote(chatId, q);
  return src
    ? { quoteId: src.id, quoteText: snippet(src.content), quoteRole: src.role, quoteAuthorId: src.authorId }
    : { quoteId: null, quoteText: snippet(q), quoteRole: '', quoteAuthorId: '' };
}

// 一次生成算一「轮」。同一轮的消息共用 turnId，重新生成时整轮替换。
export function turnMessages(chatId, turnId) {
  return messages.where(m => m.chatId === chatId && m.turnId === turnId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function clearTurn(chatId, turnId) {
  turnMessages(chatId, turnId).forEach(m => dropMessage(m.id));
}

// 真人是一条一条发的，所以按长度停顿一下再送下一条
function pause(part) {
  if (part.type !== 'text') return 700;
  const n = part.text.length;
  return Math.min(1800, 320 + n * 28);
}

// 一个 part 落成一条消息。图片语音顺带把生成任务排上。
// 单拎出来是因为「修格式」也要用同一条路，不然两边各写一遍迟早走岔。
export function materialize(part, base, char) {
  const quote = quoteFields(base.chatId, part.quote);
  const row = { ...base, ...quote, ...(part.stamp ? { stamp: part.stamp } : {}) };

  if (part.type === 'image') {
    const msg = messages.create({ ...row, kind: 'image', content: `[图片：${part.prompt}]`,
      prompt: part.prompt, imageId: null, media: 'pending' });
    generateImage(msg.id, part.prompt);
    return msg;
  }
  if (part.type === 'voice') {
    const msg = messages.create({ ...row, kind: 'voice', content: `[语音：${part.text}]`,
      voiceText: part.text, audioId: null, media: 'pending' });
    generateVoice(msg.id, part.text, char);
    return msg;
  }
  return messages.create({ ...row, kind: 'text', content: part.text });
}

export async function renderTurn({ chat, char, raw, turnId, swipes, swipeIndex, onEach, signal, instant }) {
  const parts = splitReply(raw);
  if (!parts.length) throw new Error('模型返回了空内容');

  const created = [];
  for (let i = 0; i < parts.length; i++) {
    if (signal?.aborted) break;
    const part = parts[i];
    const msg = materialize(part, {
      chatId: chat.id, role: 'char', authorId: char.id,
      turnId, status: 'done',
      // 整轮的原文与候选只挂在第一条上，切换候选时整轮重放
      ...(i === 0 ? { raw, swipes: swipes || [raw], swipeIndex: swipeIndex ?? 0 } : {}),
    }, char);

    created.push(msg);
    chats.update(chat.id, { lastMessageAt: Date.now() });
    onEach && onEach(msg, i, parts.length);
    if (!instant && i < parts.length - 1) await new Promise(r => setTimeout(r, pause(part)));
  }
  return created;
}

// 删一条消息。图片和语音是另存的，跟着一起清掉，不然删完还占着空间。
export function dropMessage(id) {
  const m = messages.get(id);
  if (!m) return false;
  if (m.audioId) files.remove(m.audioId);
  if (m.imageId) images.remove(m.imageId);
  return messages.remove(id);
}

// 改完图片描述或语音文字之后重新生成那一份媒体
export function regenMedia(id) {
  const m = messages.get(id);
  if (!m) return;
  const char = characters.get(m.authorId);
  if (m.kind === 'image') {
    if (m.imageId) images.remove(m.imageId);
    messages.update(id, { imageId: null, media: 'pending', mediaError: '' });
    generateImage(id, m.prompt);
  } else if (m.kind === 'voice') {
    if (m.audioId) files.remove(m.audioId);
    messages.update(id, { audioId: null, media: 'pending', mediaError: '' });
    generateVoice(id, m.voiceText, char || {});
  }
}

async function generateImage(msgId, prompt) {
  if (!isImageReady()) {
    messages.update(msgId, { media: 'off', mediaError: '还没有配置生图接口' });
    return;
  }
  try {
    const blob = await imageSvc.generate({ prompt, key: `msg-img:${msgId}` });
    const id = await images.put(new File([blob], 'gen.png', { type: blob.type || 'image/png' }), 1024);
    messages.update(msgId, { imageId: id, media: 'done' });
  } catch (err) {
    messages.update(msgId, { media: 'error', mediaError: String(err.message || err) });
  }
}

async function generateVoice(msgId, text, char) {
  if (!isVoiceReady() || !char.voiceId) {
    messages.update(msgId, {
      media: 'off',
      mediaError: !char.voiceId ? '这个角色还没配音色' : '还没有配置语音接口',
    });
    return;
  }
  try {
    const url = await voiceSvc.speak({
      text, voiceId: char.voiceId, speed: char.voiceSpeed || 1, key: `msg-tts:${msgId}`,
    });
    const blob = await (await fetch(url)).blob();
    URL.revokeObjectURL(url);
    const id = await files.put(blob, { name: `${char.name}-${Date.now()}.mp3`, type: 'audio/mpeg' });
    messages.update(msgId, { audioId: id, media: 'done' });
  } catch (err) {
    messages.update(msgId, { media: 'error', mediaError: String(err.message || err) });
  }
}

// 告诉模型它可以发图发语音。只有配好了的才说，免得它发了却生成不出来。
export function mediaInstruction(char) {
  const s = settings.get();
  const canImage = isImageReady() && char.canSendImage !== false;
  const canVoice = isVoiceReady() && !!char.voiceId && char.canSendVoice !== false;
  if (!canImage && !canVoice) return '';

  const lines = ['\n\n[你可以发的东西]'];
  if (canImage) lines.push('想让对方看什么画面时，单独写一行 [图片：画面的描述]。描述写清楚点，会照着它生成一张图。');
  if (canVoice) lines.push('想用说的而不是打字时，单独写一行 [语音：要说的话]。');
  lines.push('别每次都用。真人也是偶尔才发一张图或按一段语音。');
  return lines.join('\n');
}
