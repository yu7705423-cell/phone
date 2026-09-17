import { messages, chats, characters, images, files, settings } from '../db/index.js';
import { uid } from '../store.js';
import * as imageSvc from './image.js';
import * as voiceSvc from './voice.js';
import { isImageReady } from './image.js';
import { isVoiceReady } from './voice.js';
import { byName as stickerByName, markUsed } from '../stickers.js';
import { notify } from '../notify.js';
import { nav } from '../nav.js';
import * as transfer from '../transfer.js';

// 角色回复里可以带这几种标记，由模型自己决定什么时候用。
// 中英文冒号都认，方括号也认全角。
const MARK = /[[【]\s*(图片|照片|image|pic|语音|voice|audio|表情|sticker|emoji|转账|transfer)\s*[:：]\s*([^\]】]+)[\]】]/gi;

const IMAGE_KINDS = new Set(['图片', '照片', 'image', 'pic']);
const STICKER_KINDS = new Set(['表情', 'sticker', 'emoji']);
const TRANSFER_KINDS = new Set(['转账', 'transfer']);

// 转账那一条里，金额在前，后面随手写的是留言
const AMOUNT = /^\s*(?:[¥￥$]\s*)?(\d+(?:\.\d{1,2})?)\s*(?:元|块)?\s*(.*)$/;

// 收下或退回对方转过来的那一笔。必须带方括号 —— 不带的话，
// 「退回」两个字单独成行的正常句子也会被当成指令。
const SETTLE_LINE = /^[[【(（]\s*(收款|收下|接收|退回|退还|拒收)\s*[\]】)）]$/;

// 引用单独成行，挂在它下面那一条上，不自己占一个气泡。
const QUOTE_LINE = /^[[【(（]?\s*(?:引用|回复|quote)\s*[:：]\s*([^\n\]】)）]+)[\]】)）]?\s*$/i;

// 译文也单独成行，但挂在它**上面**那一条上 —— 先有原文才有译文。
// 同样不占气泡，收在消息的 translation 字段里，点原文气泡才展开。
const TRANS_LINE = /^[[【(（]?\s*(?:译文|翻译|译|translation)\s*[:：]\s*(.+?)[\]】)）]?\s*$/i;

// 时间行同理。让模型自己写一遍当地时间，是目前最靠谱的时间感知 ——
// 写过一遍才算真看见。但它是给模型自己定位用的，不该显示给用户，
// 所以这里剥掉，只把内容记在消息上，回头再塞回上下文（见 engine.buildHistory）。
//
// 模型多半会照着模板写 [时间：…]，但也常常只丢一个 [2026-01-01 周三 14:30]，
// 标签说掉就掉。两种都得认 —— 认不出来那一行就当正文渲染出去了，
// 而且它挡在最前面，后面那行引用标记也跟着剥不掉，整条消息全乱。
const STAMP_LINE = /^[[【(（]?\s*(?:时间|time)\s*[:：]\s*([^\n\]】)）]+)[\]】)）]?\s*$/i;
const BRACKETED = /^[[【(（]\s*([^\n\]】)）]+?)\s*[\]】)）]\s*$/;
// 只由数字和时间用字构成，且确实带着钟点或日期的样子
const TIMEISH = /^[\d\s:：\-/.年月日时分秒周一二三四五六天上下午aApPmM]+$/;
const isTimeStamp = t => /[:：]/.test(t) || /\d{4}[-/.]\d/.test(t);

// 整行就是一个时间戳的，不管在第几行都摘掉。
// 模型常常每条都写一遍，那样白白多花 token 也没有额外信息 ——
// 一轮回复就是一个时刻，留第一个就够。
function stripStamps(raw) {
  const stamps = [];
  const kept = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    const labelled = t.match(STAMP_LINE);
    if (labelled) { stamps.push(labelled[1].trim()); continue; }
    const bare = t.match(BRACKETED);
    if (bare && /\d/.test(bare[1]) && TIMEISH.test(bare[1]) && isTimeStamp(bare[1])) {
      stamps.push(bare[1].trim());
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join('\n'), stamp: stamps[0] || '' };
}

// 引用块只留一小段，长了在气泡上顶掉正文
export function snippet(text, max = 40) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// 把一整段回复拆成按顺序排列的若干条。空行分段，标记单独成条。
export function splitReply(raw) {
  const { text, stamp } = stripStamps(String(raw || '').trim());
  if (!text.trim()) return [];

  const parts = [];
  let last = 0;
  // 读到的引用行先记着，挂到紧随其后的那一条上
  let pendingQuote = null;

  const push = part => {
    if (pendingQuote) { part.quote = pendingQuote; pendingQuote = null; }
    parts.push(part);
  };

  // 按空行分段。模型经常只按单换行分，那样整轮会黏成一条 ——
  // 所以单换行也算一次分条。真要在一条里换行，写成同一行或者用空格。
  const segments = chunk => String(chunk).split(/\n+/);

  const pushText = chunk => {
    segments(chunk).forEach(seg => {
      const t = seg.trim();
      if (!t) return;
      // 整行是个引用标记的，记下来挂到下一条上，自己不占气泡
      const q = t.match(QUOTE_LINE);
      if (q) { pendingQuote = q[1].trim(); return; }

      // 处理对方转过来的那一笔。自己不占气泡，落的是一行提示。
      const st = t.match(SETTLE_LINE);
      if (st) { push({ type: 'settle', take: !/退|拒/.test(st[1]) }); return; }

      // 译文相反，挂到刚刚那一条上。前面没有正文就只能丢掉。
      const tr = t.match(TRANS_LINE);
      if (tr) {
        const prev = parts[parts.length - 1];
        if (prev) prev.translation = tr[1].trim();
        return;
      }

      push({ type: 'text', text: t });
    });
  };

  MARK.lastIndex = 0;
  let m;
  while ((m = MARK.exec(text))) {
    pushText(text.slice(last, m.index));
    const kind = m[1].toLowerCase();
    const body = m[2].trim();
    if (body) {
      if (TRANSFER_KINDS.has(kind)) {
        const a = body.match(AMOUNT);
        // 金额读不出来就整条丢掉。凭空造一笔金额不明的转账比少发一条更糟。
        if (a) push({ type: 'transfer', amount: Number(a[1]), note: (a[2] || '').trim() });
      } else {
        push(IMAGE_KINDS.has(kind) ? { type: 'image', prompt: body }
          : STICKER_KINDS.has(kind) ? { type: 'sticker', name: body }
          : { type: 'voice', text: body });
      }
    }
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));

  // 时间只挂在整轮第一条上
  if (stamp && parts.length) parts[0].stamp = stamp;
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
  const row = {
    ...base, ...quote,
    ...(part.stamp ? { stamp: part.stamp } : {}),
    ...(part.translation ? { translation: part.translation } : {}),
  };

  if (part.type === 'sticker') {
    // 名字对不上也照发。stickerName 留着，气泡上显示它想发的是哪个，
    // 总比悄悄吞掉一条消息强。
    const found = stickerByName(part.name);
    if (found) markUsed(found.id);
    return messages.create({
      ...row, kind: 'sticker',
      content: `[表情：${found ? found.name : part.name}]`,
      stickerId: found ? found.id : null,
      stickerName: part.name,
    });
  }
  if (part.type === 'transfer') {
    return transfer.send({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      amount: part.amount, note: part.note, extra: row,
    });
  }
  if (part.type === 'settle') {
    // 处理的是对方那一笔。对方是谁看这一轮是谁在说话。
    const target = transfer.pendingFrom(base.chatId, base.role === 'user' ? 'char' : 'user');
    // 没有待处理的就当没写过这一行 —— 凭空落一句「已收款」会让人莫名其妙
    return target ? transfer.settle(target.id, part.take, row) : null;
  }
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

// 这一轮消息该不该弹通知。人正盯着这个会话看就不弹 ——
// 屏幕上已经有了，再弹一条横幅只是噪音。
// 不在这个会话（在别的 app、在主界面、在另一段对话），或者页面根本不在前台，
// 就照常弹；页面不在前台时 push.js 会把它转成系统通知。
function shouldNotify(chatId) {
  const s = nav.get();
  const looking = s.screen === 'app' && s.appId === 'chat'
    && (s.stacks?.chat || []).slice(-1)[0] === `/chat/${chatId}`;
  return !(looking && document.visibilityState === 'visible');
}

export function notifyTurn(chat, char, created) {
  if (!created.length || !shouldNotify(chat.id)) return;
  const first = created.find(m => m.kind === 'text') || created[0];
  notify({
    title: char.name || '新消息',
    body: first?.content || '发来一条消息',
    icon: 'message', appId: 'chat', avatar: char.avatar,
    payload: { route: `/chat/${chat.id}` },
  });
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

    if (!msg) continue;
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
  // 「已收款」那一行就是这件事的记录，删了它就当没处理过，那笔回到待处理。
  // 重新生成角色那一轮时整轮清空，走的也是这里。
  if (m.kind === 'notice' && m.settledId) transfer.unsettle(id);
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
