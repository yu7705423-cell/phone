import { characters, stickers } from '../db/index.js';
import * as clock from '../time.js';
import * as currency from '../currency.js';
import { template, fillTemplate } from './templates.js';
import { isImageReady } from './image.js';
import { isVoiceReady } from './voice.js';
import { PENDING as TR_PENDING } from '../transfer.js';
import { PENDING as GIFT_PENDING } from '../gift.js';

// 能力目录。
//
// 每个能力有两种形态：
//   **目录** 一行，说清楚它叫什么、写哪一行会生效；
//   **细则** 整段，讲格式、边界、什么时候别用。
//
// 平时只给目录，这一轮真沾边了才给细则。原因不是省钱（虽然也省）——
// 是**注意力**：十来段功能说明堆在人设后面，模型的注意力就被摊薄了，
// 聊天本身反而写不好。让它知道有这么回事就够了，真要用的时候细则会到。
//
// 代价是「第一次使用」拿不到细则，所以**目录那一行必须自带正确的写法**，
// 照着它写出来的第一次就得能落地。落地之后这个能力就热了，下一轮细则跟上。
//
// 常驻的那几个不走这套：时间戳和译文是**每条消息的义务**，不是「想用再用」的
// 功能，冷着注入等于关掉它们。

const WINDOW = 8;   // 往回看这么多条，判断这个能力最近是不是用过

const usedRecently = (msgs, re) =>
  msgs.slice(-WINDOW).some(m => re.test(String(m.content || '')) || re.test(String(m.kind || '')));

const STICKER_COLD = 12;   // 冷着的时候只列这么多个名字
const STICKER_HOT = 60;

function stickerNames(char, limit) {
  if (char.canSendSticker === false) return '';
  return stickers.all()
    .slice()
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
    .slice(0, limit)
    .map(s => String(s.name || '').trim())
    .filter(Boolean)
    .join('、');
}

// 这段对话里有没有还没处理完的东西。有的话这个能力必须是热的 ——
// 挂着一笔没收的钱、一个没拆的礼物，模型得知道该怎么办。
const hasPending = (msgs, kind, field, value) =>
  msgs.some(m => m.kind === kind && m[field] === value);

export const CAPS = [
  {
    id: 'image',
    on: ({ char }) => isImageReady() && char.canSendImage !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^image$|[[【](图片|照片)/),
    line: () => '发图片：单独写一行 [图片：画面的描述]',
    detail: () => template('skeleton.image'),
  },
  {
    id: 'voice',
    on: ({ char }) => isVoiceReady() && !!char.voiceId && char.canSendVoice !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^voice$|[[【]语音/),
    line: () => '发语音：单独写一行 [语音：要说的话]',
    detail: () => template('skeleton.voice'),
  },
  {
    id: 'sticker',
    // 表情和别的不一样：名字单子本身就是内容，一个不给就等于没这个功能。
    // 所以它常驻，只是冷着的时候少列几个。
    on: ({ char }) => !!stickerNames(char, 1),
    always: true,
    hot: ({ msgs }) => usedRecently(msgs, /^sticker$|[[【]表情/),
    detail: ({ char, hot }) => fillTemplate(template('skeleton.sticker'), {
      names: stickerNames(char, hot ? STICKER_HOT : STICKER_COLD),
    }),
  },
  {
    id: 'quote',
    on: ({ msgs }) => msgs.length >= 2,
    hot: ({ msgs }) => usedRecently(msgs, /[[【](引用|回复)/),
    line: () => '引用某一句：单独写一行 [引用：那句话的一小段原文]，下一行再说你的话',
    detail: () => template('skeleton.quote'),
  },
  {
    id: 'transfer',
    on: ({ char }) => char.canTransfer !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^transfer$|[[【]转账/)
      || hasPending(msgs, 'transfer', 'transfer', TR_PENDING),
    line: () => '转账：单独写一行 [转账：金额 留言]；收到对方的转账写 [收款] 或 [退回]',
    detail: () => fillTemplate(template('skeleton.transfer'), {
      currency: currency.label() ? `\n这段对话里的钱是${currency.label()}，按这个量级写金额。` : '',
    }),
  },
  {
    id: 'gift',
    on: ({ char }) => char.canSendGift !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^gift$|[[【]礼物/)
      || hasPending(msgs, 'gift', 'gift', GIFT_PENDING),
    line: () => '送礼物：单独写一行 [礼物：封面上写什么 | 拆开是什么]；收到礼物写 [拆开] 或 [拒收]',
    detail: () => template('skeleton.gift'),
  },
  {
    id: 'ring',
    on: ({ char }) => char.canCall !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^call$|[[【](视频)?来电/),
    line: () => '打电话：单独写一行 [来电]，要带画面就写 [视频来电]',
    detail: () => template('skeleton.ring'),
  },
  {
    id: 'location',
    on: ({ char }) => char.canSendLocation !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^location$|[[【](位置|定位)/),
    line: () => '报位置：单独写一行 [位置：地点名 地址]',
    detail: ({ char }) => fillTemplate(template('skeleton.location'), {
      city: char.timezone ? `（你在${clock.zoneLabel(char.timezone)}）` : '',
    }),
  },
  {
    id: 'time',
    // 每轮开头都要写的那一行。这不是「想用再用」的功能，冷着注入等于关掉它
    on: () => clock.stampOn(),
    always: true,
    detail: () => template('skeleton.time'),
  },
  {
    id: 'translate',
    // 同理：每条消息都要跟一行译文
    on: ({ chat }) => !!chat.translateTo,
    always: true,
    detail: ({ chat }) => fillTemplate(template('skeleton.translate'), { lang: chat.translateTo }),
  },
];

/**
 * 拼出能力那一段。
 * lean 关掉就退回老样子：每个开着的能力都给整段细则。
 */
export function capabilityBlock(raw) {
  // 注入块那边把消息列表叫 messages，这里一路叫 msgs，入口处对齐一次
  const ctx = { ...raw, msgs: raw.messages || raw.msgs || [] };
  const lean = ctx.settings.promptLean !== false;
  const lines = [];
  const details = [];

  for (const cap of CAPS) {
    if (!cap.on(ctx)) continue;
    const hot = !lean || cap.always || (cap.hot ? cap.hot(ctx) : false);
    if (hot || !cap.line) details.push(cap.detail({ ...ctx, hot }));
    else lines.push(cap.line(ctx));
  }

  let out = '';
  if (lines.length) {
    out += '\n\n' + fillTemplate(template('skeleton.abilities'), {
      list: lines.map(l => '· ' + l).join('\n'),
    });
  }
  for (const d of details) if (d && d.trim()) out += '\n\n' + d.trim();
  return out;
}
