import { messages, chats, characters, images, files, settings } from '../db/index.js';
import { uid } from '../store.js';
import * as imageSvc from './image.js';
import * as voiceSvc from './voice.js';
import { isImageReady } from './image.js';
import { isVoiceReady } from './voice.js';

// 角色回复里可以带这两种标记，由模型自己决定什么时候用。
// 中英文冒号都认，方括号也认全角。
const MARK = /[[【]\s*(图片|照片|image|pic|语音|voice|audio)\s*[:：]\s*([^\]】]+)[\]】]/gi;

const IMAGE_KINDS = new Set(['图片', '照片', 'image', 'pic']);

// 把一整段回复拆成按顺序排列的若干条。空行分段，标记单独成条。
export function splitReply(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const parts = [];
  let last = 0;

  const pushText = chunk => {
    chunk.split(/\n\s*\n/).forEach(seg => {
      const t = seg.trim();
      if (t) parts.push({ type: 'text', text: t });
    });
  };

  MARK.lastIndex = 0;
  let m;
  while ((m = MARK.exec(text))) {
    pushText(text.slice(last, m.index));
    const kind = m[1].toLowerCase();
    const body = m[2].trim();
    if (body) {
      parts.push(IMAGE_KINDS.has(kind)
        ? { type: 'image', prompt: body }
        : { type: 'voice', text: body });
    }
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return parts;
}

// 一次生成算一「轮」。同一轮的消息共用 turnId，重新生成时整轮替换。
export function turnMessages(chatId, turnId) {
  return messages.where(m => m.chatId === chatId && m.turnId === turnId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function clearTurn(chatId, turnId) {
  turnMessages(chatId, turnId).forEach(m => {
    if (m.audioId) files.remove(m.audioId);
    if (m.imageId) images.remove(m.imageId);
    messages.remove(m.id);
  });
}

// 真人是一条一条发的，所以按长度停顿一下再送下一条
function pause(part) {
  if (part.type !== 'text') return 700;
  const n = part.text.length;
  return Math.min(1800, 320 + n * 28);
}

export async function renderTurn({ chat, char, raw, turnId, swipes, swipeIndex, onEach, signal, instant }) {
  const parts = splitReply(raw);
  if (!parts.length) throw new Error('模型返回了空内容');

  const created = [];
  for (let i = 0; i < parts.length; i++) {
    if (signal?.aborted) break;
    const part = parts[i];
    const base = {
      chatId: chat.id, role: 'char', authorId: char.id,
      turnId, status: 'done',
      // 整轮的原文与候选只挂在第一条上，切换候选时整轮重放
      ...(i === 0 ? { raw, swipes: swipes || [raw], swipeIndex: swipeIndex ?? 0 } : {}),
    };

    let msg;
    if (part.type === 'text') {
      msg = messages.create({ ...base, kind: 'text', content: part.text });
    } else if (part.type === 'image') {
      msg = messages.create({ ...base, kind: 'image', content: `[图片：${part.prompt}]`,
        prompt: part.prompt, imageId: null, media: 'pending' });
      generateImage(msg.id, part.prompt);
    } else {
      msg = messages.create({ ...base, kind: 'voice', content: `[语音：${part.text}]`,
        voiceText: part.text, audioId: null, media: 'pending' });
      generateVoice(msg.id, part.text, char);
    }

    created.push(msg);
    chats.update(chat.id, { lastMessageAt: Date.now() });
    onEach && onEach(msg, i, parts.length);
    if (!instant && i < parts.length - 1) await new Promise(r => setTimeout(r, pause(part)));
  }
  return created;
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
