import { characters, stickers } from '../db/index.js';
import { DEFAULT_GROUP, labelOf, dupeNames } from '../stickers.js';
import * as theirs from '../theirs.js';
import * as clock from '../time.js';
import * as currency from '../currency.js';
import { template, fillTemplate } from './templates.js';
import { translateMode, neteaseReady } from './services.js';
import { isImageReady } from './image.js';
import { isVideoReady } from './video.js';
import { styleAsk } from './imageprompt.js';
import { isVoiceReady } from './voice.js';
import { PENDING as TR_PENDING } from '../transfer.js';
import { PENDING as GIFT_PENDING } from '../gift.js';
import { listen } from '../listen.js';
import { PACT_OPEN } from '../space.js';
import * as dayStore from '../day.js';
import * as extras from '../extras.js';
import * as avatarLib from '../avatar.js';
import * as remark from '../remark.js';
import * as recall from '../recall.js';
import * as when from '../when.js';
import * as watchStore from '../watch.js';
import * as trip from '../trip.js';
import * as ledger from '../ledger.js';
import { PENDING as REQ_PENDING } from '../request.js';
import { PENDING as MEAL_PENDING } from '../takeout.js';
import { allSongs } from '../music.js';
import * as mcpTools from '../mcptools.js';
import * as closet from '../closet.js';

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
/**
 * 列几个表情名字给模型。
 *
 * **名额要在各个分组之间轮着分，不能只按用得多排。**
 *
 * 从前是把所有表情按 `useCount` 从多到少排一遍取前 N 个。分组一多，
 * 这里就出一个**自己锁死自己的圈**：某一组先用起来，计数涨上去，名单被它
 * 占满；另一组一次都没被列出来，模型根本不知道有这些名字，也就永远发不出来，
 * 计数永远是 0，于是永远进不了名单。表现出来正是「有一个分组不能用」。
 *
 * 所以改成各组轮流取一个：**每一组都至少露一个名字**，组内仍然按用得多的
 * 排在前面。名额一个都不少给，只是换了个分法。
 */
function stickerNames(char, limit) {
  if (char.canSendSticker === false) return '';
  const cap = limit > 0 ? limit : Infinity;
  const byGroup = new Map();
  for (const s of stickers.all()) {
    const g = (s.group || '').trim() || DEFAULT_GROUP;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(s);
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
  }
  const lists = [...byGroup.values()];
  // 重名的要带上分组，不然名单里两个「开心」，模型挑哪个都是同一个字，
  // 而按名字只找得回先建的那一个（见 stickers.js 的 labelOf）
  const dupes = dupeNames();
  const out = [];
  for (let i = 0; out.length < cap; i++) {
    let any = false;
    for (const list of lists) {
      if (i >= list.length) continue;
      any = true;
      const n = labelOf(list[i], dupes);
      if (n) out.push(n);
      if (out.length >= cap) break;
    }
    if (!any) break;
  }
  // **一行一个**。从前用「、」连起来，而名字里本来就可能有「、」，
  // 那样模型看到的就是两个名字，写出来哪个都对不上
  return out.map(n => `- ${n}`).join('\n');
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

// 撤回动态那一句：最近一条还挂着的动态是什么。没有就不提这一半
function postLine(char) {
  const mo = recall.latestMoment(char.id);
  if (!mo) return '';
  return fillTemplate(template('skeleton.recall-post'), {
    when: when.show(mo.createdAt, Date.now()),
    text: String(mo.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(no text)',
  });
}

export const CAPS = [
  {
    id: 'image',
    label: '发图片',
    on: ({ char }) => isImageReady() && char.canSendImage !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^image$|[[【](图片|照片)/),
    line: () => 'Send an image: write a line on its own, [图片：a description of the image]',
    // 开着的生图预设里那几句「描述要写到什么」也给它 —— 光有画风没有内容，
    // 画出来的还是一句话那么空（见 ai/imageprompt.js 的 STYLES）
    detail: () => [template('skeleton.image'), styleAsk()].filter(Boolean).join('\n'),
  },
  {
    // 视频比图片贵得多，而且一跑就是几分钟，所以**默认关着**（第 15 条）。
    // 开关在「设置 - 用量与上限」，角色那一份在角色卡上
    id: 'video',
    label: '发视频',
    on: ({ char, settings }) => settings.videoOn === true && isVideoReady()
      && char.canSendVideo !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^clip$|[[【]视频/),
    line: () => 'Send a video: write a line on its own, [视频：a description of the video]',
    detail: () => template('skeleton.video'),
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
    // MCP 工具。清单本身就是写法的一部分（不知道有哪些工具、参数长什么样就调不对），
    // 所以不走「冷着只给一行」那套，一直给整段。多长由角色卡上勾了几台服务器、
    // 设置里关了哪几个工具决定
    id: 'mcp',
    label: '调用工具（MCP）',
    always: true,
    on: ({ char }) => mcpTools.toolsFor(char).length > 0,
    detail: ({ char }) => fillTemplate(template('skeleton.mcp'), { tools: mcpTools.toolList(char) }),
  },
  {
    id: 'listen',
    label: '一起听、点歌、分享歌曲与歌单',
    // 曲库是空的、又没配网易云，就没有歌可放，提了反而让它点一首不存在的歌。
    // 配了网易云，曲库空着也能从那边搜回来
    on: ({ char }) => char.canListen !== false && (allSongs().length > 0 || neteaseReady()),
    // 正在一起听就必须是热的：点歌、建歌单这几个标记怎么写，这一段说了算
    hot: ({ chat, msgs }) => (listen.get().active && listen.get().chatId === chat.id)
      || usedRecently(msgs, /^(listen|song)$|[[【](一起听|点歌|建歌单|加入歌单|分享歌曲)/),
    line: () => 'Music: [一起听] to listen together, [点歌：song title - artist] to change the track,'
      + ' [分享歌曲：song title - artist] to send a song, [加入歌单：playlist | song - artist] to keep songs',
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
    id: 'todo',
    label: '记下待办',
    on: ({ char }) => char.canTodo !== false,
    hot: ({ msgs }) => usedRecently(msgs, /[[【]待办/),
    line: () => 'Record something they mean to do: write a line on its own, [待办：the thing]',
    detail: () => template('skeleton.todo'),
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
    // 攻略那一行**只在有一次活着的出行时才给**。没有出行的时候告诉它
    // 「可以往攻略里加一条」，它会往一份不存在的清单里加
    line: ({ chat }) => 'Propose going somewhere together: write a line on its own,'
      + ' [旅行：place | when];'
      + ' for one they proposed, write [同行] or [不去]'
      + (chat && trip.currentOf(chat.id)
        ? '; add somewhere to the plan for the trip already agreed with'
          + ' [攻略：place]'
        : ''),
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
    id: 'award',
    label: '颁发标识',
    on: ({ char }) => char.canAward !== false,
    hot: ({ msgs }) => usedRecently(msgs, /^award$|[[【]授予[:：]/),
    line: () => 'Give them a badge: write a line on its own, [授予：badge name｜reason]',
    detail: () => template('skeleton.award'),
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
    //
    // **出行期间也不提。** 那几天「你今天」那一段整个让开了（见
    // context/day.js），告诉它怎么标完成一份没注入的日程，只会让它去标
    // 一件它看不见的事。
    on: ({ char }) => !trip.goingFor(char.id) && !!dayStore.brief(char.id),
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
    // 从对方的衣帽间里挑几件搭成一套。对方衣橱里一件分好类的都没有就不提：
    // 告诉它能搭，它只能凭空编几件出来。群里不给，搭给谁说不清
    id: 'outfit',
    label: '搭配衣帽间里的衣物',
    on: ({ chat }) => (chat?.characterIds || []).length <= 1 && closet.hasWardrobe(),
    // 在聊穿搭就热：清单那一段这时才带（context/closet.js），细则跟着到
    hot: ({ msgs }) => usedRecently(msgs, /^(outfit|dresscode)$|[[【](搭配|穿搭主题)/)
      || msgs.filter(m => m.role === 'user').slice(-3).some(m => closet.WEAR_TOPIC.test(String(m.content || ''))),
    line: () => 'Put together an outfit from their wardrobe: write a line on its own,'
      + ' [搭配：outfit name | item、item、item]',
    detail: () => template('skeleton.outfit'),
  },
  {
    // 剧情里的衣帽间：换上、借走、借给你、归还（ARCHITECTURE 4.217）。两边衣帽间都空着就不提，
    // 没有东西可换、可借。群里不给：借给谁说不清。线下那一套在 skeleton.scene-closet
    id: 'closetact',
    label: '衣帽间：换上、借走、借给、归还',
    on: ({ char, chat }) => (chat?.characterIds || []).length <= 1 && !!char
      && (closet.hasWardrobe() || closet.itemsOf(char.id).some(r => r.side === 'wear' && closet.live(r))),
    hot: ({ msgs }) => usedRecently(msgs, /[[【](换上|借走|借给你|归还)|借|还给/)
      || msgs.filter(m => m.role === 'user').slice(-3).some(m => closet.WEAR_TOPIC.test(String(m.content || ''))),
    line: () => 'Wardrobe: write a line on its own, [换上：item] to change into one of your items,'
      + ' [借走：item] to borrow one of theirs, [借给你：item] to lend them one of yours, [归还：item] to return one',
    detail: () => template('skeleton.closet-act'),
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
    id: 'remark',
    label: '改备注',
    on: ({ char }) => char.canRemark !== false,
    hot: ({ msgs }) => usedRecently(msgs, /[[【]备注|将你的备注改为/),
    line: ({ char, chat }) => 'Rename the other party in your own contacts: write a line on its own,'
      + ` [备注：new name]. Currently: ${remark.theirsOf(chat) || 'no name set'}.`
      + (remark.mineOf(char) ? ` They have you saved as: ${remark.mineOf(char)}.` : ''),
    detail: ({ char, chat }) => fillTemplate(template('skeleton.remark'), {
      current: remark.theirsOf(chat) || 'no name set',
      mine: remark.mineOf(char) || 'your own name',
    }),
  },
  {
    id: 'recall',
    label: '撤回',
    on: ({ char }) => char.canRecall !== false,
    hot: ({ msgs }) => usedRecently(msgs, /[[【]撤回/) || msgs.slice(-WINDOW).some(m => m.recalled),
    line: ({ char }) => 'Withdraw a message: write [撤回] on its own line directly after that message.'
      + (recall.latestMoment(char.id) ? ' Take down your latest post: write [撤回动态] on its own line.' : ''),
    detail: ({ char }) => fillTemplate(template('skeleton.recall'), { post: postLine(char) }),
  },
  {
    // 旁白。会话「互动」里开了才有；开了就常驻：它是这一段会话的写法，不是想用再用的功能
    id: 'narration',
    label: '旁白',
    on: ({ chat }) => extras.narrationOn(chat),
    always: true,
    detail: () => template('skeleton.narration'),
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
// 群聊里说得通的那几样。转账、礼物、一起听、约定、出行这些都是「你和我」
// 之间的事，群里没有一个对象可以接；心声、换头像按一个角色设计，群里一次写几个人。
const GROUP_CAPS = new Set(['image', 'video', 'voice', 'sticker', 'quote', 'dice', 'time', 'translate', 'award']);

export function capabilityBlock(raw) {
  // 注入块那边把消息列表叫 messages，这里一路叫 msgs，入口处对齐一次
  const ctx = { ...raw, msgs: raw.messages || raw.msgs || [] };
  // 群聊：只给群里说得通的几样；某一样只要有一个成员开着就给
  const members = Array.isArray(raw.members) ? raw.members : null;
  const onFor = cap => (members
    ? GROUP_CAPS.has(cap.id) && members.some(c => cap.on({ ...ctx, char: c }))
    : cap.on(ctx));
  const lean = ctx.settings.promptLean !== false;
  const lines = [];
  const details = [];

  // 用户自己关掉的那几样，一个字都不注入 —— 关了却还在 prompt 里躺着，
  // 就成了「界面上说关了，模型那边照样看得见」
  const off = offSet(ctx.settings);

  for (const cap of CAPS) {
    if (off.has(cap.id) && !PROTOCOL.has(cap.id)) continue;
    if (!onFor(cap)) continue;
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
