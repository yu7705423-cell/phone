import { characters, stickers } from '../db/index.js';
import * as theirs from '../theirs.js';
import * as clock from '../time.js';
import * as currency from '../currency.js';
import { template, fillTemplate } from './templates.js';
import { translateMode } from './services.js';
import { isImageReady } from './image.js';
import { isVoiceReady } from './voice.js';
import { PENDING as TR_PENDING } from '../transfer.js';
import { PENDING as GIFT_PENDING } from '../gift.js';
import { listen } from '../listen.js';
import { PACT_OPEN } from '../space.js';
import * as dayStore from '../day.js';
import * as extras from '../extras.js';
import * as avatarLib from '../avatar.js';
import * as watchStore from '../watch.js';
import * as trip from '../trip.js';
import * as ledger from '../ledger.js';
import { PENDING as REQ_PENDING } from '../request.js';
import { PENDING as MEAL_PENDING } from '../takeout.js';
import { allSongs } from '../music.js';

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

// 列几个表情名字给模型。冷着的时候少列几个，热起来多列几个，
// 两个数都在设置里，填 0 就是全列。
function stickerNames(char, limit) {
  if (char.canSendSticker === false) return '';
  return stickers.all()
    .slice()
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
    .slice(0, limit > 0 ? limit : Infinity)
    .map(s => String(s.name || '').trim())
    .filter(Boolean)
    .join('、');
}

// 这段对话里有没有还没处理完的东西。有的话这个能力必须是热的 ——
// 挂着一笔没收的钱、一个没拆的礼物，模型得知道该怎么办。
const hasPending = (msgs, kind, field, value) =>
  msgs.some(m => m.kind === kind && m[field] === value);

// 时间戳与译文是**协议**，不是「想用再用」的功能：关掉它们，模型写出来的
// 那几行本地就解析不出来。所以它们不进那张开关表（见 switchable）。
export const PROTOCOL = new Set(['time', 'translate']);

/** 用户能自己关掉的那些。协议那两样不在里面。 */
export const switchable = () => CAPS.filter(c => !PROTOCOL.has(c.id));

/** 关掉了哪几样。存的是 id 清单，没有就是一样都没关。 */
export const offSet = settings =>
  new Set(Array.isArray(settings?.capsOff) ? settings.capsOff : []);

export const CAPS = [
  {
    id: 'image',
    label: '发图片',
    on: ({ char }) => isImageReady() && char.canSendImage !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^image$|[[【](图片|照片)/),
    line: () => 'Send an image: write a line on its own, [图片：a description of the image]',
    detail: () => template('skeleton.image'),
  },
  {
    id: 'voice',
    label: '发语音',
    on: ({ char }) => isVoiceReady() && !!char.voiceId && char.canSendVoice !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^voice$|[[【]语音/),
    line: () => 'Send a voice message: write a line on its own, [语音：what you say]',
    detail: () => template('skeleton.voice'),
  },
  {
    id: 'sticker',
    label: '发表情',
    // 表情和别的不一样：名字单子本身就是内容，一个不给就等于没这个功能。
    // 所以它常驻，只是冷着的时候少列几个。
    on: ({ char }) => !!stickerNames(char, 1),
    always: true,
    hot: ({ msgs }) => usedRecently(msgs, /^sticker$|[[【]表情/),
    detail: ({ char, hot, settings }) => fillTemplate(template('skeleton.sticker'), {
      names: stickerNames(char, hot ? (settings.stickerHot || 0) : (settings.stickerCold || 0)),
    }),
  },
  {
    // 往自己那台手机的相册里存一张。开关在「角色手机 - 相册」那一页，默认关着
    id: 'keepphoto',
    label: '往自己相册存图',
    on: ({ char }) => theirs.keepOn(char.id),
    hot: ({ msgs }) => usedRecently(msgs, /[[【]存图/),
    line: () => 'Save a photo to your own phone: write a line on its own,'
      + ' [存图：what you are keeping]. A photo just sent to you is the one saved',
    detail: () => template('skeleton.keepphoto'),
  },
  {
    id: 'quote',
    label: '引用消息',
    on: ({ msgs }) => msgs.length >= 2,
    hot: ({ msgs }) => usedRecently(msgs, /[[【](引用|回复)/),
    line: () => 'Quote: write a line on its own, [引用：a short excerpt of that message],'
      + ' then what you want to say on the next line',
    detail: () => template('skeleton.quote'),
  },
  {
    id: 'transfer',
    label: '转账',
    on: ({ char }) => char.canTransfer !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^transfer$|[[【]转账/)
      || hasPending(msgs, 'transfer', 'transfer', TR_PENDING),
    line: () => 'Send money: write a line on its own, [转账：amount note];'
      + ' on receiving money, write [收款] or [退回]',
    detail: () => fillTemplate(template('skeleton.transfer'), {
      currency: currency.label()
        ? `\nMoney in this conversation is ${currency.label()}; write amounts on that scale.`
        : '',
    }),
  },
  {
    id: 'gift',
    label: '送礼物',
    on: ({ char }) => char.canSendGift !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^gift$|[[【]礼物/)
      || hasPending(msgs, 'gift', 'gift', GIFT_PENDING),
    line: () => 'Give a gift: write a line on its own, [礼物：cover name | what is inside];'
      + ' on receiving one, write [拆开] or [拒收]',
    detail: () => template('skeleton.gift'),
  },
  {
    id: 'listen',
    label: '一起听与点歌',
    // 曲库是空的就没什么可听的，提了反而让它点一首不存在的歌
    on: ({ char }) => char.canListen !== false && allSongs().length > 0,
    // 正在一起听就必须是热的：那三条「别当鉴赏课」的规矩是这个功能的全部要害
    hot: ({ chat, msgs }) => (listen.get().active && listen.get().chatId === chat.id)
      || usedRecently(msgs, /^listen$|[[【](一起听|点歌|建歌单)/),
    line: () => 'Listen together: write a line on its own, [一起听];'
      + ' to change the track, write [点歌：song title]',
    detail: () => template('skeleton.listen'),
  },
  {
    id: 'ring',
    label: '通话',
    on: ({ char }) => char.canCall !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^call$|[[【](视频)?(去电|来电)/),
    line: () => 'Call: write a line on its own, [去电]; for video, write [视频去电]',
    detail: () => template('skeleton.ring'),
  },
  {
    id: 'location',
    label: '共享位置',
    on: ({ char }) => char.canSendLocation !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^location$|[[【](位置|定位)/),
    line: () => 'Share your location: write a line on its own, [位置：place name, address]',
    detail: ({ char }) => fillTemplate(template('skeleton.location'), {
      city: char.timezone ? ` (you are in ${clock.zoneLabel(char.timezone)})` : '',
    }),
  },
  {
    // 这段对话没绑账本就一个字都不提：共同账户、亲属卡都无处可落
    id: 'joint',
    label: '共同账户与亲属卡',
    on: ({ chat }) => !!chat && !!ledger.bookOfChat(chat.id),
    // 有一条申请挂着就必须是热的：它得知道怎么批、怎么驳
    hot: ({ msgs }) => usedRecently(msgs, /^request$|[[【](申请|亲属卡|开通共同账户)/)
      || hasPending(msgs, 'request', 'request', REQ_PENDING),
    line: () => 'Joint account and family card: write a line on its own,'
      + ' [开通共同账户], [申请：what it is for, amount], or [亲属卡：额度 2000];'
      + ' respond to a request with [批准] or [驳回]',
    detail: () => template('skeleton.joint'),
  },
  {
    id: 'pact',
    label: '约定',
    on: ({ char }) => char.canPact !== false,
    // 还欠着约定就必须是热的：它得知道「完成」怎么写，才标得掉
    hot: ({ msgs }) => usedRecently(msgs, /^pact$|[[【]约定/)
      || hasPending(msgs, 'pact', 'pact', PACT_OPEN),
    line: () => 'Make a promise: write a line on its own, [约定：the thing];'
      + ' when it is fulfilled, write [约定完成：the thing]',
    detail: () => template('skeleton.pact'),
  },
  {
    id: 'trip',
    label: '出行',
    on: ({ char }) => trip.onFor(char),
    // 有一条提议挂着就必须是热的：它得知道「同行」「不去」怎么写，才表得了态
    hot: ({ msgs }) => usedRecently(msgs, /^trip$|[[【]旅行/)
      || hasPending(msgs, 'trip', 'trip', trip.PENDING),
    line: () => 'Propose going somewhere together: write a line on its own,'
      + ' [旅行：place | when];'
      + ' for one they proposed, write [同行] or [不去]',
    detail: () => template('skeleton.trip'),
  },
  {
    id: 'letter',
    label: '写信',
    on: ({ char }) => char.canWriteLetter !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^letter$|[[【]信[:：]/),
    line: () => 'Write a letter: write a line on its own, [信：salutation | body]',
    detail: () => template('skeleton.letter'),
  },
  {
    id: 'watch',
    label: '一起看',
    // 这一场开着才有这回事。没开的时候一个字都不提 ——
    // 「你可以暂停」对着没在放的画面说，只会让它凭空去暂停。
    on: ({ chat }) => !!chat && watchStore.inChat(chat.id),
    always: true,
    detail: () => template('skeleton.watch'),
  },
  {
    id: 'agenda',
    label: '日程事项',
    // 今天没排日程就别提这回事。排了就常驻 —— 「你今天」那一段已经在上面了，
    // 不告诉它怎么标完成，那几条事项就只能一直挂着。
    on: ({ char }) => !!dayStore.brief(char.id),
    always: true,
    detail: () => template('skeleton.agenda'),
  },
  {
    id: 'takeout',
    label: '外卖与请客',
    on: ({ char }) => char.canTakeout !== false,
    // 挂着一单没处理的就必须是热的：它得知道「收下」「不要」怎么写
    hot: ({ msgs }) => usedRecently(msgs, /^takeout$|[[【](外卖|请客|代付)/)
      || hasPending(msgs, 'takeout', 'takeout', MEAL_PENDING),
    line: () => 'Order delivery: [外卖：item amount] for yourself, [请客：…] for them,'
      + ' [代付：…] paid by them; for an order they placed, write [要了] or [不要]',
    detail: () => template('skeleton.takeout'),
  },
  {
    id: 'pat',
    label: '拍一拍',
    on: ({ char }) => char.canPat !== false,
    hot: ({ msgs }) => usedRecently(msgs, /拍了拍|[[【]拍/),
    line: () => 'Nudge: write a line on its own, [拍一拍]',
    detail: () => template('skeleton.pat'),
  },
  {
    id: 'dice',
    label: '骰子',
    on: ({ char }) => char.canDice !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^dice$|[[【]骰子/),
    line: () => 'Roll a die: write a line on its own, [骰子]; the system rolls it,'
      + ' and the result is not knowable this turn',
    detail: () => template('skeleton.dice'),
  },
  {
    id: 'avatar',
    label: '换头像',
    // 库是空的就没什么可换，提了反而让它点一张不存在的
    on: ({ char }) => !!avatarLib.poolNames(char),
    hot: ({ msgs }) => usedRecently(msgs, /[[【]换头像/),
    line: ({ char }) => 'Change your avatar: write a line on its own, [换头像：name].'
      + ` Available: ${avatarLib.poolNames(char)}`,
    detail: ({ char }) => fillTemplate(template('skeleton.avatar'), { names: avatarLib.poolNames(char) }),
  },
  {
    id: 'inner',
    label: '心声',
    // 心声是每一轮的义务，不是「想用再用」的功能，冷着注入等于关掉它。
    // 「单独生成」那一档不走这儿 —— 那一档是另一次调用，不必在这儿交代写法。
    on: ({ chat }) => extras.innerMode(chat) === extras.INNER_INLINE,
    always: true,
    detail: () => template('skeleton.inner'),
  },
  {
    id: 'time',
    label: '时间戳',
    // 每轮开头都要写的那一行。这不是「想用再用」的功能，冷着注入等于关掉它
    on: () => clock.stampOn(),
    always: true,
    detail: () => template('skeleton.time'),
  },
  {
    id: 'translate',
    label: '译文',
    // 同理：每条消息都要跟一行译文。
    // 配了单独的翻译接口就不走这条路了 —— 那边只拿到原文与翻译规则，
    // 这边一个字都不必提，提了反而是让聊天模型再翻一遍（见 ai/translate.js）。
    on: ({ chat }) => !!chat.translateTo && translateMode() === 'inline',
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

  // 用户自己关掉的那几样，一个字都不注入 —— 关了却还在 prompt 里躺着，
  // 就成了「界面上说关了，模型那边照样看得见」
  const off = offSet(ctx.settings);

  for (const cap of CAPS) {
    if (off.has(cap.id) && !PROTOCOL.has(cap.id)) continue;
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
