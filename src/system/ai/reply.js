import { messages, messagesOf, chats, characters, files, images, settings } from '../db/index.js';
import * as group from '../group.js';
import * as badges from '../badges.js';
import { uid } from '../store.js';
import * as imageSvc from './image.js';
import { isAbort } from './queue.js';
import * as imgPrompt from './imageprompt.js';
import { activeImage } from './services.js';
import { isImageReady } from './image.js';
import * as voiceSvc from './voice.js';
import * as videoSvc from './video.js';
import * as services from './services.js';
import * as clip from '../clip.js';
import * as promptwrite from './promptwrite.js';
import { isVoiceReady } from './voice.js';
import { byName as stickerByName, markUsed } from '../stickers.js';
import { notify } from '../notify.js';
import { nav } from '../nav.js';
import * as transfer from '../transfer.js';
import * as place from '../place.js';
import * as gift from '../gift.js';
import * as music from '../music.js';
import { releaseImages } from '../purge.js';
import * as space from '../space.js';
import * as dayStore from '../day.js';
import * as extras from '../extras.js';
import * as avatar from '../avatar.js';
import * as remark from '../remark.js';
import * as recall from '../recall.js';
import * as takeout from '../takeout.js';
import * as ban from '../ban.js';
import * as todo from '../todo.js';
import * as trip from '../trip.js';
import * as translate from './translate.js';
import * as ledger from '../ledger.js';
import * as request from '../request.js';
import * as theirs from '../theirs.js';
import { cropKept } from './tasks/phone.js';
import * as mcpTools from '../mcptools.js';
import * as closetLib from '../closet.js';
import * as closetStory from '../closet-story.js';
import * as htmlcard from '../htmlcard.js';
import { foldMarks } from '../markfold.js';

// 角色回复里可以带这几种标记，由模型自己决定什么时候用。
// 中英文冒号都认，方括号也认全角。
// 「约定完成」必须排在「约定」前面 —— 交替是从左往右试的，反过来写
// 「约定完成：早点睡」会先被「约定」吃掉，剩下「完成：早点睡」当成内容。
const MARK = /[[【]\s*(图片|照片|image|pic|视频|video|语音|voice|audio|表情|sticker|emoji|转账|transfer|位置|定位|location|礼物|gift|点歌|建歌单|加入歌单|分享歌曲|分享音乐|调用|tool|约定完成|约定|pact|信|letter|事项完成|事项取消|心声|换头像|改备注|备注|外卖|请客|代付|申请|亲属卡|旅行|攻略|待办|todo|授予|award|搭配|outfit|换上|借走|借给你|归还|旁白|narration|改密码|卡片|card)\s*[:：]\s*([^\]】]+)[\]】]/gi;

const IMAGE_KINDS = new Set(['图片', '照片', 'image', 'pic']);
// 「视频通话」那一格叫 video，这里是会话里那一段片子，两回事。
// **MARK 里认了几个词，这里就要收几个**：少收一个，那一条会顺着 if 链
// 一路掉到最后的 voice 分支，变成一段语音
const CLIP_KINDS = new Set(['视频', 'video']);
const STICKER_KINDS = new Set(['表情', 'sticker', 'emoji']);
const TRANSFER_KINDS = new Set(['转账', 'transfer']);
const PLACE_KINDS = new Set(['位置', '定位', 'location']);
const TODO_KINDS = new Set(['待办', 'todo']);
const GIFT_KINDS = new Set(['礼物', 'gift']);
const PICK_KINDS = new Set(['点歌']);
const PACT_KINDS = new Set(['约定', 'pact']);
const PACTDONE_KINDS = new Set(['约定完成']);
const LETTER_KINDS = new Set(['信', 'letter']);
const AWARD_KINDS = new Set(['授予', 'award']);
const OUTFIT_KINDS = new Set(['搭配', 'outfit']);
const NARRATION_KINDS = new Set(['旁白', 'narration']);
const LOCK_KINDS = new Set(['改密码']);
// 剧情里的衣帽间：换上、借走、借给你、归还（system/closet-story.js，ARCHITECTURE 4.217）
const CLOSET_ACT_KINDS = new Set(['换上', '借走', '借给你', '归还']);
const ITEM_DONE_KINDS = new Set(['事项完成']);
const ITEM_DROP_KINDS = new Set(['事项取消']);
const INNER_KINDS = new Set(['心声']);
const WEAR_KINDS = new Set(['换头像']);
const REMARK_KINDS = new Set(['备注', '改备注']);
// 三种点法各一个词。谁吃、谁付都写在词里，正文只剩「吃什么 多少钱」
const TAKEOUT_KINDS = new Map([['外卖', takeout.SELF], ['请客', takeout.TREAT], ['代付', takeout.ASK]]);
const LIST_KINDS = new Set(['建歌单']);
const ADDLIST_KINDS = new Set(['加入歌单']);
const SHARE_SONG_KINDS = new Set(['分享歌曲', '分享音乐']);
const CALL_KINDS = new Set(['调用', 'tool']);

// [调用：名字 {JSON 参数}]。参数是一段 JSON，里面常有方括号（数组）与换行，
// MARK 那条正则在第一个 ] 就收口了。所以先单独扫一遍：按花括号配对（认得字符串里的
// 括号与转义）把整段取出来，原位换成 [调用：#序号]，再交给下面那一套。
const CALL_HEAD = /[[【]\s*(?:调用|tool)\s*[:：]\s*/gi;

// 从 at 那个 { 开始，找到与它配对的 } 的位置。没配上返回 -1
function braceEnd(s, at) {
  let depth = 0;
  let str = false;
  let esc = false;
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') str = true;
    else if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function liftCalls(text) {
  const calls = [];
  let out = '';
  let last = 0;
  let m;
  CALL_HEAD.lastIndex = 0;
  while ((m = CALL_HEAD.exec(text))) {
    let i = m.index + m[0].length;
    let j = i;
    while (j < text.length && !/[\s{\]】]/.test(text[j])) j++;
    const name = text.slice(i, j).trim();
    let k = j;
    while (k < text.length && /\s/.test(text[k])) k++;
    let args = {};
    let bad = '';
    if (text[k] === '{') {
      const end = braceEnd(text, k);
      if (end < 0) continue;
      const raw = text.slice(k, end + 1);
      try {
        const v = JSON.parse(raw);
        if (v && typeof v === 'object' && !Array.isArray(v)) args = v; else bad = raw;
      } catch { bad = raw; }
      k = end + 1;
      while (k < text.length && /\s/.test(text[k])) k++;
    }
    if (!name || (text[k] !== ']' && text[k] !== '】')) continue;
    out += `${text.slice(last, m.index)}[调用：#${calls.length}]`;
    calls.push({ name, args, bad });
    last = k + 1;
    CALL_HEAD.lastIndex = last;
  }
  return { text: out + text.slice(last), calls };
}
// HTML 卡片（ARCHITECTURE 4.250）。角色写的是一整段：
//   [卡片：名字]
//   字段：值
//   [/卡片]
// 逐行分条那一套会把它拆成好几个气泡，所以和 [调用：…] 一样先整段摘出来，原位换成 [卡片：#序号]。
// 漏写收尾的：往下只收「像字段」的几行（名字：值），碰到别的就停，免得把后面的话吞进卡片。
const CARD_KINDS_MARK = new Set(['卡片', 'card']);
const CARD_HEAD = /[[【]\s*(?:卡片|card)\s*[:：]\s*([^\]】\n#][^\]】\n]*?)\s*[\]】]/gi;
const CARD_END = /[[【]\s*\/\s*(?:卡片|card)\s*[\]】]/i;
const FIELD_LINE = /^[^：:\n[【]{1,24}[：:]/;

function liftCards(text) {
  const cards = [];
  let out = '';
  let last = 0;
  let m;
  CARD_HEAD.lastIndex = 0;
  while ((m = CARD_HEAD.exec(text))) {
    const name = m[1].trim();
    const from = m.index + m[0].length;
    const rest = text.slice(from);
    const end = rest.search(CARD_END);
    let body;
    let stop;
    if (end >= 0) {
      body = rest.slice(0, end);
      stop = from + end + rest.slice(end).match(CARD_END)[0].length;
    } else {
      const lines = rest.split('\n');
      const kept = [];
      let used = 0;
      // 标题那一行后面同一行里剩下的（通常是空的）
      used += lines[0].length + 1;
      if (lines[0].trim()) kept.push(lines[0]);
      for (let i = 1; i < lines.length; i++) {
        if (!FIELD_LINE.test(lines[i].trim())) break;
        kept.push(lines[i]);
        used += lines[i].length + 1;
      }
      body = kept.join('\n');
      stop = Math.min(text.length, from + used);
    }
    out += `${text.slice(last, m.index)}\n[卡片：#${cards.length}]\n`;
    cards.push({ name, body: body.replace(/^\n+|\n+$/g, '') });
    last = stop;
    CARD_HEAD.lastIndex = stop;
  }
  return { text: out + text.slice(last), cards };
}

const TRIP_KINDS = new Set(['旅行']);
const PLAN_KINDS = new Set(['攻略']);
const ASK_KINDS = new Set(['申请']);
const CARD_KINDS = new Set(['亲属卡']);

// 转账那一条里，金额在前，后面随手写的是留言
const AMOUNT = /^\s*(?:[¥￥$]\s*)?(\d+(?:\.\d{1,2})?)\s*(?:元|块)?\s*(.*)$/;

// 收下或退回对方转过来的那一笔。必须带方括号 —— 不带的话，
// 「退回」两个字单独成行的正常句子也会被当成指令。
const SETTLE_LINE = /^[[【(（]\s*(收款|收下|接收|退回|退还)\s*[\]】)）]$/;

// 答应或者不答应对方提的那次出行。同样和别的几样各用一套词
const JOIN_LINE = /^[[【(（]\s*(?:同行|一起去|去)\s*[\]】)）]$/;
const SKIP_LINE = /^[[【(（]\s*(?:不去|去不了|算了)\s*[\]】)）]$/;

// 处理对方点的那一单。和收款、拆礼物各用一套词：一段对话里转账、礼物、
// 外卖可能同时挂着，共用一个词就分不清在处理哪一个。
//
// 特别注意**不能用「收下」** —— 那个词归转账。共用的话，外卖那一单会被
// 当成转账去处理，而那边根本没有待处理的转账，于是什么都没发生，还不报错。
const TAKE_LINE = /^[[【(（]\s*(?:要了|吃了|签收)\s*[\]】)）]$/;
const NOPE_LINE = /^[[【(（]\s*(?:不要|不用了|不吃)\s*[\]】)）]$/;

// 拆礼物。和收款分开两套 —— 「退回」退的是钱，「拒收」拒的是礼物，
// 一段对话里两样可能同时挂着，共用一个词就分不清在处理哪一个。
const OPEN_LINE = /^[[【(（]\s*(拆开|拆|打开|拆礼物)\s*[\]】)）]$/;
const REFUSE_LINE = /^[[【(（]\s*(拒收|不收|退掉)\s*[\]】)）]$/;

// 拉着一起听歌。同样必须带方括号。
const LISTEN_LINE = /^[[【(（]\s*(一起听|一起听歌|听歌)\s*[\]】)）]$/;

// 一起看时控制播放的三行。它们会真的作用到播放器上，所以写法要严：
// 整行只能是这一个标记，多一个字都不算。
const PAUSE_LINE = /^[[【(（]\s*(?:暂停|暂停一下)\s*[\]】)）]$/;
const RESUME_LINE = /^[[【(（]\s*(?:继续|继续播放|接着看)\s*[\]】)）]$/;
const REWIND_LINE = /^[[【(（]\s*(?:倒回|回到|快进)\s*[:：]\s*([\d:：.]+)\s*[\]】)）]$/;

/**
 * 「整行就是它」那一类标记：拍一拍、掷骰子、开通共同账户、批准、去电。
 * 都是**一件事**，不是一条消息，所以本来不带冒号。
 *
 * 但模型写出来常有三种走形，一个都不认就整行掉成普通文本：
 *
 *   1. `1. [骰子]`      前面自己加了序号
 *   2. `[骰子]。`        后面跟了个标点
 *   3. `[骰子：谁先说]`   括号里多写了一句话
 *
 * 前两种译文那几条早就认了（见 `TRANS_HEAD`），这里照同一套认；
 * 第三种把冒号后面那段直接丢掉 —— 这类标记本来就没有正文可带。
 *
 * **掉一次的代价不止是多一个丑气泡**：那一行会变成一条普通正文，
 * 于是它排进了「等着配译文」的队伍，后面每一句译文都挂错一条
 *（见 `attachTrans`）。一个骰子能把整轮的翻译全带歪。
 */
const lineMark = words => new RegExp(
  `^(?:\\d+\\s*[.、)）]\\s*)?`          // 前面的序号
  + `[[【(（]\\s*(?:${words})\\s*`         // 标记本身
  + `(?:[:：][^\\]】)）]*)?`                // 括号里多写的那一句，丢掉
  + `\\s*[\\]】)）]\\s*[。．.!！~～]?$`,   // 收口，以及后面跟的标点
  'i');

const PAT_LINE = lineMark('拍一拍|拍拍|戳一戳');
// 撤回刚发的那一条，和撤回自己最近一条动态（见 system/recall.js）。
// 「撤回动态」要先认：两个都以「撤回」开头
const RECALL_POST_LINE = lineMark('撤回动态|删除动态');
const RECALL_LINE = lineMark('撤回|撤回消息|撤回上一条');
// 共同账户与亲属卡那一套。开通只有一个词，批驳各一个词。
const JOINT_LINE = lineMark('开通共同账户|开共同账户');
const OKAY_LINE = lineMark('批准|同意|通过');
const DENY_LINE = lineMark('驳回|拒绝|不同意');
const DICE_LINE = lineMark('骰子|掷骰子|扔骰子|dice');

// 打个电话过来。同样必须带方括号。写「视频去电」就是视频通话。
//
// 提示词里写的是「去电」：这一行是角色自己拨出去的动作，站在它那一边看是去电，
// 「来电」是用户那边收到的结果。两个词都认，免得模型偶尔写回旧的那个。
const RING_LINE = lineMark('(视频)?(?:去电|来电|打电话|拨打|通话|call)');

// 往自己那台手机的相册里存一张。**不是一条消息** —— 对面看不到这张照片，
// 落下来的是一行提示（notice），和拍一拍同一类。
// 开关在「角色手机 - 相册」那一页，默认关着；关着的时候提示词里根本没有这一条，
// 所以正常不会出现。真出现了也照存 —— 用户自己写模板要它这么干是他的自由。
const KEEP_LINE = /^[[【(（]?\s*(?:存图|存照片)\s*[:：]\s*(.+?)[\]】)）]?\s*$/i;

// ---- 引用 ----
//
// 引用挂在它下面那一条上，不自己占一个气泡。标准写法是单独一行 [引用：摘录]，
// 但模型常写走样，从前那条正则只认整行、摘录里不许有括号，于是：
//
//   [引用：（摸摸头）好乖]      摘录里有动作括号 —— 本项目的动作正是写在（）里
//   [引用：你说的那句] 好啊      标记和正文写在同一行
//   (in reply to 「…」) 好啊    照着历史里的写法抄（历史从前就是这么给它看的）
//   【引用】「…」 / > 摘录        没冒号、用了别的记号
//
// 这几种都会整行当正文漏进气泡，「修正格式」用的是同一套解析，也修不动。
// 现在逐个认：给回 { quote, rest }，rest 是同一行里跟在后面的正文，交回去照常处理。
const QUOTE_WORD = '(?:引用|回复|quote|reply(?:ing)?(?:\\s+to)?|in\\s+reply\\s+to)';
const QUOTE_OPEN = new RegExp(`^(?:\\d+\\s*[.、)）]\\s*)?([[【(（])\\s*${QUOTE_WORD}\\s*([:：]?)`, 'i');
const CLOSE_OF = { '[': ']', '【': '】', '(': ')', '（': '）' };
// 摘录外面常多包一层引号，认领出处前剥掉
const unwrapQuote = q => String(q || '').trim()
  .replace(/^[「『“"'‘]+|[」』”"'’]+$/g, '').trim();

export function quoteOfLine(line) {
  const t = String(line || '').trim();
  // Markdown 那种「> 摘录」：整行都是摘录。> 后面要有空格 —— >_< 这类颜文字不算
  const md = t.match(/^>\s+(.+)$/);
  if (md) return { quote: unwrapQuote(md[1]), rest: '' };
  const m = t.match(QUOTE_OPEN);
  if (!m) return null;
  const open = m[1];
  const close = CLOSE_OF[open];
  const alt = open === '[' ? '】' : open === '【' ? ']' : open === '(' ? '）' : ')';
  let i = m[0].length;
  // 冒号之后到配对的收口为止都是摘录。按深度数括号：摘录里的（动作）不算收口
  if (m[2]) {
    let depth = 0;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (c === open) depth++;
      else if (c === close || c === alt) {
        if (depth === 0) {
          const quote = unwrapQuote(t.slice(i, j));
          return quote ? { quote, rest: t.slice(j + 1).trim() } : null;
        }
        depth--;
      }
    }
    // 没收口：整行剩下的都是摘录
    const quote = unwrapQuote(t.slice(i));
    return quote ? { quote, rest: '' } : null;
  }
  // 没冒号：[引用] 后面紧跟「摘录」，或者 (in reply to 「摘录」) 这种摘录在括号里面
  const inner = t.slice(i).match(/^\s*[「『“"]([^」』”"]+)[」』”"]\s*/);
  if (inner) {
    let rest = t.slice(i + inner[0].length);
    if (rest.startsWith(close) || rest.startsWith(alt)) rest = rest.slice(1);
    return { quote: inner[1].trim(), rest: rest.trim() };
  }
  const tag = t.slice(i).match(/^\s*[\]】)）]\s*[「『“"]([^」』”"]+)[」』”"]\s*/);
  if (tag) return { quote: tag[1].trim(), rest: t.slice(i + tag[0].length).trim() };
  return null;
}

// 译文也单独成行，不占气泡，收在消息的 translation 字段里，点原文气泡才展开。
//
// ---- 认得宽一点，宁可认错也不要漏 ----
//
// 认不出来的那一行会当正文渲染出去，于是屏幕上原文后面紧跟着一条一模一样
// 意思的消息 —— 用户看到的就是「莫名其妙重复发了一遍译文」。所以这里把
// 模型真会写出来的那几种走样都认下来：
//
//   1. [译文：…]   照模板写的
//   2. 译文：…      方括号掉了
//   3. 1. [译文：…] 前面自己加了序号
//   4. [译文]       标签单独一行，正文在下一行
//   5. [译文：这一句很长      整段没收尾，右括号落在下一行
//
// 标签四种写法（译文 / 翻译 / 译 / translation），冒号全角半角都认。
const TRANS_HEAD = /^(?:\d+\s*[.、)）]\s*)?([[【(（]?)\s*(?:译文|翻译|译|translation)\s*([:：]?)\s*([\s\S]*)$/i;
const CLOSER = { '[': ']', '【': '】', '(': ')', '（': '）' };

/**
 * 这一行是不是一句译文。是就给出正文，以及**这个括号在这一行里收没收口**。
 * 没收口的要接着读下一行 —— 不然后半截会当成一条消息发出去。
 */
function transOf(line) {
  const m = String(line).match(TRANS_HEAD);
  if (!m) return null;
  // 冒号和方括号总得有一个。两样都没有的「翻译」是角色说的话，不是标记
  if (!m[1] && !m[2]) return null;
  const close = CLOSER[m[1] || ''];
  let body = (m[3] || '').trim();
  const closed = !close || body.endsWith(close);
  if (close && closed) body = body.slice(0, -close.length).trim();
  return { body, close, closed };
}

/**
 * 一条语音里夹着的译文。
 *
 * 规则里写的是「语音那一行下面另起一行写译文」，但模型很常把译文塞进语音的括号里：
 *
 *   [语音：元気だよ（译文：我很好）]
 *   [语音：元気だよ [译文：我很好]]
 *   [语音：元気だよ          （括号没收口，下一行的 [译文：…] 被当成语音的后半截）
 *   [译文：我很好]
 *
 * 不拆开的话，送去语音接口的是整段 —— **译文被一起念出来**。
 * 所以带「译文：」标签的那一截一律切出去，收进这条语音的 translation；
 * 用户自己配的行内形状（原文（译文）之类）同样认。都不像就原样念。
 *
 * 旧消息里已经混进去的，重新生成语音时也过一遍（见 generateVoice）。
 */
const VOICE_TRANS = /\s*[[【(（]?\s*(?:译文|翻译|译|translation)\s*[:：]/i;
export function splitVoiceText(body, forms = translate.compiled()) {
  let text = String(body || '').trim();
  let translation = '';
  const at = text.search(VOICE_TRANS);
  if (at > 0) {
    translation = text.slice(at).replace(VOICE_TRANS, '').replace(/[\]】)）]+\s*$/, '').trim();
    text = text.slice(0, at).trim();
  } else {
    const inline = translate.splitInline(text, forms);
    if (inline) { text = inline.text; translation = inline.translation; }
  }
  return { text, translation };
}

function voicePart(body, forms) {
  const v = splitVoiceText(body, forms);
  return { type: 'voice', text: v.text, ...(v.translation ? { translation: v.translation } : {}) };
}

// 时间行同理。让模型自己写一遍当地时间，是目前最靠谱的时间感知 ——
// 写过一遍才算真看见。但它是给模型自己定位用的，不该显示给用户，
// 所以这里剥掉，只把内容记在消息上，回头再塞回上下文（见 engine.buildHistory）。
//
// 模型多半会照着模板写 [时间：…]，但也常常只丢一个 [2026-01-01 周三 14:30]，
// 标签说掉就掉。两种都得认 —— 认不出来那一行就当正文渲染出去了，
// 而且它挡在最前面，后面那行引用标记也跟着剥不掉，整条消息全乱。
const INNER_LINE = /^[[【(（]?\s*(?:心声|内心|inner)\s*[:：]\s*(.+?)[\]】)）]?\s*$/i;
// 标签认三种写法：简体「时间」、日文与繁体的「時間」、英文 time。
// **角色说什么语言，标记就跟着变成什么语言** —— 说日语的角色写的是
// [時間：…]，认不出来那一行就当正文渲染出去了，而且它挡在最前面，
// 后面那行引用标记也跟着剥不掉，整条消息全乱。
// 只由数字和时间用字构成，且确实带着钟点或日期的样子。
// 日文那几个字（時 分 曜 午前午後）也算进来：标签说掉就掉的时候靠这一条
const TIMEISH = /^[\d\s:：\-/.年月日时分秒時曜周一二三四五六天上下午前後aApPmM]+$/;
const isTimeStamp = t => /[:：]/.test(t) || /\d{4}[-/.]\d/.test(t);
const STAMP_LABEL = /^(?:时间|時間|time)\s*[:：]\s*(.*)$/i;

// 括号里那一段是不是一个时刻。带标签的（时间：…）与光秃秃的（14:30）都算。
// 返回时刻本身，不是的返回空。
function stampBody(inner) {
  const t = String(inner || '').trim();
  if (!t || t.length > 40) return '';
  const m = t.match(STAMP_LABEL);
  const body = (m ? m[1] : t).trim();
  if (!body || !/\d/.test(body) || !TIMEISH.test(body) || !isTimeStamp(body)) return '';
  return body;
}

// 带标签的，四种括号都认：[时间：…] 【時間：…】（time: …）(时间：…)
const STAMP_LABELLED = /[[【(（]\s*(?:时间|時間|time)\s*[:：][^\n\]】)）]{0,40}[\]】)）]/gi;
// 光秃秃的，**只认方括号**：[2026-01-01 周三 14:30] 【14:30】
// 圆括号不认 —— 「(14:30)」在正文里也可能是人自己写的，方括号那两种不会
const STAMP_BARE = /[[【]\s*([^\n\]】]{1,40}?)\s*[\]】]/g;

/**
 * 把时刻从正文里摘掉，只留第一个记在消息上。
 *
 * **不是只摘整行。** 从前这里按行匹配，整行就是一个时间戳才摘得掉；
 * 模型常常把它和第一句话写在同一行（`[時間：04:06]写真の日付が…`），
 * 那样整行匹配不上，时间戳就当正文渲染出去了 —— 这是用户实际撞见的样子。
 *
 * 现在是**行内摘**：一行里所有长得像时刻的括号都拿掉，剩下的才是正文。
 * 摘完空掉的那一行整行丢掉，所以「整行就是一个时间戳」自然也包含在内，
 * 不必再写第二套规则。
 */
export function stripStamps(raw) {
  const stamps = [];
  const kept = [];
  const take = body => { if (body && !stamps.length) stamps.push(body); };

  for (const line of String(raw || '').split('\n')) {
    const cleaned = line
      .replace(STAMP_LABELLED, whole => {
        const body = stampBody(whole.slice(1, -1));
        // 带标签却不像时刻（[时间：等一下]）就留着，那是它说的话
        if (!body) return whole;
        take(body);
        return '';
      })
      .replace(STAMP_BARE, (whole, inner) => {
        const body = stampBody(inner);
        if (!body) return whole;
        take(body);
        return '';
      })
      .trim();
    // 整行只有一个时刻，摘完就空了，这一行不留
    if (cleaned) kept.push(cleaned);
  }
  return { text: kept.join('\n'), stamp: stamps[0] || '' };
}

// ---- 自检 ----
//
// 模型在 <thinking> 里逐条检查完再说话（见 skeleton.think）。
// 那一段是给它自己看的，不进对话，也不进上下文。
//
// 闭合标签漏写时，从开标签到结尾整段都当成自检内容丢掉。
// 代价是这一轮可能整个变空，报「模型返回了空内容」；
// 但另一种做法是把整张检查清单原样发给用户，那更糟。
const THINK = /<\s*(thinking|think)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
const THINK_OPEN = /<\s*(?:thinking|think)\s*>([\s\S]*)$/i;

export function stripThink(raw) {
  const found = [];
  let text = String(raw || '').replace(THINK, (_, tag, body) => {
    found.push(String(body).trim());
    return '';
  });
  const open = text.match(THINK_OPEN);
  if (open) {
    found.push(String(open[1]).trim());
    text = text.slice(0, open.index);
  }
  return { text: text.trim(), think: found.filter(Boolean).join('\n\n') };
}

// ---- 兜底分条 ----
//
// 规则写了「换行即分条」，但模型有时候就是回一整段。光靠 prompt 保证不了，
// 所以本地补一刀：**整轮只有一行、而且长**的时候，照标点断开。
//
// 只在「一行」的时候动手。模型自己已经分好条的，一个字都不碰 ——
// 它分得比标点准，那是它的判断，不该被规则推翻。
//
// 先按句末标点断；断完还是太长的，再按逗号断。句号在聊天里多半不写，
// 断完去掉；问号叹号是语气，留着。
const SENT = /(?<=[。！？!?…])/;
const CLAUSE = /(?<=[，,、；;])/;

const tidy = t => t.trim().replace(/[。，,、；;]+$/, '').trim();

export function autoSplit(text, limit) {
  const t = String(text || '').trim();
  const n = Math.max(0, Math.round(Number(limit) || 0));
  if (!n || t.length <= n) return [t];
  // 带标记的那种不动：[图片：…] 被切开就废了
  if (/[[【]/.test(t)) return [t];

  const out = [];
  for (const sent of t.split(SENT)) {
    const s1 = sent.trim();
    if (!s1) continue;
    if (s1.length <= n) { out.push(s1); continue; }
    // 还是太长，按逗号再断一次。断完仍然过长的就随它去，
    // 硬按字数切会把词切断，那比一整句更难看
    let buf = '';
    for (const part of s1.split(CLAUSE)) {
      if (!part.trim()) continue;
      if ((buf + part).length > n && buf) { out.push(buf); buf = part; }
      else buf += part;
    }
    if (buf.trim()) out.push(buf);
  }
  return out.map(tidy).filter(Boolean);
}

// 引用块只留一小段，长了在气泡上顶掉正文
export function snippet(text, max = 40) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// 把一整段回复拆成按顺序排列的若干条。空行分段，标记单独成条。
// 模型写的 12:30 / 1:02:03 读成秒。写不成数的当没写。
function subtitleSeconds(text) {
  const t = String(text || '').trim().replace(/：/g, ':');
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(x => Number(x));
  if (!parts.length || parts.some(x => !Number.isFinite(x))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function splitReply(raw) {
  // 先摘自检，再摘时间戳：自检里也可能出现方括号时间，
  // 反过来会把检查内容里的东西当成这一轮的时刻
  const { text: spoken } = stripThink(raw);
  // 标记名写成繁体的（[事項完成：…]）先换成简体，见 system/markfold.js
  const { text: unstamped, stamp } = stripStamps(foldMarks(spoken.trim()));
  if (!unstamped.trim()) return [];
  const lifted = liftCalls(unstamped);
  const calls = lifted.calls;
  const { text, cards } = liftCards(lifted.text);

  const parts = [];
  let last = 0;
  // 读到的引用行先记着，挂到紧随其后的那一条上
  let pendingQuote = null;
  // 行内译文那几条正则整轮编译一次，不要每行都重来
  const inlineForms = translate.compiled();

  // 读到的译文在等一条正文（模型先写了译文、后写原文时会这样）
  let pendingTrans = null;
  // 括号没收口的那一句译文，接着往下读
  let waitTrans = null;
  // 只写了「[译文]」这个标签，正文在下一行
  let transNext = false;

  // 心声在等一条正文（写在旁白、表情、图片后面，或整轮开头时会这样）
  let pendingInner = '';
  // 心声挂到**最近一条正文**上，不是刚落下的那一条。开了旁白之后模型常见的写法是
  // 先一行 [旁白：…] 再一行 [心声：…]，挂到旁白上等于丢掉：旁白画成一行小字，
  // 不画心声，点头像找到的也是它。前面一条正文都没有就先记着，下一条正文落下来时补上
  const attachInner = body => {
    const text = String(body || '').trim();
    if (!text) return;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type === 'text') { parts[i].inner = text; return; }
    }
    pendingInner = text;
  };

  const push = part => {
    if (pendingQuote) { part.quote = pendingQuote; pendingQuote = null; }
    if (pendingInner && part.type === 'text') { part.inner = pendingInner; pendingInner = ''; }
    if (pendingTrans && (part.type === 'text' || part.type === 'voice') && !part.translation) {
      part.translation = pendingTrans; pendingTrans = null;
    }
    parts.push(part);
  };

  /**
   * 一句译文挂到哪一条上。
   *
   * **按出现的先后一一对上**：第 n 句译文配第 n 条还没有译文的正文。
   * 从前是「挂到刚落下的那一条」，那只在原文与译文交替出现时才对；
   * 模型很常见的另一种写法是**先把几条正文写完，再把译文一起补在后面**，
   * 那时每一句译文都挂在最后那一条上，前面几条就全是空的 ——
   * 看起来就是「一直在掉翻译」。按顺序配两种写法都对。
   *
   * 正文还没出现（译文写在原文上面）就先记着，下一条正文落下来时补上。
   */
  /**
   * 整行是一个方括号标记、却没被任何规则认走的那种。
   *
   * 它照旧落成一个气泡（丢掉的话，模型真想说的话也会跟着没），
   * **但它不该参与配译文** —— 一个标记里没有话可翻，让它占掉一句译文，
   * 后面每一条就全错位了。这是上面那些 `lineMark` 之外的第二道防线：
   * 走形的花样认不完，认漏了至少别把整轮翻译带歪。
   *
   * 只认方括号那两种。圆括号那两种太常出现在正文里（「（笑）」），
   * 拿它当标记会误伤。
   */
  const bareMark = t => /^[[【][^\]】]*[\]】]$/.test(String(t || '').trim());

  const attachTrans = body => {
    const text = String(body || '').trim();
    if (!text) return;
    // 语音也有话可翻，但只认**紧跟在它下面**的那一句：规则里语音不必带译文，
    // 没带的时候，后面那条正文的译文不该被它截走
    const tail = parts[parts.length - 1];
    const at = parts.find(p => p.type === 'text' && !p.translation && !bareMark(p.text))
      || (tail?.type === 'voice' && !tail.translation ? tail : null);
    if (at) { at.translation = text; return; }
    // 一条正文都还没有：译文写在了原文上面，记着，下一条正文落下来时补上。
    // 已经有别的东西（图片、表情那种标记）却没有正文可配，就丢掉 ——
    // 硬挂到后面某一条上，那一条拿到的是别人的译文，比没有更糟
    if (!parts.length) pendingTrans = text;
  };

  // 按空行分段。模型经常只按单换行分，那样整轮会黏成一条 ——
  // 所以单换行也算一次分条。真要在一条里换行，写成同一行或者用空格。
  const segments = chunk => String(chunk).split(/\n+/);

  const pushText = chunk => {
    segments(chunk).forEach(seg => {
      let t = seg.trim();
      if (!t) return;

      // 上一行那句译文还没收口，这一行是它的后半截。
      // 三行还没收口就按已经读到的算数 —— 再等下去只会把正文也吞进来
      if (waitTrans) {
        const done = t.endsWith(waitTrans.close);
        waitTrans.body = `${waitTrans.body} ${done ? t.slice(0, -waitTrans.close.length) : t}`.trim();
        waitTrans.left -= 1;
        if (done || waitTrans.left <= 0) { attachTrans(waitTrans.body); waitTrans = null; }
        return;
      }
      // 上一行只写了「[译文]」这个标签，这一行就是译文正文
      if (transNext) { transNext = false; attachTrans(t); return; }
      // 引用：记下来挂到下一条上，自己不占气泡。同一行后面还跟着正文的，
      // 正文照常往下走（见上面 quoteOfLine）
      const q = quoteOfLine(t);
      if (q) {
        pendingQuote = q.quote;
        if (!q.rest) return;
        t = q.rest;
      }

      // 处理对方转过来的那一笔。自己不占气泡，落的是一行提示。
      const st = t.match(SETTLE_LINE);
      if (st) { push({ type: 'settle', take: !/退/.test(st[1]) }); return; }

      // 拆礼物。同样不占气泡，落的是一行提示。
      if (OPEN_LINE.test(t)) { push({ type: 'unwrap', open: true }); return; }
      if (REFUSE_LINE.test(t)) { push({ type: 'unwrap', open: false }); return; }

      // 它要打电话过来。不占气泡 —— 电话是一件事，不是一条消息。
      const rg = t.match(RING_LINE);
      if (rg) { push({ type: 'ring', video: !!rg[1] }); return; }

      // 拉一起听。和电话一样是一件事不是一条消息，不占气泡。
      if (LISTEN_LINE.test(t)) { push({ type: 'listen' }); return; }

      // 一起看时动播放器。同样是一件事，不占气泡。
      if (PAUSE_LINE.test(t)) { push({ type: 'playback', act: 'pause' }); return; }
      if (RESUME_LINE.test(t)) { push({ type: 'playback', act: 'resume' }); return; }
      const rw = t.match(REWIND_LINE);
      if (rw) { push({ type: 'playback', act: 'seek', to: rw[1] }); return; }

      // 对方点的那一单，收下或者不要。不占气泡，落的是一行提示。
      if (TAKE_LINE.test(t)) { push({ type: 'meal', take: true }); return; }
      if (NOPE_LINE.test(t)) { push({ type: 'meal', take: false }); return; }

      // 对方提的那次出行，同行或者不去。和外卖、转账各用一套词 ——
      // 一段对话里可能同时挂着好几样，共用一个词就分不清在处理哪一个
      if (JOIN_LINE.test(t)) { push({ type: 'trip-go', join: true }); return; }
      if (SKIP_LINE.test(t)) { push({ type: 'trip-go', join: false }); return; }

      // 共同账户与亲属卡：开通、批准、驳回各一行，都不占气泡
      if (JOINT_LINE.test(t)) { push({ type: 'request', kind: request.JOINT }); return; }
      if (OKAY_LINE.test(t)) { push({ type: 'vote', ok: true }); return; }
      if (DENY_LINE.test(t)) { push({ type: 'vote', ok: false }); return; }

      // 撤回：和心声一样挂到刚刚那一条上，前面没有话就无从撤回。
      // 撤回动态是一件事，不占气泡
      if (RECALL_POST_LINE.test(t)) { push({ type: 'recall-post' }); return; }
      if (RECALL_LINE.test(t)) {
        const prev = parts[parts.length - 1];
        if (prev) prev.recall = true;
        return;
      }

      // 拍一拍落一行提示，骰子落一条自己的消息，两样都不占气泡。
      if (PAT_LINE.test(t)) { push({ type: 'pat' }); return; }
      const kp = t.match(KEEP_LINE);
      if (kp) { push({ type: 'keep', note: kp[1].trim() }); return; }
      if (DICE_LINE.test(t)) { push({ type: 'dice' }); return; }

      // 心声和译文一样，挂到刚刚那一条上 —— 它是那句话背后的那一层，
      // 前面没有话就无从谈起。
      const iv = t.match(INNER_LINE);
      if (iv) { attachInner(iv[1]); return; }

      // 译文。挂到第几条上由 attachTrans 按顺序配，这一行自己不占气泡。
      const tv = transOf(t);
      if (tv) {
        if (!tv.closed) { waitTrans = { body: tv.body, close: tv.close, left: 3 }; return; }
        if (tv.body) attachTrans(tv.body); else transNext = true;
        return;
      }

      // 用户自己配的「整行都是译文」那一类，例如 `（照片的日期全是乱的）`。
      // 和上面那条一样挂到上面那一条上 —— 只是它没有标签，所以得靠配置认。
      // 前面没有正文的丢掉：一句没有原文的译文挂不到任何地方
      const tline = translate.transLine(t, inlineForms);
      if (tline) { attachTrans(tline); return; }

      // 到这儿还没被任何标记认走，才轮到行内译文：用户自己配的那几个形状
      // （原文（译文）、原文｜译文 之类）。**放在最后** —— 前面那些标记的
      // 形状更确定，让它先抢会把引用、心声这类整行吞掉。
      // 一条都没配时 splitInline 直接返回 null，不猜。
      const inline = translate.splitInline(t, inlineForms);
      if (inline) {
        push({ type: 'text', text: inline.text, translation: inline.translation });
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
      if (PICK_KINDS.has(kind)) {
        push({ type: 'pick', name: body });
      } else if (LIST_KINDS.has(kind) || ADDLIST_KINDS.has(kind)) {
        // 竖线前是歌单名，后面是要放进去的歌，几首之间用；或、隔开。
        // 建歌单可以不带歌；加入歌单不带歌就没有意义，丢掉
        const i = body.search(/[|｜]/);
        const name = (i < 0 ? body : body.slice(0, i)).trim();
        const songs = i < 0 ? [] : body.slice(i + 1).split(/[；;\n]+/).map(x => x.trim()).filter(Boolean);
        if (name && (LIST_KINDS.has(kind) || songs.length)) push({ type: 'newlist', name, songs });
      } else if (SHARE_SONG_KINDS.has(kind)) {
        push({ type: 'song', query: body });
      } else if (CARD_KINDS_MARK.has(kind)) {
        const c = /^#\d+$/.test(body) ? cards[Number(body.slice(1))] : null;
        if (c) push({ type: 'card', ...c });
      } else if (CALL_KINDS.has(kind)) {
        const c = /^#\d+$/.test(body) ? calls[Number(body.slice(1))] : null;
        if (c) push({ type: 'tool', ...c });
      } else if (TRIP_KINDS.has(kind)) {
        // 去哪儿读不出来就整条丢掉。一次没有目的地的出行比少发一条更怪
        const o = trip.parse(body);
        if (o && o.where) push({ type: 'trip', ...o });
      } else if (PLAN_KINDS.has(kind)) {
        push({ type: 'plan', title: body.slice(0, 40) });
      } else if (TAKEOUT_KINDS.has(kind)) {
        const o = takeout.parse(body);
        // 吃什么读不出来就整条丢掉。一单没有内容的外卖比少发一条更怪
        if (o && o.item) push({ type: 'takeout', kind: TAKEOUT_KINDS.get(kind), ...o });
      } else if (ASK_KINDS.has(kind)) {
        // 「买机票 2000」：和外卖同一种拆法，最后一个数是金额
        const o = takeout.parse(body);
        if (o && o.amount > 0) {
          push({ type: 'request', kind: request.SPEND, amount: o.amount, note: o.item });
        }
      } else if (CARD_KINDS.has(kind)) {
        const o = takeout.parse(body);
        if (o && o.amount > 0) push({ type: 'request', kind: request.CARD, amount: o.amount });
      } else if (INNER_KINDS.has(kind)) {
        attachInner(body);
      } else if (WEAR_KINDS.has(kind)) {
        push({ type: 'wear', name: body });
      } else if (REMARK_KINDS.has(kind)) {
        push({ type: 'remark', name: body });
      } else if (ITEM_DONE_KINDS.has(kind)) {
        push({ type: 'agenda', state: dayStore.DONE, title: body });
      } else if (ITEM_DROP_KINDS.has(kind)) {
        push({ type: 'agenda', state: dayStore.DROP, title: body });
      } else if (PACT_KINDS.has(kind)) {
        push({ type: 'pact', title: body });
      } else if (PACTDONE_KINDS.has(kind)) {
        push({ type: 'pactdone', title: body });
      } else if (AWARD_KINDS.has(kind)) {
        // 竖线前是标识的名字，后面是理由。没写竖线就整段是名字
        const i = body.search(/[|｜]/);
        const name = (i < 0 ? body : body.slice(0, i)).trim();
        const reason = i < 0 ? '' : body.slice(i + 1).trim();
        if (name) push({ type: 'award', name, reason });
      } else if (LETTER_KINDS.has(kind)) {
        // 竖线前是信封上写的标题，后面是正文。不写竖线就整段都是正文。
        const i = body.search(/[|｜]/);
        const title = i < 0 ? '' : body.slice(0, i).trim();
        const text = (i < 0 ? body : body.slice(i + 1)).trim();
        if (text) push({ type: 'letter', title, text });
      } else if (LOCK_KINDS.has(kind)) {
        const i = body.search(/[|｜]/);
        push({ type: 'lockcode', code: (i < 0 ? body : body.slice(0, i)).trim(), why: i < 0 ? '' : body.slice(i + 1).trim() });
      } else if (NARRATION_KINDS.has(kind)) {
        push({ type: 'narration', text: body });
      } else if (CLOSET_ACT_KINDS.has(kind)) {
        push({ type: 'closetact', kind, name: body });
      } else if (OUTFIT_KINDS.has(kind)) {
        // 竖线前是这一套的名字，后面是几件单品。一件都没有就整条丢掉
        const o = closetLib.parseOutfit(body);
        if (o) push({ type: 'outfit', ...o });
      } else if (GIFT_KINDS.has(kind)) {
        const g = gift.parse(body);
        if (g) push({ type: 'gift', ...g });
      } else if (TODO_KINDS.has(kind)) {
        push({ type: 'todo', text: body });
      } else if (PLACE_KINDS.has(kind)) {
        const loc = place.parse(body);
        if (loc) push({ type: 'location', ...loc });
      } else if (TRANSFER_KINDS.has(kind)) {
        const a = body.match(AMOUNT);
        // 金额读不出来就整条丢掉。凭空造一笔金额不明的转账比少发一条更糟。
        if (a) push({ type: 'transfer', amount: Number(a[1]), note: (a[2] || '').trim() });
      } else {
        push(IMAGE_KINDS.has(kind) ? { type: 'image', prompt: body }
          : CLIP_KINDS.has(kind) ? { type: 'clip', prompt: body }
          : STICKER_KINDS.has(kind) ? { type: 'sticker', name: body }
          : voicePart(body, inlineForms));
      }
    }
    last = m.index + m[0].length;
    // [语音：原话 [译文：…]] 这种套了一层的：正则在里面那个右括号就收了口，
    // 外面那个落单，会自己成一个只有「]」的气泡
    if (/[[【][^\]】]*$/.test(m[2]) && /^[\]】]/.test(text.slice(last))) last += 1;
  }
  pushText(text.slice(last));
  // 括号一直没收口就按已经读到的那半句算。少半个括号也好过把半句译文
  // 当成一条消息发出去
  if (waitTrans) { attachTrans(waitTrans.body); waitTrans = null; }

  // 整轮只拆出一条纯文字、而且很长：模型没照「换行即分条」办，本地补一刀。
  // 只在这一种情况下动手 —— 它自己分好条的不碰。
  const limit = Math.max(0, Math.round(Number(settings.get().autoSplitAt) ?? 0) || 0);
  if (limit && parts.length === 1 && parts[0].type === 'text' && !parts[0].quote) {
    const segs = autoSplit(parts[0].text, limit);
    if (segs.length > 1) {
      const { text: _drop, ...rest } = parts[0];
      parts.length = 0;
      segs.forEach((t, i) => parts.push(i === 0 ? { ...rest, type: 'text', text: t } : { type: 'text', text: t }));
    }
  }

  // 时间只挂在整轮第一条上
  if (stamp && parts.length) parts[0].stamp = stamp;
  return parts;
}

// 模型引用的是原话里的一小段，拿它回头去最近的消息里认领出处。
// 认不出来也不丢：原样存成 quoteText，气泡照样显示，只是点不动。
// turnId：正在写的这一轮。它自己的几条不算出处 —— 引的是之前说过的话；
// 修正格式重排一条旧消息时，那条消息的原文里正带着这段摘录，不排除就认领到自己
export function resolveQuote(chatId, text, turnId = '') {
  // 摘录尾巴上的省略号、外面包的引号不是原话的一部分
  const q = unwrapQuote(text).replace(/(…+|\.{3,})$/, '').replace(/\s+/g, '').trim();
  if (!q) return null;
  const recent = messages
    .where(m => m.chatId === chatId && m.content && !(turnId && m.turnId === turnId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 40);
  for (const m of recent) {
    const nm = String(m.content).replace(/\s+/g, '');
    if (nm && (nm.includes(q) || q.includes(nm))) return m;
  }
  return null;
}

// 引用字段统一在这里拼。存一份快照，原消息被删了也还看得见引的是什么。
export function quoteFields(chatId, quote, turnId = '') {
  const q = String(quote || '').trim();
  if (!q) return {};
  const src = resolveQuote(chatId, q, turnId);
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

/**
 * 钱不够就不让这一笔发生。
 *
 * 第一道关在 prompt（注入余额，见 ai/context/bill.js），这是第二道：
 * **模型说了不算，账上有没有才算。** 没绑账本、或者那本账关了严格模式，
 * 这里一律放行。
 *
 * 拦下来不是安静地吞掉 —— 落一行提示，角色下一轮看得见，
 * 知道自己这笔没付成。悄悄不发生比发生更难查。
 */
function broke(base, amount, what) {
  const owner = base.role === 'user' ? ledger.ME : ledger.CHAR;
  if (ledger.affordable(base.chatId, owner, amount)) return null;
  const book = ledger.bookOfChat(base.chatId);
  const acc = book && ledger.defaultFor(book.id, owner);
  const left = acc ? ledger.money(book.id, ledger.balanceOf(book.id, acc.id)) : '';
  return messages.create({
    ...base, kind: 'notice',
    content: `[余额不足，${what} 没有付成。当前余额 ${left}]`,
    status: 'done',
  });
}

// 一个 part 落成一条消息。图片语音顺带把生成任务排上。
// 单拎出来是因为「修格式」也要用同一条路，不然两边各写一遍迟早走岔。
/**
 * 用户刚发过来的那张图。没有就返回 null。
 *
 * 从后往前扫，跳过的只有**这一轮**角色自己刚落下的那几条（按 turnId 认），
 * 撞见别的角色消息就停。然后在紧挨着的那一段用户消息里取最新的一张图。
 *
 * **再往前就不是「刚发的」了。** 一开始我跳过了所有末尾的角色消息，
 * 于是上一轮存过的那张三条消息之后还会被再存一次 —— 测试里那条
 * 「隔了一条自己的消息之后就不再翻旧图」当场挂掉。
 */
function justSent(chatId, turnId) {
  const list = messagesOf(chatId);
  let hit = null;
  let inUser = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.role === 'user') {
      inUser = true;
      if (m.imageId && !hit) hit = m.imageId;
      continue;
    }
    if (inUser) break;
    // 这一轮自己刚落下的跳过；上一轮的说明用户那段已经过去了
    if (!turnId || m.turnId !== turnId) break;
  }
  return hit;
}

/**
 * 角色往自己的歌单里放歌（建歌单、加入歌单）。
 *
 * 歌单挂在角色名下（owner 是角色 id），不存在就建一个。每首歌照分享那一套找：
 * 曲库里没有、配了网易云就去搜一首收进来。做完落一行提示，告诉人它放了什么、
 * 哪几首没找到 —— 不然角色嘴上说「我建了个歌单」，人去看是空的，不知道为什么。
 *
 * **那一行提示当场落，找完再改字。** 从前是找完才落，网易云一搜一两秒，
 * 这一轮后面的话早就落下去了，提示排到了它们后面，顺序和角色写的对不上。
 */
// 一起听与点歌的队（见 materialize 里 listen / pick 两处）。**按轮排**：同一轮里先起播再点歌；
// 不同轮互不等 —— 上一轮点歌去网易云搜得慢，不该拖住下一轮的 [一起听]
const listenChains = new Map();
function inTurn(base, fn) {
  const k = `${base.chatId}:${base.turnId || ''}`;
  const next = (listenChains.get(k) || Promise.resolve()).then(fn);
  const done = next.catch(() => {});
  listenChains.set(k, done);
  done.then(() => { if (listenChains.get(k) === done) listenChains.delete(k); });
  return next;
}
let listenWanted = null;

function collect(base, name, queries) {
  let list;
  try { list = music.listNamed(base.authorId, name); }
  catch (err) { console.warn('[listen] 歌单没建成:', err.message || err); return; }
  const who = characters.get(base.authorId)?.name || '对方';
  const note = messages.create({
    chatId: base.chatId, role: 'char', authorId: base.authorId, turnId: base.turnId,
    kind: 'notice', status: 'done', playlistId: list.id,
    content: queries.length ? `[${who}正在整理歌单「${list.name}」]` : `[${who}新建了歌单「${list.name}」]`,
  });
  if (!queries.length) return;
  (async () => {
    const added = [];
    const had = [];
    const missed = [];
    const books = xs => xs.map(t => `《${t}》`).join('');
    for (const q of queries) {
      const song = await music.resolveSong(q).catch(() => null);
      if (!song) { missed.push(q); continue; }
      if (music.addTrack(list.id, song.id)) added.push(song.title);
      else had.push(song.title);
    }
    const bits = [];
    if (added.length) bits.push(`${who}把${books(added)}加入了歌单「${list.name}」`);
    if (had.length) bits.push(`${books(had)}已在歌单「${list.name}」中`);
    if (missed.length) bits.push(`${books(missed)}没有找到`);
    messages.update(note.id, { content: `[${bits.join('，')}]` });
  })().catch(err => console.warn('[listen] 歌单没放成:', err.message || err));
}

export function materialize(part, base, char) {
  // 待办不是一条消息，是一个等你点头的提议，所以不占气泡也不进聊天记录。
  // 落成待确认，由会话页问一句（见 system/todo.js）
  if (part.type === 'todo') {
    todo.propose({
      text: part.text, chatId: base.chatId, charId: char?.id,
      from: todo.FROM_CHAR,
      // 时刻可能在前面几句里说过，角色这一条只写了事（见 system/todo.js）
      near: messagesOf(base.chatId).slice(-6).map(m => m.content),
    });
    return null;
  }
  // 撤回自己最近一条动态。不是一条消息，不落气泡
  if (part.type === 'recall-post') {
    if (base.role === 'char' && char && char.canRecall !== false) {
      const mo = recall.latestMoment(char.id);
      if (mo) recall.recallMoment(mo.id);
    }
    return null;
  }
  const quote = quoteFields(base.chatId, part.quote, base.turnId);
  // 撤回那一条照常发出去，几秒后折起来（recall.charMark 的 at 在几秒之后）
  const takeBack = part.recall && base.role === 'char' && char?.canRecall !== false;
  const row = {
    ...base, ...quote,
    ...(takeBack ? { recalled: recall.charMark() } : {}),
    ...(part.stamp ? { stamp: part.stamp } : {}),
    // 模型自己给的译文和原文一模一样（本来就是那种语言）：不挂，免得点开是同一句
    ...(part.translation && !translate.sameText(part.translation, part.text) ? { translation: part.translation } : {}),
    ...(part.inner ? { inner: String(part.inner).slice(0, 300) } : {}),
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
    const short = broke(base, part.amount, `转账 ${transfer.format(part.amount)}`);
    if (short) return short;
    return transfer.send({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      amount: part.amount, note: part.note, extra: row,
    });
  }
  // 一起听、点歌、建歌单都不落消息 —— 它们改的是播放状态和曲库，不是对话内容。
  // 动态 import 的理由和电话一样：listen 要用 db，engine 要用本文件，静态引会成环。
  //
  // 一起听与点歌排成一队（inTurn）：同一轮里先写 [一起听] 再写 [点歌]，
  // 起播要去网易云拿歌、要等一会儿，点歌必须等它起来了再换，不然点歌那一句落空
  if (part.type === 'listen') {
    if (base.role === 'char') {
      inTurn(base, () => import('../listen.js')
        .then(m => (m.listen.get().active ? null : m.startAnywhere({ chatId: base.chatId, autoplay: false }))))
        .catch(err => {
          // 曲库空、网易云也拿不到第一首：记下这一轮想一起听，同一轮后面的 [点歌] 就拿它点的那首起播
          listenWanted = { chatId: base.chatId, turnId: base.turnId };
          console.warn('[listen] 没起来:', err.message || err);
        });
    }
    return null;
  }
  if (part.type === 'pick') {
    // 先在自己的曲库里找。找不到而且配了网易云，就让它去那边搜一首回来 ——
    // 这就是「角色可以自己搜歌加进来」。两处都没有就当没点过：
    // 凭空冒出一首放不出来的歌，界面上只是个哑巴条。
    //
    // 写成「歌名 - 歌手」按两样一起找；原唱放不了（没版权、要会员）或没搜到，就放别人唱的版本，
    // 落一行提示说清放的是谁的，角色下一轮读到（music.playableSong，ARCHITECTURE 4.219）。
    // 一个能放的都没有，也落一行，不然角色以为换上了
    inTurn(base, async () => {
      const m = await import('../listen.js');
      const wanted = listenWanted && listenWanted.chatId === base.chatId && listenWanted.turnId === base.turnId;
      if (!m.listen.get().active && !wanted) return;
      const got = await music.playableSong(part.name);
      const want = got.want ? `${got.want.artist ? `${got.want.artist}的` : ''}《${got.want.title}》` : '';
      const tell = text => messages.create({ chatId: base.chatId, role: 'char', authorId: base.authorId,
        turnId: base.turnId, kind: 'notice', status: 'done', content: `[${text}]` });
      if (!got.song) { if (want) tell(`没有找到可以播放的${want}`); return; }
      const song = got.song;
      if (got.swap) {
        const who = song.artist || '其他歌手';
        tell(got.swap === 'locked'
          ? `${want}无法播放（需要会员或没有版权），换成了${who}演唱的版本`
          : `没有找到${want}，换成了${who}演唱的版本`);
      }
      if (m.listen.get().active) m.play(song.id);
      else { listenWanted = null; m.start({ chatId: base.chatId, songId: song.id, autoplay: false }); }
    }).catch(err => console.warn('[listen] 点歌没成:', err.message || err));
    return null;
  }
  if (part.type === 'newlist') {
    collect(base, part.name, part.songs || []);
    return null;
  }
  // 分享一首歌。先落一张卡片（写着它要分享的那句），再去曲库、网易云找这首，
  // 找到了把歌补到卡片上 —— 网易云那一搜要一两秒，不该拦着这一轮后面的话
  if (part.type === 'song') {
    const msg = messages.create({ ...row, kind: 'song', content: `[分享歌曲：${part.query}]`,
      songQuery: part.query, songState: 'pending' });
    music.resolveSong(part.query)
      .then(song => messages.update(msg.id, song
        ? { songId: song.id, songState: 'done' }
        : { songState: 'missing' }))
      .catch(() => messages.update(msg.id, { songState: 'missing' }));
    return msg;
  }
  // 调用 MCP 工具。落一条消息记着调的是什么，真的发出去由 mcptools 管：
  // 服务器设成要确认的，停在 ask 等你点允许；不用确认的当场发出去。
  // 名字对不上、参数不是 JSON 的，照样落一条（标成失败）—— 角色下一轮读得到失败原因，
  // 丢掉的话它会以为调成了，接着编一个结果出来
  if (part.type === 'tool') {
    const hit = char ? mcpTools.resolve(char, part.name) : null;
    const why = !hit ? `没有名为「${part.name}」的工具`
      : part.bad ? `参数不是一个合法的 JSON 对象：${part.bad.slice(0, 200)}` : '';
    const msg = messages.create({
      ...row, kind: 'tool',
      content: `[调用：${part.name} ${part.bad || JSON.stringify(part.args || {})}]`,
      toolName: hit ? hit.tool.name : part.name,
      toolTitle: hit ? (hit.tool.title || hit.tool.name) : part.name,
      toolServerId: hit ? hit.server.id : '',
      toolArgs: part.args || {},
      toolState: why ? 'error' : mcpTools.needsAsk(hit.server, hit.tool) ? 'ask' : 'running',
      toolError: why,
    });
    if (!why && msg.toolState === 'running') mcpTools.run(msg.id);
    return msg;
  }
  if (part.type === 'ring') {
    // 动态 import：call.js 要用 engine，engine 又要用本文件，静态引会成环。
    // 电话本身不落消息，接没接通由 call 那边收尾时记。
    if (base.role === 'char') {
      import('../call.js')
        .then(m => m.ring(base.chatId, { video: !!part.video }))
        .catch(err => console.warn('[call] 来电没打通:', err.message || err));
    }
    return null;
  }
  // 一起看：暂停、继续、倒回。不落消息 —— 动的是播放器，不是聊天记录。
  // 这一场没开着就当没说过，不报错也不留痕。
  if (part.type === 'playback') {
    if (base.role !== 'char') return null;
    import('../watch.js').then(w => {
      if (!w.inChat(base.chatId)) return;
      if (part.act === 'pause') w.toggle(false);
      else if (part.act === 'resume') w.toggle(true);
      else {
        const sec = subtitleSeconds(part.to);
        if (sec !== null) w.seek(sec);
      }
    }).catch(err => console.warn('[watch] 控制播放失败:', err.message || err));
    return null;
  }
  if (part.type === 'gift') {
    return gift.send({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      cover: part.cover, inner: part.inner, extra: row,
    });
  }
  if (part.type === 'unwrap') {
    const target = gift.pendingFrom(base.chatId, base.role === 'user' ? 'char' : 'user');
    return target ? gift.settle(target.id, part.open, row) : null;
  }
  if (part.type === 'takeout') {
    // 代付是让对方出钱，付不付得起由对方那边决定，不在这儿拦
    if (part.kind !== takeout.ASK) {
      const short = broke(base, part.amount, `${part.item} ${takeout.format(part.amount)}`);
      if (short) return short;
    }
    return takeout.order({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      kind: part.kind, item: part.item, amount: part.amount, extra: row,
    });
  }
  if (part.type === 'trip') {
    return trip.propose({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      where: part.where, when: part.when, extra: row,
    });
  }
  if (part.type === 'plan') {
    // 加进眼下那一次出行的攻略里。没有活着的出行就当没说过 ——
    // 往一份不存在的清单里加，加到哪儿去都不对
    const live = trip.currentOf(base.chatId);
    if (!live) return null;
    const got = trip.addPlan(live.id, [{ title: part.title }],
      { by: trip.BY_CHAR, src: trip.MANUAL });
    if (!got.length) return null;
    return messages.create({
      ...row, kind: 'notice', status: 'done',
      content: `[已加入攻略：${part.title}]`, tripId: live.id,
    });
  }
  if (part.type === 'trip-go') {
    // 处理的是对方提的那一次。对方是谁看这一轮是谁在说话
    const target = trip.pendingFrom(base.chatId, base.role === 'user' ? 'char' : 'user');
    return target ? trip.settle(target.id, part.join, row) : null;
  }
  if (part.type === 'meal') {
    // 处理的是对方那一单。对方是谁看这一轮是谁在说话。
    const target = takeout.pendingFrom(base.chatId, base.role === 'user' ? 'char' : 'user');
    return target ? takeout.settle(target.id, part.take, row) : null;
  }
  if (part.type === 'request') {
    // 动用共同账户：账上没那么多就不必提了，落一行说明
    if (part.kind === request.SPEND) {
      const book = ledger.bookOfChat(base.chatId);
      const joint = book && ledger.defaultFor(book.id, ledger.JOINT);
      if (book && ledger.strictOn(book) && joint
        && ledger.balanceOf(book.id, joint.id) < Math.abs(part.amount)) {
        return messages.create({
          ...base, kind: 'notice', status: 'done',
          content: `[共同账户余额不足，${request.format(part.amount)} 的申请没有发出]`,
        });
      }
    }
    return request.send({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      kind: part.kind, amount: part.amount, note: part.note, extra: row,
    });
  }
  if (part.type === 'vote') {
    const target = request.pendingFrom(base.chatId, base.role === 'user' ? 'char' : 'user');
    return target ? request.settle(target.id, part.ok, row) : null;
  }
  if (part.type === 'pat') {
    return extras.pat({ chatId: base.chatId, role: base.role });
  }
  if (part.type === 'keep') {
    // 只有角色自己存得进它自己那台手机
    if (base.role !== 'char' || !char || !part.note) return null;
    // 用户刚发过来的那张图就是它要存的那张。**存的是同一个 id，不另拷一份**
    // —— 同一张图在库里躺两份没有意义，而且 purge 那边已经把相册算作引用了
    const imageId = justSent(base.chatId, base.turnId);
    const saved = theirs.addPhotos(char.id,
      [{ note: part.note, imageId, from: imageId ? 'you' : '' }])[0];
    // 裁在后台做：它要多问一次识图接口，不能让这一条消息等着。
    // 裁不成就保持原图 —— 那一步失败不该连带着让这张照片存不进去
    if (imageId && saved) {
      cropKept(imageId, part.note).then(id => {
        if (id && id !== imageId) theirs.updatePhoto(char.id, saved.id, { imageId: id, cropped: true });
      }).catch(() => {});
    }
    // 用 row 建，不自己拼字段：turnId 在里面，重新生成这一轮时它才跟着被清掉
    return messages.create({
      ...row, kind: 'notice',
      content: `[${char.name || '对方'}${imageId ? '把这张照片存了下来' : '存了一张照片'}]`,
    });
  }
  if (part.type === 'dice') {
    // 点数是本地掷的。这一条要到下一轮才进历史，所以她写下这一行的时候
    // 还不知道掷出来是几 —— 和礼物拆开之前不知道里面是什么同构。
    //
    // **把 row 交下去**，别让它自己拼字段：turnId 在里面，重新生成这一轮、
    // 或者手动重新分条时，它才跟着被换掉，不至于留成孤儿
    return extras.roll({ chatId: base.chatId, role: base.role, row });
  }
  if (part.type === 'wear') {
    // 认不出名字就不换。凭空换成另一张，用户看到的是一个她根本没提过的头像。
    if (base.role === 'char' && char) avatar.wear(char.id, part.name);
    return null;
  }
  if (part.type === 'remark') {
    // 角色改了对你的备注。群里不接：群里那个「你」在谁的通讯录里，说不清
    if (base.role !== 'char' || !char || char.canRemark === false
      || (chats.get(base.chatId)?.characterIds || []).length > 1) return null;
    return remark.setTheirs(base.chatId, part.name, { char, row });
  }
  if (part.type === 'agenda') {
    // 事项是角色自己的事，不落消息 —— 它改的是那一天，不是这段对话。
    // 认不出是哪一条就什么都不做，和约定那边同一条规矩。
    if (base.role === 'char') {
      const today = dayStore.today(char?.id);
      const item = today && dayStore.findItem(today, part.title);
      if (item) dayStore.setState(today.id, item.id, part.state);
    }
    return null;
  }
  if (part.type === 'pact') {
    return space.makePact({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      title: part.title, extra: row,
    });
  }
  if (part.type === 'pactdone') {
    // 认不出是哪一条约定就当没写过。凭空标完一条别的约定比不标更糟。
    const target = space.findOpenPact(base.chatId, part.title);
    return target ? space.completePact(target.id, row) : null;
  }
  if (part.type === 'award') {
    // 角色颁给你的一枚标识。消息照常落一条（历史里要看得见），
    // 标识本身记在会话的收藏里（见 system/badges.js）
    const name = part.name.slice(0, 24);
    const msg = messages.create({ ...row, kind: 'award', awardName: name, awardReason: part.reason,
      content: `[授予：${name}${part.reason ? '｜' + part.reason : ''}]` });
    badges.addAward(base.chatId, { name, reason: part.reason, by: base.authorId, to: 'me', msgId: msg.id });
    return msg;
  }
  if (part.type === 'lockcode') {
    // 角色改自己手机的锁屏密码（ARCHITECTURE 4.222）。频率在这儿再挡一道：
    // 离上一次不满设定的天数、这一轮又没聊到密码，就当没写过。
    // 改成了落一行提示（不写数字），提示上存着换之前那一份，删掉这一行（重新生成）时放回去
    if (base.role !== 'char' || !char || char.canChangeLock === false
      || (chats.get(base.chatId)?.characterIds || []).length > 1) return null;
    if (!theirs.lockCooled(char) && !theirs.askedLock(messagesOf(base.chatId))) return null;
    const done = theirs.changeLock(char.id, { code: part.code, why: part.why });
    return done ? messages.create({ ...row, kind: 'notice', content: `[${char.name || '对方'}改了手机的锁屏密码]`,
      lockUndo: { charId: char.id, prev: done.prev } }) : null;
  }
  if (part.type === 'card') {
    // HTML 卡片（ARCHITECTURE 4.250）。按名字找到那一张，按它的字段读值；找不到也照样落一条，
    // 气泡里退回成纯文字。正文存成角色那种写法，历史里它读到的就是自己写的那一段
    const entry = htmlcard.byName(part.name, char);
    const fields = entry ? htmlcard.fieldsOf(entry.card?.html, entry.card?.fields) : [];
    const values = htmlcard.parseValues(part.body, fields);
    return messages.create({
      ...row, kind: 'card',
      content: htmlcard.blockOf(part.name, values, fields),
      card: { name: part.name, bookId: entry?.bookId || '', entryId: entry?.id || '', values },
    });
  }
  if (part.type === 'narration') {
    // 旁白：一行夹在消息中间的小字（ARCHITECTURE 4.221）。正文照原样留着标记，历史里角色读到的就是它
    return messages.create({ ...row, kind: 'narration', content: `[旁白：${part.text}]`, narration: part.text });
  }
  if (part.type === 'closetact') {
    // 认得出是哪一件才做，并落一行提示（历史里角色也读得到）。认不出就当没写过。
    // 改之前的样子记在提示上：重新生成那一轮、删掉这一行时照着改回去（dropMessage）
    if (base.role !== 'char' || !char || (chats.get(base.chatId)?.characterIds || []).length > 1) return null;
    const r = closetStory.act(part.kind, part.name, { charId: char.id });
    return r ? messages.create({ ...row, kind: 'notice', content: `[${r.text}]`, closetUndo: r.undo }) : null;
  }
  if (part.type === 'outfit') {
    // 角色替你搭的一套，从你的衣帽间里挑。群里不接：搭给谁说不清
    if (base.role !== 'char' || (chats.get(base.chatId)?.characterIds || []).length > 1) return null;
    return closetLib.postOutfit({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      name: part.name, names: part.names, extra: row,
    });
  }
  if (part.type === 'letter') {
    return space.sendLetter({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      title: part.title, body: part.text, extra: row,
    });
  }
  if (part.type === 'location') {
    return place.send({
      chatId: base.chatId, role: base.role, authorId: base.authorId,
      place: part.place, address: part.address, extra: row,
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
    generateImage(msg.id, part.prompt, char);
    return msg;
  }
  if (part.type === 'clip') {
    const msg = messages.create({ ...row, kind: 'clip', content: `[视频：${part.prompt}]`,
      prompt: part.prompt, clipId: null, posterId: null, media: 'pending' });
    generateClip(msg.id, part.prompt);
    return msg;
  }
  if (part.type === 'voice') {
    const msg = messages.create({ ...row, kind: 'voice', content: `[语音：${part.text}]`,
      voiceText: part.text, audioId: null, media: 'pending' });
    generateVoice(msg.id, part.text, char);
    return msg;
  }
  // 命中禁写词的在消息上留个记号，气泡下方标出来。
  // 这一道是本地扫的，不依赖模型听不听话（见 system/ban.js）
  const banned = ban.scan(part.text);
  return messages.create({ ...row, kind: 'text', content: part.text,
    ...(banned.length ? { ban: banned } : {}) });
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

// 通知里那一行写什么。「[图片：一段给生图接口的描述]」是给机器看的，
// 不能原样露出来。
const BODY_OF = {
  image: '[图片]', clip: '[视频]', voice: '[语音]', sticker: '[表情]', transfer: '[转账]', gift: '[礼物]',
  location: '[位置]', call: '[通话]', listen: '[一起听]', watch: '[一起看]',
  takeout: '[外卖]', request: '[申请]', share: '[分享]', dice: '[骰子]', song: '[分享歌曲]', tool: '[调用工具]',
  trip: '[旅行]',
  pact: '[约定]', letter: '[信]', vote: '[投票]', outfit: '[搭配]', groom: '[动作]', dresscode: '[穿搭盲盒]', slip: '[包里多了一样东西]', narration: '[旁白]',
  card: '[卡片]', forward: '[聊天记录]',
};
const bodyOf = m => (m.kind === 'text' ? m.content : BODY_OF[m.kind]) || '发来一条消息';

// 一条消息一条通知，不是一轮一条。由 renderTurn 在每条气泡落下的那一刻调，
// 和气泡的节奏一致，而不是整轮说完之后一口气补三条。
export function notifyMessage(chat, char, msg) {
  // 旁白不是谁发来的消息，不弹通知
  if (!msg || msg.kind === 'narration' || !shouldNotify(chat.id)) return;
  // 群聊：标题是群名，谁说的写在正文前面
  const inGroup = group.isGroup(chat);
  notify({
    title: inGroup ? group.titleOf(chat) : extras.starTitle(char, remark.nameOf(char) || '新消息'),
    body: inGroup ? `${remark.nameOf(char)}：${bodyOf(msg)}` : bodyOf(msg),
    icon: 'message', appId: 'chat', avatar: char.avatar,
    payload: { route: `/chat/${chat.id}` },
  });
}

// 单独那套翻译接口开着时，这一轮的译文由它来给。
//
// **请求在气泡开始滴之前就发出去**，和下面那些停顿并行跑 —— 一轮要滴好几秒，
// 等最后一条落下来，译文一般已经回来了。等整轮发完再去发请求，用户就要
// 对着已经看完的几条气泡再干等一次。
//
// 模型自己已经给了译文的那几条不再翻：那是回落那条路留下的，花钱重翻没有意义。
function startTranslate(chat, parts) {
  if (!chat.translateTo || !translate.ready()) return null;
  const idx = [];
  const texts = [];
  parts.forEach((p, i) => {
    if ((p.type !== 'text' && p.type !== 'voice') || p.translation) return;
    const t = String(p.text || '').trim();
    // 已经是目标语言的那几条不送去翻（中译中，还白花钱）
    if (t && !translate.alreadyIn(t, chat.translateTo)) { idx.push(i); texts.push(t); }
  });
  if (!texts.length) return null;
  return {
    idx, texts,
    // 翻译挂了不能连累这一轮消息。原文已经发出去了，少一行译文而已
    promise: translate.run(texts, { lang: chat.translateTo, extra: chat.translateRules })
      .catch(err => { console.warn('[translate] 这一轮没翻出来:', err.message || err); return null; }),
  };
}

async function applyTranslate(job, byPart) {
  if (!job) return;
  const out = await job.promise;
  if (!out) return;
  job.idx.forEach((at, k) => {
    const id = byPart.get(at);
    const text = String(out[k] || '').trim();
    if (id && text && !translate.sameText(text, job.texts[k])) messages.update(id, { translation: text });
  });
}

/**
 * 回复途中连接断开、已经收到一部分字：把收到的那部分照常落成气泡，最后一条标上「回复在此处中断」。
 *
 * 用户要求保留 —— 那部分已经付过钱，从前连同整轮一起丢掉。err 是 engine.explainDrop 给的那个（带 partial）。
 * 回来的是落下的几条；没有可留的就是空数组，调用方照旧只落一条失败提示
 */
export async function keepPartial({ chat, char, err, turnId, notify = false }) {
  const raw = String(err?.partial || '').trim();
  if (!raw || !chat || !char) return [];
  let made = [];
  try {
    made = await renderTurn({ chat, char, raw, turnId: turnId || `cut-${Date.now()}`, swipes: [raw], swipeIndex: 0, instant: true, notify });
  } catch { return []; }
  const last = made[made.length - 1];
  if (last) messages.update(last.id, { cutOff: true });
  return made;
}

// notify：每落一条弹一条（人不在这个会话里时）。重放候选、一起看的插话不传。
export async function renderTurn({ chat, char, raw, turnId, swipes, swipeIndex, onEach, signal, instant, notify: wantNotify = false }) {
  const parts = splitReply(raw);
  if (!parts.length) throw new Error('模型返回了空内容');
  return renderPlan({ chat, plan: parts.map(part => ({ part, char })), raw,
    turnId, swipes, swipeIndex, onEach, signal, instant, wantNotify });
}

/**
 * 一条条落下来。plan 里每一项是「这一条是谁说的、说了什么」——
 * 一对一时全是同一个人，群聊时按名字拆开的各段各是各的人。
 */
async function renderPlan({ chat, plan, raw, turnId, swipes, swipeIndex, onEach, signal, instant, wantNotify }) {
  const { think } = stripThink(raw);
  const parts = plan.map(x => x.part);
  const job = startTranslate(chat, parts);
  const byPart = new Map();
  const created = [];
  for (let i = 0; i < plan.length; i++) {
    if (signal?.aborted) break;
    const { part, char } = plan[i];
    const msg = materialize(part, {
      chatId: chat.id, role: 'char', authorId: char.id,
      turnId, status: 'done',
      // 整轮的原文、候选与自检只挂在第一条上，切换候选时整轮重放
      ...(i === 0 ? { raw, think, swipes: swipes || [raw], swipeIndex: swipeIndex ?? 0 } : {}),
    }, char);

    if (!msg) continue;
    byPart.set(i, msg.id);
    created.push(msg);
    onEach && onEach(msg, i, plan.length);
    if (wantNotify) notifyMessage(chat, char, msg);
    if (!instant && i < plan.length - 1) await new Promise(r => setTimeout(r, pause(part)));
  }
  // 一轮写一次。messages.create 已经通知过界面，每条再 update 一次 chats
  // 就是白多一轮重渲染。中途取消也照写，已经落下的那几条是真落了。
  if (created.length) chats.update(chat.id, { lastMessageAt: Date.now() });
  await applyTranslate(job, byPart);
  return created;
}

// ---- 群聊：按名字拆回各人 ----
//
// 模型一次写整轮，每行开头是「名字：」（skeleton.group-rules）。没带名字的行
// 接在上一个说话的人后面 —— 译文行、图片标记、一句话分两行，都是这么写的。
//
// 认名字要宽一点：模型常把名字加粗（**小林**：）、套括号（【小林】：）。
// 写成用户名字的那几行整段丢掉，那是替用户说话（规则里禁了，但会犯）。
// 一个名字都没认出来就整段算第一个被点名的、或者第一个成员 ——
// 全丢掉比认错一个人更糟。

const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function splitSpeakers(raw, members, { userName = '', fallback = '' } = {}) {
  const { text: spoken } = stripThink(raw);
  const { text, stamp } = stripStamps(spoken.trim());
  const names = members.map(c => ({ id: c.id, name: String(c.name || '').trim() }))
    .filter(x => x.name);
  if (userName) names.push({ id: '__user', name: String(userName).trim() });
  names.sort((a, b) => b.name.length - a.name.length);
  const alt = names.map(x => escRe(x.name)).join('|');
  const head = alt
    ? new RegExp(`^\\s*(?:[*_]{1,2})?[【\\[(（]?\\s*(${alt})\\s*[】\\])）]?(?:[*_]{1,2})?\\s*[:：]\\s*(.*)$`)
    : null;
  const idOf = n => names.find(x => x.name === n)?.id || '';

  const segs = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    const m = head && line.match(head);
    if (m) {
      cur = { id: idOf(m[1]), lines: [] };
      segs.push(cur);
      if (m[2].trim()) cur.lines.push(m[2]);
      continue;
    }
    if (!cur) { cur = { id: '', lines: [] }; segs.push(cur); }
    cur.lines.push(line);
  }
  const first = fallback || members[0]?.id || '';
  const out = segs
    .filter(sg => sg.id !== '__user')
    .map(sg => ({ charId: sg.id || first, text: sg.lines.join('\n').trim() }))
    .filter(sg => sg.text);
  // 时间只写一次，在最前面，挂回第一段上
  if (stamp && out.length) out[0].text = `[时间：${stamp}]\n${out[0].text}`;
  return out;
}

export async function renderGroupTurn({ chat, members, raw, turnId, swipes, swipeIndex, onEach, signal, instant,
  notify: wantNotify = false, userName = '', fallback = '' }) {
  const byId = new Map(members.map(c => [c.id, c]));
  const plan = [];
  for (const sg of splitSpeakers(raw, members, { userName, fallback })) {
    const char = byId.get(sg.charId);
    if (!char) continue;
    for (const part of splitReply(sg.text)) plan.push({ part, char });
  }
  if (!plan.length) throw new Error('模型返回了空内容');
  return renderPlan({ chat, plan, raw, turnId, swipes, swipeIndex, onEach, signal, instant, wantNotify });
}

// 删一条消息。图片和语音是另存的，跟着一起清掉，不然删完还占着空间。
// 图要等消息删掉之后按引用表看：「保存到相册」和这条消息共用同一个 id
export function dropMessage(id) {
  const m = messages.get(id);
  if (!m) return false;
  if (m.audioId) files.remove(m.audioId);
  // 「已收款」「已拆开」那一行就是这件事的记录，删了它就当没处理过，
  // 那笔钱、那件礼物回到待处理。重新生成角色那一轮时整轮清空，走的也是这里。
  if (m.kind === 'notice' && m.settledId) {
    if (m.settledKind === 'pact') space.unsettlePact(id);
    else if (m.settledKind === 'takeout') takeout.unsettle(id);
    else if (m.settledKind === 'trip') trip.unsettle(id);
    else if (m.settledKind === 'request') request.unsettle(id);
    else (m.settledKind === 'gift' ? gift : transfer).unsettle(id);
  }
  // 衣帽间里借走、换上的那一行删了（多半是重新生成那一轮），那一件改回原样
  if (m.kind === 'notice' && m.closetUndo) closetStory.undo(m.closetUndo);
  // 改锁屏密码的那一行删了（多半是重新生成那一轮），密码放回换之前那一个
  if (m.kind === 'notice' && m.lockUndo) theirs.restoreLock(m.lockUndo.charId, m.lockUndo.prev);
  // 颁标识的那一条删了，标识也收回。重新生成那一轮时，旧的那一枚不该留在收藏里
  if (m.kind === 'award') {
    const aw = (chats.get(m.chatId)?.awards || []).find(a => a.msgId === id);
    if (aw) badges.dropAward(m.chatId, aw.id);
  }
  const ok = messages.remove(id);
  releaseImages([m.imageId]);
  return ok;
}

// 改完图片描述或语音文字之后重新生成那一份媒体
/**
 * 生成一段视频，落到 `msgId` 那条消息上。
 *
 * **提交完立刻把 task_id 写回消息**，之后才开始等。中间切页面、锁屏、
 * 重开应用都不要紧 —— `resumeClips()` 会把没等完的接着等下去。
 * 不写回的话，等了三分钟一刷新这笔钱就白花了。
 *
 * 等的过程里把状态也写回去（排队中 / 生成中），不然屏幕上只有一个转圈，
 * 而这一等是按分钟算的。
 */
export async function generateClip(msgId, prompt, preset) {
  const p = preset || services.activeVideo();
  try {
    if (!videoSvc.isVideoReady() && !p?.apiKey) throw new Error('还没有配置视频接口');
    const row = messages.get(msgId);
    const who = characters.get(row?.authorId);
    const said = await promptwrite.forVideo(prompt, {
      chatId: row?.chatId, char: who, key: `clip-prompt:${msgId}`,
    });
    // **和生图拼同一套。** 从前这里把那句话原样发出去 —— 没有外貌、
    // 没有生图世界书、没有全局提示词，于是「乃木绿实在窗边」发过去就是
    // 四个字加一个地点，视频模型无从下手。那几段说的都是「这东西长什么样」，
    // 对视频一样成立，没有理由只给图片用
    const full = imgPrompt.compose({ prompt: said, char: who });
    const taskId = await videoSvc.submit({
      prompt: full, preset: p, key: `msg-clip:${msgId}`,
      parts: imgPrompt.explain({ prompt: said, char: who }),
    });
    messages.update(msgId, { clipTask: taskId, clipPreset: p?.id || '', clipState: 'queued' });
    const blob = await videoSvc.wait({
      taskId, preset: p,
      onTick: r => messages.update(msgId, { clipState: r.state }),
    });
    await storeClip(msgId, blob);
  } catch (err) {
    if (isAbort(err)) { messages.update(msgId, { media: 'off', mediaError: '' }); return; }
    messages.update(msgId, { media: 'error', mediaError: String(err.message || err) });
  }
}

/** 取回来的那段视频存进去，顺手取一帧当海报。海报取不出来不算失败。 */
async function storeClip(msgId, blob) {
  const { poster, duration } = await clip.probe(blob).catch(() => ({ poster: null, duration: 0 }));
  const clipId = await files.put(blob, { name: 'clip.mp4', type: blob.type || 'video/mp4' });
  const posterId = poster
    ? await images.put(new File([poster], 'poster.jpg', { type: 'image/jpeg' }))
    : null;
  messages.update(msgId, { clipId, posterId, clipDur: duration, media: 'done', clipState: '' });
}

/**
 * 重开应用之后，把没等完的接着等下去。
 *
 * **不重新提交**，只是接着问那个 task_id —— 任务一直在对方那边跑着，
 * 重提一次是再花一份钱换同一段视频。
 *
 * 查询只支持最近七天的任务（接口自己的限制），更早的问过去会说
 * 「invalid task_id」，那时候照实把错误写在气泡上。
 */
export function resumeClips() {
  for (const m of messages.all()) {
    if (m.kind !== 'clip' || m.media !== 'pending' || !m.clipTask || m.clipId) continue;
    const preset = services.videoPresets().find(x => x.id === m.clipPreset) || null;
    (async () => {
      try {
        const blob = await videoSvc.wait({
          taskId: m.clipTask, preset,
          onTick: r => messages.update(m.id, { clipState: r.state }),
        });
        await storeClip(m.id, blob);
      } catch (err) {
        messages.update(m.id, { media: 'error', mediaError: String(err.message || err) });
      }
    })();
  }
}

export function regenMedia(id) {
  const m = messages.get(id);
  if (!m) return;
  const char = characters.get(m.authorId);
  if (m.kind === 'image') {
    messages.update(id, { imageId: null, media: 'pending', mediaError: '' });
    releaseImages([m.imageId]);
    generateImage(id, m.prompt, char);
  } else if (m.kind === 'voice') {
    if (m.audioId) files.remove(m.audioId);
    // 角色那边的旧语音里混着译文的，顺手把记录也拆干净
    const v = m.role === 'char' ? splitVoiceText(m.voiceText) : { text: m.voiceText, translation: '' };
    messages.update(id, {
      audioId: null, media: 'pending', mediaError: '',
      ...(v.translation ? { voiceText: v.text, content: `[语音：${v.text}]`,
        translation: m.translation || v.translation } : {}),
    });
    generateVoice(id, m.voiceText, char || {});
  }
}

async function generateImage(msgId, prompt, char) {
  if (!isImageReady()) {
    messages.update(msgId, { media: 'off', mediaError: '还没有配置生图接口' });
    return;
  }
  try {
    // 先看这一张有没有画面描述。**拼过之后再看就晚了** —— 全局提示词、
    // 角色自己的提示词都会把它撑成非空，于是照着一句画风描述画出一张
    // 谁也没要过的图，钱照花
    imageSvc.needPrompt(prompt);
    // 先把这一句改写成一份自带全部信息的描述。默认关着，开了才多这一次调用。
    // 写不出来就用原话 —— 为了改写把整张图断掉，比不改写更糟
    prompt = await promptwrite.forImage(prompt, {
      chatId: messages.get(msgId)?.chatId, char, key: `img-prompt:${msgId}`,
    });
    const preset = activeImage();
    const lock = imgPrompt.faceApplies(char, prompt);

    // 先试直传参考图那条路。接口不认（多半是没有 images/edits）就退回
    // 把脸读成一段外貌描述拼进提示词 —— 退回去也比画成另一个人强。
    //
    // **退回去是第二次调用，所以只在「接口不认」时退。** 两种不退：
    // 取消（人不要了，再画一张是凭空的一笔账）、以及图已经画回来了只是
    // 存不进去（那是本机的事，重画一张也一样存不进去，白花一次）。
    if (lock && imgPrompt.wantsRef(char, preset)) {
      let blob = null;
      try {
        const ref = await imgPrompt.faceBlob(char);
        if (ref) {
          blob = await imageSvc.generateWithRef({
            prompt: imgPrompt.compose({ prompt, char }), refBlob: ref,
            parts: imgPrompt.explain({ prompt, char }),
            preset, key: `msg-img:${msgId}`,
          });
        }
      } catch (err) {
        if (isAbort(err)) throw err;
        // 只有「接口不支持参考图」才退回去再画。从前任何错误都退，超时、余额不足、
        // 服务器 500 也立刻再画一张，一条消息扣两张图的钱（见 image.refUnsupported）
        if (!imageSvc.refUnsupported(err)) throw err;
        console.warn('[image] 接口不支持参考图，改用外貌描述:', err.message || err);
      }
      // 存这一步放在 try 外面：它失败不该把我们送去再画一张
      if (blob) {
        messages.update(msgId, { imageId: await imageSvc.toLibrary(blob), media: 'done' });
        return;
      }
    }

    const face = lock ? await imgPrompt.ensureFaceDesc(char).catch(() => '') : '';
    const blob = await imageSvc.generate({
      prompt: imgPrompt.compose({ prompt, char, face }),
      negative: imgPrompt.negativeOf({ prompt, char, face }),
      parts: imgPrompt.explain({ prompt, char, face }),
      preset, key: `msg-img:${msgId}`,
    });
    messages.update(msgId, { imageId: await imageSvc.toLibrary(blob), media: 'done' });
  } catch (err) {
    // 取消不是错误。留一句红字在气泡上，人会以为是接口坏了
    if (isAbort(err)) { messages.update(msgId, { media: 'off', mediaError: '' }); return; }
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
  // 旧消息里可能已经混着译文（见 splitVoiceText）。念的只有原话
  text = splitVoiceText(text).text;
  try {
    // 先写成台本：原话不动，插上哪里停顿、哪里换情绪（依据是用户的语音世界书）。
    // 默认关着，开了才多这一次调用；写不出来或改了台词就照原话念
    const said = await promptwrite.scriptFor(text, {
      chatId: messages.get(msgId)?.chatId, char, key: `tts-script:${msgId}`,
    });
    if (said !== text) messages.update(msgId, { voiceScript: said });
    const url = await voiceSvc.speak({
      text: said, voiceId: char.voiceId, speed: char.voiceSpeed || 1,
      ...voiceSvc.styleFor(char),
      key: `msg-tts:${msgId}`,
    });
    const blob = await (await fetch(url)).blob();
    URL.revokeObjectURL(url);
    const id = await files.put(blob, { name: `${char.name}-${Date.now()}.mp3`, type: 'audio/mpeg' });
    messages.update(msgId, { audioId: id, media: 'done' });
  } catch (err) {
    messages.update(msgId, { media: 'error', mediaError: String(err.message || err) });
  }
}


