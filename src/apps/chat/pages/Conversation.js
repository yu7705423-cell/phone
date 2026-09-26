import { html, useState, useEffect, useLayoutEffect, useRef, useMemo, memo } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Avatar, Icon, IconButton, FullSheet, Sheet, List, ListItem,
         Button, Textarea, EmptyState, Spinner, toast, confirm, prompt } from '../../../ui/index.js';
import { splitBubbles, quoteOf } from '../helpers.js';
import { StickerPanel, StickerSuggest } from './StickerPanel.js';
import { StickerImg } from './StickerBits.js';
import { groupImages, ImageStack, StackFold } from './ImageStack.js';
import { MediaBubble } from './MediaBubble.js';
import { MsgMenu } from './MsgMenu.js';
import { PactBubble, LetterBubble, LetterSheet, PactSheet } from './SpaceBits.js';
import { ForwardBubble, ForwardSheet, ForwardPickSheet } from './ForwardBits.js';
import { FaceChooser, FaceSheet, FaceBar, SideLine } from './FaceBits.js';
import { FileBubble, FileSheet } from './FileBits.js';
import { DiceBubble, InnerVoice, DiceSheet, InnerSheet } from './ExtrasBits.js';
import { TakeoutBubble, TakeoutSheet, MealSettleSheet, ShareSheet, MoreSheet } from './MealBits.js';
import { TripBubble, TripSettleSheet } from './TripBits.js';
import { PhotoSource } from './PhotoSource.js';
import { SongPicker } from './SongCard.js';
import { ToolBubble } from './ToolBits.js';
import { FailNote } from './FailNote.js';
import { TransferBubble, NoticeLine, TransferSheet, SettleSheet,
         LocationBubble, LocationSheet, CallBubble, CallLogSheet,
         GiftBubble, GiftSheet, UnwrapSheet,
         ListenBubble, ListenLogSheet, ListenBar, SongBubble, WatchBubble, ReadBubble, ExcerptBubble,
         WatchBar, RequestBubble, RequestSheet, VoteSheet } from './TransferBits.js';
import { SceneBlock, LookFloat } from './SceneInline.js';
import { ChatLookSheet } from './ChatLook.js';
import { MentionBar } from './GroupBits.js';
import { AwardBubble, StreakMark, UnlockToast } from './BadgeBits.js';
import { OutfitBubble, GroomBubble, DresscodeBubble, SlipBubble } from './OutfitBits.js';
import { CardBubble, CardSendSheet } from './CardBits.js';

// panel 这个名字在本文件里已经被「当前开着哪个面板」占了（见下面的 useState），
// 所以模块换个名字进来 —— 同名会被局部变量盖掉，读出来是 null。
const { db, nav, ai, call, extras, pace, autoReply, panel: panelCfg,
  scene: sceneApi, stage, skin, receipt, recall } = phone;

// 一屏装不下这么多，但往上翻几下够用；不够再按按钮要下一段。
// 见 CLAUDE.md 第 13 条：这是默认值不是上限，设置里填 0 就一次画全。
const pageSize = () => db.settings.get().chatPage || Infinity;

// 点引用块跳回原话。闪一下再停，不然滚过去了也不知道是哪条。
function jumpTo(id) {
  if (!id) return;
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1200);
}

// 引用有两份，版式全交给 CSS（见 ARCHITECTURE 4.208）：
//
//   .ph-quote     气泡外面那一条。DOM 里排在气泡**后面**，默认 order: -1 画到上面；
//                 写 order: 0 就回到气泡下面，display: none 就不显示
//   .ph-quote-in  第一个文字气泡里面那一份。默认不显示，放出来就是「引用包在气泡里」
//
// 从前只有上面那一条，而且 DOM 里就排在气泡前面 —— 放到下面、包进气泡，CSS 都做不到
function QuoteRef({ quote, onClick }) {
  if (!quote) return null;
  return html`
    <button class=${`quote-ref ph-quote${quote.id ? ' press' : ' is-dead'}`}
      onClick=${quote.id && onClick ? onClick : null}>
      ${quote.name ? html`<span class="quote-name">${quote.name}</span>` : null}
      <span class="quote-text ellipsis">${quote.text}</span>
    </button>`;
}
function QuoteIn({ quote, onClick }) {
  if (!quote) return null;
  return html`
    <span class=${`bubble-quote ph-quote-in${quote.id ? ' press' : ' is-dead'}`}
      onClick=${quote.id && onClick ? e => { e.stopPropagation(); onClick(); } : null}>
      ${quote.name ? html`<span class="quote-name">${quote.name}</span>` : null}
      <span class="quote-text">${quote.text}</span>
    </span>`;
}

// 气泡上的那一行小字：发出的时刻、已读回执。两样都默认关着，见 system/receipt.js
//
// 显示哪个时刻 —— 是这台机器上这条消息出现的时刻，不是角色写的 `[时间：]`。
// 那个是剧情里的时间，两者常常差着好几天。
function MsgMeta({ slot, stamp, read }) {
  return html`
    <div class=${`msg-meta ph-meta at-${slot}`}>
      ${stamp ? html`<span class="msg-stamp ph-stamp">${stamp}</span>` : null}
      ${read ? html`<span class="msg-read ph-read">${read}</span>` : null}
    </div>`;
}

/**
 * 底栏那一条。**抽出来是为了美化页的样板间能用同一份。**
 *
 * 和 Bubble 同一个理由（见这一页开头那段）：另写一份假的，真页面改了 class
 * 它不跟，在美化页调好的底栏回到会话里不生效，而且没人会发现。
 * 从前样板间里根本没有底栏，于是「底栏按钮大小」「底栏内边距」这两项令牌
 * 怎么调都看不出动静 —— 那两项摆在那里，却没有一处能验证它。
 *
 * frozen 时一律不响应：样板间里的这一条是给人看的，不是给人用的。
 */
export function ComposerBar({ draft = '', live = false, busy = false, frozen = false,
                              onDraft, onSend, onMenu, onSticker, onMore, onLook,
                              onStop, onGenerate }) {
  const tap = fn => (frozen || !fn ? null : fn);
  return html`
    <div class="composer-bar ph-composer">
      <button class="composer-side ph-composer-btn ph-plus press" onClick=${tap(onMenu)}
        aria-label="添加内容"><${Icon} name="plus" size=${20}/></button>

      <textarea class=${`composer-input ph-composer-input${live ? ' is-scene' : ''}`} rows="1" value=${draft}
        placeholder=${live ? '写你这一段' : '说点什么'} readOnly=${frozen}
        onInput=${frozen ? null : e => onDraft && onDraft(e.target.value)}
        onKeyDown=${frozen ? null : e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onSend && onSend(); }
        }}></textarea>

      ${live
        ? html`
          <button class="composer-side ph-composer-btn press" disabled=${busy} onClick=${tap(onMore)}
            aria-label="接着上一段往下写"><${Icon} name="chevronDown" size=${20}/></button>
          <button class="composer-side ph-composer-btn press" onClick=${tap(onLook)}
            aria-label="外观"><${Icon} name="sun" size=${20}/></button>`
        : html`
          <button class="composer-side ph-composer-btn ph-sticker-btn press" onClick=${tap(onSticker)}
            aria-label="表情"><${Icon} name="heart" size=${20}/></button>`}

      ${draft.trim()
        ? html`<button class="send-btn ph-send press" onClick=${tap(onSend)} aria-label="发送">
            <${Icon} name="send" size=${17}/></button>`
        : busy
          ? html`<button class="send-btn ph-send is-stop press" onClick=${tap(onStop)} aria-label="停止">
              <${Icon} name="close" size=${17}/></button>`
          : html`<button class="send-btn ph-send is-ghost press" onClick=${tap(onGenerate)}
              aria-label="让对方回复"><${Icon} name="reply" size=${22}/></button>`}
    </div>`;
}

// 滑一下引用：横着先走够 SW_OWN 才算这一下归气泡，走够 SW_GO 松手才引用，
// 最多跟着手指走 SW_MAX。SW_EDGE 和页面的边缘返回同宽（ui/page.js 的 EDGE）
const SW_OWN = 10;
const SW_GO = 56;
const SW_MAX = 72;
const SW_EDGE = 40;

// 两条消息中间居中的那一行时间。相隔五分钟以上才有（见 receipt.needSep）
const TimeSep = ({ at }) => html`<div class="time-sep ph-time-sep">${receipt.sepOf(at)}</div>`;

// 同一个人接着说的那一条：和上一条之间收紧一点，读起来是一段话，不是几件事。
// 提示行、线下那一整场不是「说的话」，不算
const TALK = m => m && m.kind !== 'notice' && m.kind !== 'scene';
const CONT_GAP = 3 * 60000;
const contOf = (prev, cur) => TALK(prev) && TALK(cur)
  && prev.role === cur.role && prev.authorId === cur.authorId
  && cur.createdAt - prev.createdAt < CONT_GAP;

// 记忆化：流式回复时只有最后那条在变，别的几百条没必要跟着重画。
// 下面传给它的函数属性都是稳定身份的，见 Conversation 里的 stable。
// 这一条头像点下去，该展开哪一条的心声。
//
// 心声只挂在一轮里的**一条**上（多半是最后一条），可这一轮每条都有头像。
// 从前只认自己身上那一份，点到同一轮别的几条的头像什么都不出来 ——
// 一轮三到五条，多半点到的就是空的那几个，看上去就是「点头像没有心声」
function innerOf(msg) {
  if (msg.inner) return msg.id;
  if (!msg.turnId) return '';
  const hit = db.messagesOf(msg.chatId).filter(m => m.turnId === msg.turnId && m.inner).pop();
  return hit ? hit.id : '';
}

export const Bubble = memo(function Bubble({ msg, char, chat, frozen, onRetry, onSwipe, onHold, onBind,
                  selecting, selected, onToggle, transOpen, onTrans, onFile, onSettle, onOpenLog, onUnwrap,
                  onPat, innerStyle, onInnerPage, fold, foldCount, onScene, onQuote, who = '', cont = false,
                  stampAt = 'off', readOn = false, readUpTo = 0 }) {
  const mine = msg.role === 'user';
  // 落点是几个标量属性算出来的，不在这里读设置 —— 这个组件是 memo 过的，
  // 读了设置它也不会因为设置变了而重画（见外面传下来的那三个）
  // 回执自己没有位置设置，跟着时刻走；时刻关着就靠着气泡画
  const slot = stampAt === 'below' ? 'below' : 'side';
  // 「按间隔」那一档不画在气泡上，由列表在两条之间插一行（见 TimeSep）
  const metaStamp = stampAt === 'side' || stampAt === 'below' ? receipt.stampOf(msg.createdAt) : '';
  const metaRead = readOn ? receipt.textOf(msg, readUpTo) : '';
  const hasMeta = !!(metaStamp || metaRead);
  const avatar = useImage(mine ? phone.accounts.current()?.avatar : char?.avatar);
  const hold = useRef({ timer: null, fired: false });
  // 译文开没开记在页面上（按消息 id），不记在这个组件里：组件一重挂状态就丢，
  // 表现是「点开之后下一轮又自己收回去」（ARCHITECTURE 4.270）。transOpen 是 'always' 或者这一条开没开
  // 心声默认藏着，点头像才展开
  const [openInner, setOpenInner] = useState(false);
  // 点的是同一轮里别的那一条的头像，也要展开这一条的（见 innerOf）
  useEffect(() => {
    if (!msg.inner) return undefined;
    const on = e => { if (e.detail === msg.id) setOpenInner(v => !v); };
    window.addEventListener('inner-toggle', on);
    return () => window.removeEventListener('inner-toggle', on);
  }, [msg.id, !!msg.inner]);
  // 单击看心声、双击拍一拍，只能等一下才分得清是哪一个
  const tap = useRef(null);
  // 撤回（见 system/recall.js）。角色那一条先照常显示，到点再折起来 ——
  // 这个组件是 memo 过的，到点没有别的东西会让它重画，所以自己掐一个表
  const [, tick] = useState(0);
  const [openGone, setOpenGone] = useState(false);
  const wait = recall.waitOf(msg);
  useEffect(() => {
    if (!wait) return undefined;
    const t = setTimeout(() => tick(n => n + 1), wait + 30);
    return () => clearTimeout(t);
  }, [msg.id, wait > 0]);
  const gone = recall.isRecalled(msg);

  const parts = splitBubbles(msg.content);
  const swipes = msg.swipes || [];
  const sticker = msg.kind === 'sticker' ? db.stickers.get(msg.stickerId) : null;
  const quote = quoteOf(msg, { char, chat });
  const trans = (msg.translation || '').trim();
  const showTrans = trans && (transOpen === 'always' || transOpen === true);

  // ---- 左右滑一下：引用这一条 ----
  //
  // 长按菜单里那个「引用」要两下，而回一句话最常用的就是它。朝哪边滑都算，
  // 滑够 SW_GO 松手就引用；没滑够弹回去。
  //
  // 两处让开：起手落在左右边缘那一条里的，归页面的边缘返回（ui/page.js 的 EDGE）；
  // 竖着走得更多的，是在翻消息。位移走 --swipe-x，不在契约钩子上写内联声明（第 18 条）
  const row = useRef(null);
  const sw = useRef(null);
  const moveRow = px => {
    const el = row.current;
    if (!el) return;
    el.style.setProperty('--swipe-x', `${px}px`);
    el.classList.toggle('is-swiping', px !== 0);
  };
  const start = e => {
    if (frozen || selecting) return;
    hold.current.fired = false;
    hold.current.timer = setTimeout(() => {
      hold.current.timer = null;
      hold.current.fired = true;
      sw.current = null;
      onHold(msg);
    }, 460);
    const p = e?.touches?.length === 1 ? e.touches[0] : null;
    const wide = window.innerWidth || 0;
    sw.current = p && onQuote && p.clientX > SW_EDGE && p.clientX < wide - SW_EDGE
      ? { x: p.clientX, y: p.clientY, dx: 0, own: false } : null;
  };
  const end = () => {
    if (hold.current.timer) { clearTimeout(hold.current.timer); hold.current.timer = null; }
  };
  const move = e => {
    const s = sw.current;
    const p = e.touches?.[0];
    if (!s || !p) { end(); return; }
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (!s.own) {
      if (Math.abs(dy) > Math.abs(dx)) { sw.current = null; end(); return; }
      if (Math.abs(dx) < SW_OWN) return;
      s.own = true;
      end();
    }
    e.preventDefault();
    s.dx = Math.max(-SW_MAX, Math.min(SW_MAX, dx));
    moveRow(s.dx);
  };
  const release = () => {
    end();
    const s = sw.current;
    sw.current = null;
    if (!s?.own) return;
    moveRow(0);
    if (Math.abs(s.dx) >= SW_GO) onQuote(msg);
  };

  // 多选时整条都是选择区，子元素的点击一律不放行。
  // 平时只吃掉长按之后紧跟的那一次 click —— 不然手一松语音就播了。
  const capture = e => {
    if (selecting && !frozen) { e.preventDefault(); e.stopPropagation(); onToggle(msg); return; }
    if (hold.current.fired) { hold.current.fired = false; e.preventDefault(); e.stopPropagation(); }
  };

  // 线上 / 线下的分界（ARCHITECTURE 4.269）：一条线，不是谁说的话
  if (msg.kind === 'side') {
    return html`<div id=${`msg-${msg.id}`}><${SideLine} msg=${msg}/></div>`;
  }
  // 提示行不是谁说的话，不给头像也不给气泡，居中一行就够
  if (msg.kind === 'notice') {
    return html`<div id=${`msg-${msg.id}`}><${NoticeLine} msg=${msg}/></div>`;
  }
  // 旁白：夹在消息中间的一行小字，没有头像、没有气泡（ARCHITECTURE 4.221）。
  // 颜色走 --ph-narration-color，会话「聊天背景」里可以改
  if (msg.kind === 'narration') {
    const text = msg.narration || String(msg.content || '').replace(/^[[【]\s*旁白\s*[:：]\s*|[\]】]$/g, '');
    return html`<div id=${`msg-${msg.id}`} class="msg-narration ph-narration">${text}</div>`;
  }

  // 线下那一整场挂在这一条上。不把段落混进消息列表 —— 分页、多选、引用、
  // 搜索全按「一条消息」算，混流要各改一遍（见 ARCHITECTURE 4.110）
  if (msg.kind === 'scene') {
    return html`
      <div id=${`msg-${msg.id}`}>
        <${SceneBlock} sceneId=${msg.sceneId} onSetup=${onScene}/>
      </div>`;
  }

  const body = html`
    <div id=${gone ? undefined : `msg-${msg.id}`}
      class=${`msg no-callout ph-msg ${mine ? 'ph-msg-mine is-mine' : 'ph-msg-theirs'}${msg.side === 'face' ? ' ph-msg-face is-face' : ''}${selecting && !frozen ? ' is-picking' : ''}${selected ? ' is-picked' : ''}${hasMeta && slot === 'side' ? ' has-aside' : ''}${cont ? ' is-cont' : ''}${gone ? ' is-recalled' : ''}`}
      ref=${row}
      onClickCapture=${capture}
      onTouchStart=${start} onTouchEnd=${release} onTouchMove=${move} onTouchCancel=${release}
      onContextMenu=${e => { e.preventDefault(); if (!selecting && !frozen) onHold(msg); }}>

      ${selecting && !frozen ? html`
        <span class=${`pick-dot${selected ? ' is-on' : ''}`}>
          ${selected ? html`<${Icon} name="check" size=${11}/>` : null}
        </span>` : null}

      <div class="msg-face no-callout ph-face"
        onClick=${selecting || frozen ? null : () => {
          if (tap.current) { clearTimeout(tap.current); tap.current = null; onPat && onPat(); return; }
          tap.current = setTimeout(() => {
            tap.current = null;
            if (mine) return;
            const target = innerOf(msg);
            // 「打开一页」那一档：不在气泡下面展开，打开一页看这一轮的和以前的（4.274）
            if (innerStyle === 'card') { onInnerPage?.(target || ''); return; }
            if (target) {
              window.dispatchEvent(new CustomEvent('inner-toggle', { detail: target }));
              // 心声挂在这一轮别的那一条上：把那一条滚到眼前，不然展开了也看不见
              if (target !== msg.id) {
                setTimeout(() => document.getElementById(`msg-${target}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
              }
              return;
            }
            const n = msg.turnId ? db.messagesOf(msg.chatId).filter(m => m.turnId === msg.turnId).length : 0;
            toast(extras.innerOn(chat) ? `这一轮没有心声${n ? `（这一轮 ${n} 条）` : '（这一条没有轮次信息）'}`
              : '心声未开启，可在会话菜单的「互动」中开启');
          }, 260);
        }}>
        <${Avatar} src=${avatar} name=${mine ? phone.accounts.current()?.name : char?.name} size=${36} radius=${18}/>
      </div>
      <div class="msg-col ph-col">
        ${who ? html`<div class="msg-who">${who}</div>` : null}

        ${msg.kind === 'transfer'
          ? html`<${TransferBubble} msg=${msg} onSettle=${selecting ? null : onSettle}/>`
          : msg.kind === 'request'
          ? html`<${RequestBubble} msg=${msg} onVote=${selecting ? null : onSettle}/>`
          : msg.kind === 'gift'
          ? html`<${GiftBubble} msg=${msg} onOpen=${selecting ? null : onUnwrap}/>`
          : msg.kind === 'location'
          ? html`<${LocationBubble} msg=${msg}/>`
          : msg.kind === 'call'
          ? html`<${CallBubble} msg=${msg} onOpen=${selecting ? null : onOpenLog}/>`
          : msg.kind === 'listen'
          ? html`<${ListenBubble} msg=${msg} onOpen=${selecting ? null : onOpenLog}/>`
          : msg.kind === 'song'
          ? html`<${SongBubble} msg=${msg}/>`
          : msg.kind === 'tool'
          ? html`<${ToolBubble} msg=${msg}/>`
          : msg.kind === 'watch'
          ? html`<${WatchBubble} msg=${msg}/>`
          : msg.kind === 'read'
          ? html`<${ReadBubble} msg=${msg}/>`
          : msg.kind === 'excerpt'
          ? html`<${ExcerptBubble} msg=${msg}/>`
          : msg.kind === 'pact'
          ? html`<${PactBubble} msg=${msg} onFinish=${selecting ? null : onOpenLog}/>`
          : msg.kind === 'letter'
          ? html`<${LetterBubble} msg=${msg} onOpen=${selecting ? null : onOpenLog}/>`
          : msg.kind === 'dice'
          ? html`<${DiceBubble} msg=${msg}/>`
          : msg.kind === 'takeout'
          ? html`<${TakeoutBubble} msg=${msg} onSettle=${selecting ? null : onSettle}/>`
          : msg.kind === 'trip'
          ? html`<${TripBubble} msg=${msg} onSettle=${selecting ? null : onSettle}/>`
          : msg.kind === 'award'
          ? html`<${AwardBubble} msg=${msg} mine=${mine}/>`
          : msg.kind === 'outfit'
          ? html`<${OutfitBubble} msg=${msg} mine=${mine}/>`
          : msg.kind === 'groom'
          ? html`<${GroomBubble} msg=${msg} mine=${mine}/>`
          : msg.kind === 'dresscode'
          ? html`<${DresscodeBubble} msg=${msg} mine=${mine}/>`
          : msg.kind === 'slip'
          ? html`<${SlipBubble} msg=${msg}/>`
          : msg.kind === 'card'
          ? html`<${CardBubble} msg=${msg} char=${char} chat=${chat} mine=${mine}/>`
          : msg.kind === 'forward'
          ? html`<${ForwardBubble} msg=${msg} onOpen=${selecting ? null : onOpenLog}/>`
          : msg.kind === 'sticker'
          ? html`<div class="bubble-sticker ph-sticker">
              ${sticker ? html`<${StickerImg} sticker=${sticker} size=${112}/>`
                : html`<button class="stk-gone press" onClick=${() => onBind?.(msg)}>
                    ${msg.stickerName ? `表情：${msg.stickerName}` : '表情已删除'}
                    <span class="stk-gone-hint">点击指认</span>
                  </button>`}
            </div>`
          : msg.kind === 'file'
          ? html`<${FileBubble} msg=${msg} onOpen=${onFile}/>`
          : (msg.kind === 'image' || msg.kind === 'voice' || msg.kind === 'clip')
          ? html`<${MediaBubble} msg=${msg} char=${char}/>`
          : parts.length ? parts.map((p, i) => html`
              <div key=${i}
                class=${`bubble ph-bubble ${mine ? 'ph-bubble-mine' : 'ph-bubble-theirs'}${trans && i === parts.length - 1 ? ' has-trans' : ''}`}
                onClick=${trans && i === parts.length - 1 && !selecting
                  ? () => onTrans?.(msg.id) : null}>
                ${i === 0 ? html`<${QuoteIn} quote=${quote} onClick=${() => jumpTo(quote.id)}/>` : null}
                ${p}
                ${trans && i === parts.length - 1 && showTrans ? html`
                  <div class="bubble-trans ph-trans">${trans}</div>` : null}
              </div>`)
          : null}

        <${QuoteRef} quote=${quote} onClick=${() => jumpTo(quote.id)}/>

        ${msg.inner && openInner && innerStyle !== 'card'
          ? html`<${InnerVoice} text=${msg.inner} style=${innerStyle}/>` : null}

        ${msg.status === 'error' ? html`<${FailNote} msg=${msg} onRetry=${onRetry}/>` : null}

        ${!mine && msg.ban?.length ? html`
          <div class="msg-ban">命中禁写：${msg.ban.join('、')}</div>` : null}

        ${msg.cutOff ? html`<div class="msg-cut">回复在此处中断</div>` : null}

        ${!mine && swipes.length > 1 && msg.status === 'done' ? html`
          <div class="swipes">
            <button class="swipe-btn press" onClick=${() => onSwipe(msg, -1)}>
              <${Icon} name="chevronLeft" size=${13}/></button>
            <span>${(msg.swipeIndex || 0) + 1}/${swipes.length}</span>
            <button class="swipe-btn press" onClick=${() => onSwipe(msg, 1)}>
              <${Icon} name="chevronRight" size=${13}/></button>
          </div>` : null}

        ${fold ? html`<${StackFold} count=${foldCount} onFold=${fold}/>` : null}

        ${hasMeta && slot === 'below' ? html`
          <${MsgMeta} slot=${slot} stamp=${metaStamp} read=${metaRead}/>` : null}
      </div>

      ${hasMeta && slot === 'side' ? html`
        <${MsgMeta} slot=${slot} stamp=${metaStamp} read=${metaRead}/>` : null}
    </div>`;
  if (!gone) return body;

  // 撤回了的：居中一行「某某撤回了一条消息」，点一下展开原文，再点收起。
  // 长按照样弹消息菜单（删除、多选），多选时点这一行就是选它
  return html`
    <div id=${`msg-${msg.id}`} class=${`msg-gone${selected ? ' is-picked' : ''}`}>
      <button class="recall-line no-callout ph-recall press"
        onClick=${e => {
          if (hold.current.fired) { hold.current.fired = false; return; }
          if (selecting && !frozen) { onToggle(msg); return; }
          e.stopPropagation(); setOpenGone(v => !v);
        }}
        onTouchStart=${start} onTouchEnd=${end} onTouchMove=${end} onTouchCancel=${end}
        onContextMenu=${e => { e.preventDefault(); if (!selecting && !frozen) onHold(msg); }}>
        <span>${recall.lineOf(msg, phone.remark.nameOf(char) || char?.name)}</span>
        <span class="recall-hint">${openGone ? '收起' : '查看'}</span>
      </button>
      ${openGone ? body : null}
    </div>`;
});

// 摞起来的那一叠。它不是一条消息，所以不走 Bubble 那一套（没有重试、没有候选、
// 没有译文），只借头像和左右对齐。长按任意一张进选择模式，那时整叠会摊开。
function StackRow({ msgs, char, onExpand }) {
  const mine = msgs[0].role === 'user';
  const avatar = useImage(mine ? phone.accounts.current()?.avatar : char?.avatar);
  return html`
    <div class=${`msg no-callout ph-msg ${mine ? 'ph-msg-mine is-mine' : 'ph-msg-theirs'}`}>
      <div class="msg-face no-callout ph-face">
        <${Avatar} src=${avatar} name=${mine ? phone.accounts.current()?.name : char?.name}
          size=${36} radius=${18}/>
      </div>
      <div class="msg-col ph-col">
        <${ImageStack} msgs=${msgs} onExpand=${onExpand}/>
      </div>
    </div>`;
}

export function Conversation({ chatId, focusId = '' }) {
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.characters.store);
  useStore(db.stickers.store);
  useStore(db.todos.store);
  const settings = useStore(db.settings.store);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(null);      // menu | sticker | null
  const [picking, setPicking] = useState(null);  // 'photo' 时在挑图片来源
  const [held, setHeld] = useState(null);        // 长按选中的那条
  const [picked, setPicked] = useState(null);    // null=不在多选；数组=已选的 id
  const [quoting, setQuoting] = useState(null);  // 这条要被引用
  const [recSec, setRecSec] = useState(-1);      // -1 = 没在录音
  const [paying, setPaying] = useState(false);   // 转账面板开着
  const [settling, setSettling] = useState(null);// 正在处理的那一笔
  const [asking, setAsking] = useState(false);   // 申请面板开着
  const [summing, setSumming] = useState(false); // 正在总结记忆
  const [voting, setVoting] = useState(null);    // 正在表态的那一条申请
  const [placing, setPlacing] = useState(false); // 发位置的面板开着
  const [callLog, setCallLog] = useState(null);  // 正在看的那通电话
  const [gifting, setGifting] = useState(false); // 送礼物面板开着
  const [unwrap, setUnwrap] = useState(null);    // 正在拆的那一件
  const [listenLog, setListenLog] = useState(null); // 正在看的那一场
  const [letter, setLetter] = useState(null);    // 正在读的那封信
  const [fwView, setFwView] = useState(null);    // 展开看的那条转发记录
  const [fwPick, setFwPick] = useState(false);   // 多选后选转发到哪一段
  const [pact, setPact] = useState(null);        // 正在标完成的那条约定
  const [dicing, setDicing] = useState(false);
  const [carding, setCarding] = useState(false);
  // 角色写的那个表情名没认出来时，点气泡自己指认是哪一个
  const [binding, setBinding] = useState(null);
  const [making, setMaking] = useState(false);
  const [clipText, setClipText] = useState('');   // 骰子面板开着
  const [ordering, setOrdering] = useState(false);  // 点外卖面板开着
  const [sharing, setSharing] = useState(false);    // 共享位置面板开着
  const [songing, setSonging] = useState(false);    // 挑一首歌分享出去
  const [more, setMore] = useState(false);          // 面板的「更多」开着
  const [facePick, setFacePick] = useState(false);  // 面板「线下」：就在这里还是写成长文
  const [faceSetup, setFaceSetup] = useState(false); // 切到线下的那张单子（4.269）
  const [meal, setMeal] = useState(null);           // 正在处理的那一单
  const [going, setGoing] = useState(null);         // 正在回应的那次出行
  // 只画最近这么多条。聊了两万条的会话一次性铺出来要一两秒，手机上十几秒，
  // 而且往上翻从来也不会翻到那么远。不够就按「查看更早的消息」再要一段。
  const [shown, setShown] = useState(pageSize);
  const bodyRef = useRef(null);
  const keepRef = useRef(0);      // 加载更早时用来把滚动位置钉住
  const recRef = useRef(null);
  const localRef = useRef(null);
  const imgRef = useRef(null);
  const clipRef = useRef(null);
  const docRef = useRef(null);                      // 发文件（4.271）
  const [openFile, setOpenFile] = useState(null);   // 点开看的那一份文件
  const [innerPage, setInnerPage] = useState(null); // 心声那一页：{ msgId }（4.274）

  // 气泡是记忆化的，传给它的函数属性身份必须稳定，否则每来一段流式内容
  // 整屏气泡都要重画。外面这一层永远不变，里面读 ref 拿当前这次渲染的闭包。
  const latest = useRef({});
  const stable = useMemo(() => ({
    onRetry: m => latest.current.onRetry(m),
    onSwipe: (m, d) => latest.current.onSwipe(m, d),
    onToggle: m => latest.current.togglePick(m),
    onSettle: m => latest.current.onSettle(m),
    onOpenLog: m => latest.current.onOpenLog(m),
    onUnwrap: m => latest.current.onUnwrap(m),
    onPat: () => latest.current.onPat(),
    onScene: (kind, id) => latest.current.onScene(kind, id),
    onBind: m => latest.current.onBind(m),
    onQuote: m => latest.current.onQuote(m),
    onTrans: id => latest.current.toggleTrans(id),
    onFile: m => latest.current.openFile(m),
    onInnerPage: id => latest.current.openInnerPage(id),
    noop: () => {},
  }), []);
  // 点开了译文的那几条。记在页面上，气泡重挂也保得住（4.270）
  const [transOpenIds, setTransOpenIds] = useState(() => new Set());
  const toggleTrans = id => setTransOpenIds(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const pickedSet = useMemo(() => new Set(picked || []), [picked]);
  const innerStyle = extras.innerStyle();

  useStore(db.scenes.store);
  useStore(db.beats.store);
  // 这段会话里正开着的那一场线下。开着的时候输入框整个换一套：
  // 发的是正文不是消息，回的走线下那条链路
  const live = chatId ? sceneApi.openInline(chatId) : null;
  const [look, setLook] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);   // 聊天背景面板开着
  // 会话菜单里「更换头像」那两行各一个文件框
  const charFaceRef = useRef(null);
  const myFaceRef = useRef(null);
  // 线下正在写的那一段。放在这儿而不是块里 —— 那个块是 memo 过的，
  // 每个 delta 都往里传会把整屏气泡一起重画
  const [sceneDraft, setSceneDraft] = useState('');

  // 这段会话的美化。**只在这一页挂着**，离开就摘 —— 隔离靠的就是这个，
  // 不是靠重写选择器（见 system/skin.js）。活过一帧就把「上次崩了」的
  // 记号清掉；没清掉的话下次进来这一份不注入
  const mySkin = chatId ? skin.ofChat(chatId) : null;
  useEffect(() => {
    if (mySkin) skin.mount(mySkin);
    else skin.unmount();
    const t = setTimeout(() => skin.settle(), 800);
    return () => { clearTimeout(t); skin.unmount(); };
  }, [mySkin && mySkin.id, mySkin && mySkin.updatedAt]);

  const chat = db.chats.get(chatId);
  // 聊天背景与上下栏（system/chatlook.js）。图要先取地址，所以放在提前返回之前
  const bgUrl = useImage(phone.chatLook.lookOf(chat).bg || null);
  const pageLook = phone.chatLook.pageOf(chat, bgUrl);
  useEffect(() => {
    if (!pageLook.status) return undefined;
    const root = document.documentElement.style;
    root.setProperty('--look-status-bg', pageLook.status);
    return () => root.removeProperty('--look-status-bg');
  }, [pageLook.status]);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  // 群聊：每条消息是谁说的看 authorId，头像与名字按它取。char 仍是第一个成员 ——
  // 只给那几处「这段会话属于谁」的兜底用（见 ARCHITECTURE 4.162）
  const isGroup = phone.group.isGroup(chat);
  const members = isGroup ? phone.group.members(chat) : [];
  const authorOf = id => (isGroup ? (members.find(c => c.id === id) || char) : char);
  // 群里这周的话痨、团宠、夜猫子（见 system/badges.js），跟在名字后面
  const weekly = useMemo(() => (isGroup && chat && phone.badges.shown(chat)
    ? phone.badges.weeklyTitles(chat) : new Map()), [isGroup, chatId, db.messages.indexVersion(chatId)]);
  const whoOf = m => (isGroup && m.role === 'char'
    ? [authorOf(m.authorId)?.name || '', ...(weekly.get(m.authorId) || [])].filter(Boolean).join(' · ') : '');
  // 开场白那条不入库，每次渲染现造。现造的对象身份每次都不一样，
  // 记忆化就永远判不出相等，所以这里也钉住。
  const greeting = useMemo(
    () => ({ id: 'greet', role: 'char', content: char?.firstMessage || '', status: 'done' }),
    [char?.firstMessage]);
  const msgs = chatId ? db.messagesOf(chatId) : [];
  const selecting = picked !== null;
  // 时刻与已读回执。在这一层算一次往下传标量 —— 气泡是 memo 过的，
  // 设置变了要靠属性变才重画；已读那条线也只扫一遍
  const stampAt = receipt.stampMode();
  const readOn = receipt.on();
  const readLine = readOn ? receipt.readUpTo(chatId) : 0;

  // 从搜索结果跳进来的，窗口要先开到能装下那一条
  const focusIdx = useMemo(
    () => (focusId ? msgs.findIndex(m => m.id === focusId) : -1),
    [focusId, msgs]);
  const need = focusIdx >= 0 ? msgs.length - focusIdx + 40 : 0;
  const window_ = Math.max(shown, need);
  const from = Math.max(0, msgs.length - window_);
  const view = from ? msgs.slice(from) : msgs;
  const earlier = from;

  // 连着发的几张图摞成一叠。选择模式下不摞 —— 摞着就没法单独挑其中一张。
  const [openStack, setOpenStack] = useState(() => new Set());
  const rows = useMemo(() => {
    if (selecting) return view.map(m => ({ stack: false, id: m.id, msg: m }));
    return groupImages(view).flatMap(row => {
      if (!row.stack || !openStack.has(row.id)) return [row];
      // 展开就是平常那样，一张一个气泡。最后一张下面挂「收起」
      return row.msgs.map((m, k) => ({
        stack: false, id: m.id, msg: m,
        foldOf: k === row.msgs.length - 1 ? row.id : null,
        foldCount: k === row.msgs.length - 1 ? row.msgs.length : 0,
      }));
    });
  }, [view, selecting, openStack]);
  // 最后一轮角色回复。只有它能重新生成，见下面 regenerate 的注释
  let lastTurnId = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'char' && msgs[i].turnId) { lastTurnId = msgs[i].turnId; break; }
  }
  // 「点开后下一轮收起」那一档：角色新的一轮到了，点开的全收起（4.270）。换会话也清
  useEffect(() => {
    if (settings.translateOpen === 'turn' || !lastTurnId) setTransOpenIds(prev => (prev.size ? new Set() : prev));
  }, [lastTurnId, chatId]);

  useEffect(() => {
    if (chat?.unread) db.chats.update(chatId, { unread: 0 });
  }, [chatId, chat?.unread]);

  // 互动标识跟着消息走：条数一变就同步一次，刚解锁的由 UnlockToast 放出来。
  //
  // **晚一点再算**。同步完要写回会话，会话一变整屏气泡都要重画（它们收着 chat）。
  // 刚打开、尤其是从搜索跳进一段几千条的会话时，这一下和「滚到那一条、闪一下」
  // 撞在一起，主线程被占住一秒多，闪那一下还没看见就过去了。等页面先落定
  useEffect(() => {
    if (!chatId) return undefined;
    const t = setTimeout(() => phone.badges.sync(chatId), 1500);
    return () => clearTimeout(t);
  }, [chatId, msgs.length]);

  // 录着音的时候退出这一页，麦克风会一直开着，指示灯也一直亮
  useEffect(() => () => {
    recRef.current?.cancel(); recRef.current = null;
    localRef.current?.cancel(); localRef.current = null;
  }, []);

  // 录音时长。只在录着的时候起一个计时器，停了就撤掉
  useEffect(() => {
    if (recSec < 0) return undefined;
    const t = setInterval(() => setRecSec(n => (n < 0 ? n : n + 1)), 1000);
    return () => clearInterval(t);
  }, [recSec < 0]);

  // 换一段对话、或者改了「一屏画多少条」，都把窗口收回去。
  // 从前只看 chatId：在设置里把条数调小，要退出这段对话再进来才生效，
  // 而人调它正是因为当前这段卡。
  useEffect(() => { setShown(pageSize()); }, [chatId, settings.chatPage]);

  // 「过一会儿才回」那一档：到点了就生成。
  // 定时器随页面走，但到点的时刻存在会话上，所以关掉再打开照样补得上 ——
  // 早该回的立刻回，没到的接着等。
  const pacePending = chat ? pace.pendingOf(chat) : null;
  useEffect(() => {
    if (!pacePending || busy) return undefined;
    const left = Math.max(0, pacePending.dueAt - Date.now());
    const t = setTimeout(() => {
      // 等这一会儿里人可能已经改了设置或者又发了一条，到点再确认一次
      const now = db.chats.get(chatId);
      if (!now || !pace.pendingOf(now)) return;
      pace.clear(chatId);
      generate();
    }, left);
    return () => clearTimeout(t);
  }, [pacePending?.dueAt, busy, chatId]);

  // 倒计时那一行每秒刷一下。没在等就不起这个定时器
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!pacePending) return undefined;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [pacePending?.dueAt]);

  const landed = useRef(false);
  useEffect(() => { landed.current = false; }, [chatId, focusId]);

  // 人是不是正贴着底部看。往上翻着看旧消息的时候，新消息来了不该把人拽下去 ——
  // 那是正在读的东西被抢走。离底 80 像素以内就算贴着。
  const [atBottom, setAtBottom] = useState(true);
  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };
  const toBottom = () => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // 底下的面板、引用条、输入框一变高，消息区就变矮。本来贴着底部看的，
  // 要跟着贴住 —— 不然点开加号，最新那几条就被压到面板后面，得自己往下划。
  // 变矮时视口没有滚动，onScroll 不会来，所以「贴没贴着」另记一份在 ref 里
  const bottomRef = useRef(true);
  bottomRef.current = atBottom;
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let h = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const nh = el.clientHeight;
      if (nh < h && bottomRef.current) el.scrollTop = el.scrollHeight;
      h = nh;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [chatId, !!chat]);

  // 输入栏那一组浮在消息列表上的时候（聊天背景里下面那一栏不是实色），列表底下要留出
  // 同样高的一段，最新那条才不被压在栏后面。那一组的高度会变（输入框长高、面板展开、
  // 引用条出现），量出来挂成 --foot-h；本来贴着底部看的，高度一变跟着贴住 ——
  // 这时列表本身没有变矮，上面那个观察器不会来
  const convRef = useRef(null);
  const footRef = useRef(null);
  const floatBottom = /\bfloat-bottom\b/.test(pageLook.cls);
  useLayoutEffect(() => {
    const conv = convRef.current, foot = footRef.current, body = bodyRef.current;
    if (!conv) return undefined;
    if (!floatBottom || !foot || typeof ResizeObserver === 'undefined') {
      conv.style.removeProperty('--foot-h');
      return undefined;
    }
    const apply = () => {
      conv.style.setProperty('--foot-h', `${foot.offsetHeight}px`);
      if (body && bottomRef.current) body.scrollTop = body.scrollHeight;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(foot);
    return () => { ro.disconnect(); conv.style.removeProperty('--foot-h'); };
  }, [floatBottom, chatId, !!chat]);

  // 会话顶上那几条（一起听、一起看、节奏）浮在消息列表上，消息从它们底下滚过去；
  // 列表顶上留出同样高的一段，最早那几条才不被压住。高度会变（条出现、消失、换行），
  // 量出来挂成 --strips-h。从前它们排在列表上面各占一格，列表到它们下沿就截断了
  const stripsRef = useRef(null);
  useLayoutEffect(() => {
    const conv = convRef.current, strips = stripsRef.current;
    if (!conv || !strips || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => conv.style.setProperty('--strips-h', `${strips.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(strips);
    return () => { ro.disconnect(); conv.style.removeProperty('--strips-h'); };
  }, [chatId, !!chat]);

  const last = msgs[msgs.length - 1];
  useEffect(() => {
    // 多选时别乱滚，正挑着消息呢
    if (selecting) return;
    // 从搜索跳进来的那一下，位置归那一条管，别把它顶到底下去
    if (focusId && !landed.current) return;
    // 自己刚发的一定滚到底；别人发的只在你本来就贴着底部时才滚
    if (!atBottom && last?.role !== 'user') return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, last?.content, selecting, focusId]);

  // 跳到搜索选中的那一条，闪一下。之后就交回给上面那个「新消息滚到底」。
  useEffect(() => {
    if (!focusId || landed.current || focusIdx < 0) return undefined;
    const t = setTimeout(() => {
      const el = document.getElementById(`msg-${focusId}`);
      landed.current = true;
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('is-flash');
      setTimeout(() => el.classList.remove('is-flash'), 1200);
    }, 50);
    return () => clearTimeout(t);
  }, [focusId, focusIdx]);

  // 往上加载一段之后，把视口钉在原来看的那一条上，不要因为上面多了内容就跳走
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !keepRef.current) return;
    el.scrollTop += el.scrollHeight - keepRef.current;
    keepRef.current = 0;
  }, [window_]);

  // 悬浮球「当前对话」那一组（ARCHITECTURE 4.256）：登记这一段能做的几件事，离开时撤掉。
  // 函数每次渲染都换，所以经 ref 转一道，调用的那一刻取最新的
  const qbRef = useRef({});
  useEffect(() => phone.quickball.bindChat(chatId, {
    charId: isGroup ? null : char?.id, group: isGroup,
    api: {
      generate: () => qbRef.current.generate?.(),
      regenerate: () => qbRef.current.regenerate?.(),
      summarize: () => qbRef.current.summarize?.(),
      toBottom: () => qbRef.current.toBottom?.(),
      openMenu: () => qbRef.current.openMenu?.(),
    },
  }), [chatId, char?.id, isGroup]);

  if (!chat || !char) {
    return html`<${Page} title="会话" onBack=${nav.pop}><${EmptyState} title="该会话已不存在"/><//>`;
  }

  /**
   * 线下那一段。接的是 streamScene，不是 streamReply。
   *
   * **场次现读，不吃渲染时那份 live。** 刚划完线就要开场，而那一下的闭包里
   * live 还是 null —— 拿它判断的话会走到线上那条路上去，往聊天里落一条气泡。
   */
  async function generateScene({ more = false, row: given = null } = {}) {
    if (!ai.isConfigured()) { toast('尚未配置模型接口', 'error'); return; }
    const row = given || sceneApi.openInline(chatId);
    if (!row) return;
    setBusy(true);
    setSceneDraft('');
    let buf = '';
    try {
      await ai.scene.compressIfDue(row.id).catch(() => {});
      const raw = String(await ai.streamScene({
        scene: row, chat, char, more,
        onDelta: d => { buf += d; setSceneDraft(buf); },
      }) || '');
      const { text, think } = ai.reply.stripThink(raw);
      const { text: body, stamp } = ai.reply.stripStamps(text);
      if (!body.trim()) throw new Error('模型返回了空内容');
      const told = sceneApi.beatsOf(row.id).filter(b => b.role !== sceneApi.DIRECTOR);
      const last = told.length ? told[told.length - 1] : null;
      // 这一段里角色借走、换上了什么，衣帽间已经跟着改了，提示一句（塞进包里的不提示：那是秘密）
      const had = more && last ? sceneApi.actsOf(last).length : 0;
      const done = more && last ? sceneApi.appendBeat(last.id, { text: body, raw, at: stamp })
        : sceneApi.addBeat({ sceneId: row.id, role: sceneApi.CHAR, authorId: char.id,
          text: body, raw, think, at: stamp });
      const told2 = sceneApi.actsOf(done).slice(had).filter(a => a.text);
      if (told2.length) toast(`衣帽间：${told2.map(a => a.text).join('；')}`);
      db.chats.update(chatId, { lastMessageAt: Date.now() });
      const gap = db.settings.get().autoSummarizeInterval;
      if (ai.memory.shouldAutoExtract(chatId, gap)) {
        ai.memory.extract(chatId)
          .then(r => { if (r.added || r.updated) toast(`记忆更新 ${r.added + r.updated} 条`); })
          .catch(err => console.warn('[memory] 线下自动提取失败', err));
      }
    } catch (err) {
      if (!ai.queue.isAbort(err)) toast(err.message || '生成失败', 'error');
    } finally {
      setSceneDraft('');
      setBusy(false);
    }
  }

  // 群聊一轮。一次调用写整轮，或者按开关每人一次（见 system/ai/group.js）
  async function generateGroup({ turnId, swipes } = {}) {
    setBusy(true);
    try {
      await ai.group.run(chat, { turnId, swipes, notify: true });
      if (ai.memory.shouldAutoExtract(chatId, settings.autoSummarizeInterval)) {
        ai.memory.extract(chatId)
          .then(r => { if (r.added || r.updated) toast(`记忆更新 ${r.added + r.updated} 条`); })
          .catch(err => console.warn('[memory] 自动提取失败', err));
      }
    } catch (err) {
      if (!ai.queue.isAbort(err)) {
        db.messages.create({
          chatId, role: 'char', authorId: members[0]?.id || char.id, kind: 'text',
          content: '', status: 'error', error: String(err.message || err), failedPresets: err.failedPresets || [],
        });
        toast(String(err.message || err), 'error', 4500);
      }
    } finally { setBusy(false); }
  }

  async function generate({ turnId: reuseTurn, swipes: prevSwipes } = {}) {
    const open = sceneApi.openInline(chatId);
    if (open) { await generateScene({ row: open }); return; }
    if (!ai.isConfigured()) { toast('尚未配置模型接口', 'error'); return; }
    if (isGroup) { await generateGroup({ turnId: reuseTurn, swipes: prevSwipes }); return; }
    setBusy(true);

    // 生成期间**不放占位气泡**。要说的是「对方在输入」，那句话属于标题栏，
    // 不属于消息流 —— 聊天记录里凭空多一个空泡，是这个界面在说自己的事。
    // 气泡等内容真的好了再出现。
    try {
      // 命中禁写词就再要一次。**默认一次都不重**（第 15 条：每一次都是一整次
      // 接口调用），要重几次在「设置 - 不要写这些」里自己填。
      // 重掷掉的那几版留在候选里 —— 已经付过钱的东西不悄悄扔掉。
      const tries = [];
      let clean = '';
      const rerolls = phone.ban.rerollMax();
      for (let i = 0; i <= rerolls; i++) {
        const t = String(await ai.streamReply({ chat, char }) || '').trim();
        if (!t) break;
        tries.push(t);
        clean = t;
        if (!phone.ban.scan(t).length) break;
      }
      if (!clean) throw new Error('模型返回了空内容');

      const turnId = reuseTurn || phone.uid('turn');
      const swipes = [...(prevSwipes || []), ...tries];
      // notify：人不在这个会话里（切到别的 app、锁屏、页面在后台）时，
      // 每落一条弹一条。页面不在前台时会转成系统通知，见 system/push.js
      const made = await ai.reply.renderTurn({
        chat, char, raw: clean, turnId,
        swipes, swipeIndex: swipes.length - 1, notify: true,
      });
      // 「单独生成」那一档在整轮说完之后另起一次调用。不 await：
      // 心声是背面那一层，晚一两秒出现不影响已经发出去的话。
      ai.inner.attach(chatId, made).catch(() => {});
      // 我不在，替我回一句固定的。两道闸（条数、时限）在 autoreply 里
      if (autoReply.shouldReply(chatId, 'mine')) autoReply.fire(chatId, 'mine');

      if (ai.memory.shouldAutoExtract(chatId, settings.autoSummarizeInterval)) {
        ai.memory.extract(chatId)
          .then(r => { if (r.added || r.updated) toast(`记忆更新 ${r.added + r.updated} 条`); })
          .catch(err => console.warn('[memory] 自动提取失败', err));
      }
    } catch (err) {
      if (!ai.queue.isAbort(err)) {
        // 断在回复中途：收到的那部分已经付过钱，照常落成气泡，标上在此处中断（用户要求）
        const kept = await ai.reply.keepPartial({ chat, char, err, notify: true });
        const why = `${kept.length ? '断开之前收到的部分已保留在上方。' : ''}${String(err.message || err)}`;
        db.messages.create({
          chatId, role: 'char', authorId: char.id, kind: 'text',
          content: '', status: 'error', error: why, failedPresets: err.failedPresets || [],
        });
        toast(why, 'error', 4500);
      }
    } finally { setBusy(false); }
  }

  // 引的哪一条，发的时候连内容一起存一份快照：原话被删了引用还在
  const draftQuote = () => {
    if (!quoting) return {};
    return {
      quoteId: quoting.id, quoteText: ai.reply.snippet(quoting.content),
      quoteRole: quoting.role, quoteAuthorId: quoting.authorId,
    };
  };

  // 发出去就只是发出去。要不要回复、什么时候回复由你按下面那个按钮决定。
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    // 线下开着的时候，这一下发的是正文，不是消息。规则、提示词、数据
    // 全走线下那一套，只是画在聊天里（见 ARCHITECTURE 4.110）
    const open = sceneApi.openInline(chatId);
    if (open) {
      setDraft('');
      setQuoting(null);
      sceneApi.addBeat({ sceneId: open.id, role: sceneApi.ME, text });
      db.chats.update(chatId, { lastMessageAt: Date.now() });
      generate();
      return;
    }
    const q = draftQuote();
    setDraft('');
    setQuoting(null);
    // 群里 @ 了谁。存 id，改名之后照样认得（见 system/group.js）
    const called = isGroup ? phone.group.mentionsIn(text, chat) : [];
    const msg = db.messages.create({ chatId, role: 'user', authorId: 'me', kind: 'text',
      content: text, status: 'done', ...q, ...(called.length ? { mentions: called } : {}),
      // 会话切到线下时发的，记一个 side（4.269）
      ...(phone.face.on(chat) ? { side: phone.face.FACE } : {}) });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
    // 本地那一道监督：刚发出去的这句里有没有「我想 / 打算 / 记得」一类的线索。
    // 不花钱也不延迟，落成待确认，下面那条栏问一句（见 system/todo.js）
    if (phone.todo.localOn()) {
      const hit = phone.todo.detect(text);
      if (hit) {
        // 时刻常常在上一句里（「明天七点」「叫我起来跑步」），往回翻几句
        phone.todo.propose({
          text: hit.text, chatId, charId: char.id, srcMsgId: msg.id,
          from: phone.todo.FROM_LOCAL,
          near: db.messagesOf(chatId).slice(-6, -1).map(m => m.content),
        });
      } else {
        // 反过来：先说了事，这一句才补上时刻
        phone.todo.attachTime(chatId, text);
      }
    }
    afterSend(text);
  };

  // 发完之后由谁接。三种可能，互斥：
  //   她开着自动回复  回一句固定的，不调接口，也不再排正常的回复
  //   节奏是「发完就回」立刻生成
  //   节奏是「过一会儿」 记一个到点时刻，下面那个 effect 负责等
  function afterSend(text) {
    // 自动回复是替一个角色回一句固定的话，群里没有「她」
    if (!isGroup && autoReply.shouldReply(chatId, 'hers')) { autoReply.fire(chatId, 'hers'); return; }
    const mode = pace.modeOf(db.chats.get(chatId));
    if (mode === pace.NOW) generate();
    else if (mode === pace.PACED) pace.schedule(chatId, text);
  }

  const sendSticker = s => {
    const q = draftQuote();
    db.messages.create({
      chatId, role: 'user', authorId: 'me', content: `[表情：${s.name}]`,
      kind: 'sticker', stickerId: s.id, status: 'done', ...q,
    });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
    phone.stickers.markUsed(s.id);
    setPanel(null);
    setDraft('');
    setQuoting(null);
  };

  /**
   * 发一段短视频。
   *
   * 存两份：视频本身进 files，**开头那一帧另存成图进 images** 当海报 ——
   * 气泡上先摆海报，点一下才播（长按是消息菜单，见第 12 条）。
   *
   * **角色看不到这段视频。** 聊天接口收的是文字与图片，没有视频这一档；
   * 把海报送去识图也只是在说第一帧，不是在说这段视频。所以照实写
   * 「角色看不到」，不去假装它看见了。
   */
  // 发一份文件（4.271）：存进文件域，正文带着编号进上下文，角色可以在原文件上填
  const sendFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPanel(null);
    // 默认和发图片一样，文件本身不触发回复，说一句「填一下」再回。「用量与上限」里可以改成像发一条消息那样按节奏回一次
    try {
      await phone.docfile.sendFromUser(chatId, file);
      if (settings.fileSendReplies === true) afterSend(`[文件：${file.name}]`);
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const sendClip = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPanel(null);
    const q = draftQuote();
    try {
      const { poster, duration } = await phone.clip.probe(file);
      const clipId = await db.files.put(file, { name: file.name || 'clip.mp4', type: file.type });
      const posterId = poster ? await db.images.put(new File([poster], 'poster.jpg', { type: 'image/jpeg' })) : null;
      setQuoting(null);
      db.messages.create({
        chatId, role: 'user', authorId: 'me', kind: 'clip',
        clipId, posterId, clipDur: duration,
        content: '[视频]', status: 'done', media: 'done', ...q,
      });
      db.chats.update(chatId, { lastMessageAt: Date.now() });
    } catch (err) { toast('这段视频处理失败：' + (err.message || err), 'error', 5000); }
  };

  // 发图片。聊天接口只收文字，所以图片存下来之后另外送去识图，
  // 识出来的描述写回 content，角色才知道图上有什么。识不了也照发。
  const sendImage = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPanel(null);
    const q = draftQuote();
    try {
      const imageId = await db.images.put(file);
      setQuoting(null);
      // chat 档这里不调接口，图片跟着当前这一轮的请求直接给聊天模型看，
      // 看完之后由 engine 写回一段描述（engine.js 的 describeCarried）
      const mode = ai.services.visionMode();
      const usable = mode === 'api' && ai.vision.isVisionReady();
      const msg = db.messages.create({
        chatId, role: 'user', authorId: 'me', kind: 'image',
        imageId, content: '[图片]', status: 'done', media: 'done',
        vision: mode === 'chat' ? 'chat' : usable ? 'pending' : 'off', ...q,
      });
      db.chats.update(chatId, { lastMessageAt: Date.now() });
      if (!usable) return;
      ai.vision.describeImage(imageId, `vision:${msg.id}`)
        .then(text => db.messages.update(msg.id, {
          imageDesc: text, vision: 'done', content: `[图片：${text}]`,
        }))
        .catch(err => db.messages.update(msg.id, {
          vision: 'error', visionError: String(err.message || err),
        }));
    } catch (err) { toast('图片处理失败：' + (err.message || err), 'error'); }
  };

  // 配了接口就走接口；没配就用浏览器自带的识别做保底 —— 它边说边转，
  // 不花接口的钱，代价是只有文字没有语气。
  //
  // 录不了或者识别不了，直接落到「自己打一段」那条路上：对角色来说
  // 收到的都是一条语音，没有区别，没必要为此在面板上多摆一个入口，
  // 更没必要在这里报一个错然后什么也发不出去。
  const startRec = async () => {
    setPanel(null);
    if (!ai.asr.canSendVoice()) { typeVoice(); return; }
    try {
      recRef.current = await phone.audio.record();
      localRef.current = ai.asr.isAsrReady() ? null : phone.audio.listenLocally();
      setRecSec(0);
    } catch (err) {
      toast('无法录音，改为输入文字', 'plain');
      typeVoice();
    }
  };

  // 录音条上的「改为输入」。录着录着说不出口，撤掉这一次，改成自己打。
  const writeInstead = () => { cancelRec(); typeVoice(); };

  const cancelRec = () => {
    recRef.current?.cancel();
    recRef.current = null;
    localRef.current?.cancel();
    localRef.current = null;
    setRecSec(-1);
  };

  // 原件按录下来的格式存着，送去识别前才临时转成 wav（见 system/audio.js）
  const sendRec = async () => {
    const h = recRef.current;
    const local = localRef.current;
    recRef.current = null;
    localRef.current = null;
    setRecSec(-1);
    if (!h) return;
    const q = draftQuote();
    try {
      const { blob, seconds } = await h.stop();
      const heard = local ? await local.stop() : null;
      const audioId = await db.files.put(blob, { name: `voice-${Date.now()}`, type: blob.type });
      setQuoting(null);

      // 浏览器那条路是边说边转的，停下来时文字已经有了，直接落库
      const done = heard && heard.text;
      const msg = db.messages.create({
        chatId, role: 'user', authorId: 'me', kind: 'voice',
        audioId, seconds, status: 'done', media: 'done',
        ...(done
          ? { voiceText: heard.text, tone: '', asr: 'done', content: `[语音：${heard.text}]` }
          : { content: '[语音]', asr: local ? 'error' : 'pending',
              ...(local ? { mediaError: '本机识别没有听出内容' } : {}) }),
        ...q,
      });
      db.chats.update(chatId, { lastMessageAt: Date.now() });
      if (local) return;

      ai.asr.listen({ blob, key: `asr:${msg.id}` })
        .then(r => db.messages.update(msg.id, {
          voiceText: r.text, tone: r.tone || '', asr: 'done',
          content: `[语音：${r.text}]${r.tone ? `（听起来${r.tone}）` : ''}`,
        }))
        .catch(err => db.messages.update(msg.id, {
          asr: 'error', mediaError: String(err.message || err),
        }));
    } catch (err) { toast('录音失败：' + (err.message || err), 'error', 5000); }
  };

  // 不想开口的时候，自己打一段字发成语音。角色那边看到的和真录一段没有区别。
  const typeVoice = async () => {
    setPanel(null);
    const text = await prompt({
      title: '输入语音内容', multiline: true, okText: '发送',
      message: '将作为一条语音发出，角色收到的内容与录音一致。',
    });
    const t = String(text || '').trim();
    if (!t) return;
    const q = draftQuote();
    setQuoting(null);
    db.messages.create({
      chatId, role: 'user', authorId: 'me', kind: 'voice',
      audioId: null, seconds: Math.max(1, Math.round(t.length / 4)),
      voiceText: t, asr: 'done', status: 'done', media: 'done',
      content: `[语音：${t}]`, ...q,
    });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
  };

  // 用文字发一张图。和「改为输入」发语音同一个道理：手边没有那张图，或者那张图
  // 本来就不存在，写下画面发出去。角色收到的是 [图片：…]，和识图读出来的是同一种东西，
  // 所以这一条不走识图，也不占生图接口
  const typePhoto = async () => {
    setPicking(null);
    const text = await prompt({
      title: '输入图片内容', multiline: true, okText: '发送', placeholder: '描述图片上的画面',
      message: '将作为一张图片发出。角色收到的是这段描述，与识图读出的结果相同。',
    });
    const t = String(text || '').trim();
    if (!t) return;
    const q = draftQuote();
    setQuoting(null);
    db.messages.create({
      chatId, role: 'user', authorId: 'me', kind: 'image', imageId: null,
      imageDesc: t, vision: 'done', status: 'done', media: 'text',
      content: `[图片：${t}]`, ...q,
    });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
  };

  // 整轮删掉重来，新原文追加进候选。
  //
  // 只有最后一轮能重新生成。重生成中间某一轮，模型看到的历史里
  // 还带着它后面那些消息 —— 那些本来是对旧回复的回应，
  // 拿它们当上下文生成「旧回复」，出来的东西自相矛盾。
  const regenerate = async turnId => {
    const tid = turnId || lastTurnId;
    if (!tid) { generate(); return; }
    const head = ai.reply.turnMessages(chatId, tid)[0];
    const swipes = head?.swipes || [];
    ai.reply.clearTurn(chatId, tid);
    await generate({ turnId: tid, swipes });
  };

  // 切换候选不再调接口，拿存下来的原文整轮重放
  const onSwipe = async (msg, dir) => {
    const swipes = msg.swipes || [];
    if (swipes.length < 2) return;
    const i = ((msg.swipeIndex || 0) + dir + swipes.length) % swipes.length;
    const turnId = msg.turnId;
    ai.reply.clearTurn(chatId, turnId);
    if (isGroup) {
      await ai.group.replay(chat, swipes[i], { turnId, swipes, swipeIndex: i, instant: true });
      return;
    }
    await ai.reply.renderTurn({
      chat, char, raw: swipes[i], turnId, swipes, swipeIndex: i,
      instant: true,                 // 重放不需要逐条停顿
    });
  };

  // 删消息之前先记下「已总结到这儿」那条的时间点。
  // 它要是被删了，pendingOf 找不到锚点会当成一条都没总结过，
  // 下次总结把整段重来一遍。往前挪到还在的那条上。
  const dropMessages = ids => {
    if (!ids.length) return;
    const anchorId = chat.memoryUpTo;
    const anchorAt = anchorId ? db.messages.get(anchorId)?.createdAt : null;
    ids.forEach(id => ai.reply.dropMessage(id));
    if (anchorId && !db.messages.has(anchorId)) {
      const prev = db.messagesOf(chatId).filter(m => m.createdAt <= anchorAt).pop();
      db.chats.update(chatId, { memoryUpTo: prev ? prev.id : null });
    }
    // 引用指向的原话没了也不清 quoteId：quoteText 那份快照还在，气泡照常显示
  };

  const onRetry = msg => {
    db.messages.remove(msg.id);
    generate();
  };

  const startCall = video => {
    try { call.dial(chatId, { video }); }
    catch (err) { toast(String(err.message || err), 'error', 4000); }
  };

  const loadEarlier = () => {
    keepRef.current = bodyRef.current?.scrollHeight || 0;
    setShown(n => Math.max(n, window_) + pageSize());
  };

  const togglePick = msg => setPicked(cur =>
    cur.includes(msg.id) ? cur.filter(x => x !== msg.id) : [...cur, msg.id]);

  // 上面那几个每次渲染都是新函数，兜进 ref 里，对外的 stable 不变
  // 「点开看」这一件事四种气泡共用一个入口，按 kind 分流。各给一个 prop 的话，
  // 气泡的记忆化就得多认四个函数身份，流式回复时每来一段都要重画一屏。
  // 手动拉一次她在听什么。自动那条路按设置的间隔走，这里不看间隔，
  // 点了就拉 —— 点它的人就是想现在知道。
  const pullMusic = async () => {
    setMenu(false);
    try {
      const got = await phone.netease.pullRecent(char.id);
      const first = got.songs[0];
      toast(`${got.kind === 'recent' ? '刚刚在听' : '最近常听'}：${first.title}`, 'ok', 4000);
    } catch (e) {
      toast('读取失败：' + (e.message || e), 'error', 5000);
    }
  };

  const openLog = m => (m.kind === 'listen' ? setListenLog(m)
    : m.kind === 'letter' ? setLetter(m)
    : m.kind === 'forward' ? setFwView(m)
    : m.kind === 'pact' ? setPact(m)
    : setCallLog(m));
  // 「处理对方发来的那一件」两种气泡共用一个入口，按 kind 分流。
  // 各给一个 prop 的话，气泡的记忆化就得多认一个函数身份。
  const settleAny = m => (m.kind === 'takeout' ? setMeal(m)
    : m.kind === 'trip' ? setGoing(m)
    : m.kind === 'request' ? setVoting(m) : setSettling(m));
  latest.current = { onRetry, onSwipe, togglePick, onSettle: settleAny, toggleTrans, openFile: setOpenFile,
    openInnerPage: id => setInnerPage({ msgId: id }),
    // 滑一下引用（见 Bubble 里的 swipe）。和长按菜单里「引用」是同一件事
    onQuote: m => { setQuoting(m); setPanel(null); try { navigator.vibrate?.(10); } catch { /* 不支持就算了 */ } },
    onOpenLog: openLog, onUnwrap: setUnwrap,
    // 拍一拍是对着一个人的，群里点头像只看心声
    onPat: () => { if (!isGroup) extras.pat({ chatId, role: 'user' }); },
    onScene: (kind, id) => {
      if (kind === 'look') setLook(true);
      else if (id) nav.push(`/scene/${id}/edit`);
    },
    onBind: m => setBinding(m) };

  const deletePicked = async () => {
    if (!picked.length) return;
    if (!await confirm({
      title: `删除 ${picked.length} 条消息`,
      message: '删除后不再进入上下文。', danger: true,
    })) return;
    dropMessages(picked);
    setPicked(null);
  };

  // 多选几条存成相册里的一张卡片。
  //
  // 存的是**冻起来的副本 + 当时那段美化 CSS 原文**，所以以后换了美化、
  // 甚至把这段对话删了，这张卡片仍是当时的样子（见 system/album.js）。
  // png 是顺带在后台画的：画不出来不影响卡片本身，所以不挡着用户。
  const shotPicked = async () => {
    if (!picked.length) return;
    const order = view.filter(m => picked.includes(m.id));
    const me = phone.accounts.current();
    const frozen = phone.album.freeze(order, { meName: me?.name || '我', meAvatar: me?.avatar || null });
    const css = phone.album.currentCss();
    try {
      const photo = await phone.album.saveCard({ msgs: frozen, css, title: char.name });
      setPicked(null);
      toast(`已存入相册，共 ${frozen.length} 条`, 'ok');
      phone.cardshot.rasterCard({ msgs: frozen, css }).then(async blob => {
        if (!blob) return;
        // 按卡片的上限存。默认那档 1280 会把长卡片压成一条糊的（见 PhotoPage 同一处）
        const id = await db.images.put(
          new File([blob], 'card.png', { type: 'image/png' }), phone.cardshot.MAX_SIDE);
        phone.album.attachRaster(photo.id, id);
      }).catch(() => { /* 画不出来就只留快照那一份 */ });
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  // 总结要走一次接口，真机上十几二十秒。**菜单先别关。**
  // 从前是点完立刻 setMenu(false)，于是屏幕上只发生了一件事：菜单没了，
  // 人回到聊天页，没有任何迹象说明它在干活 —— 看着就是「点了没用」。
  // 现在这一行自己转着，完成才收起菜单；失败则留在原地，把原因贴在这一行边上。
  const summarize = async () => {
    if (summing) return;
    // 积压太多时先把账摆出来。从别处迁进来几万条消息的话，
    // 一次总结只吃最早的一批，追平要按很多次 —— 按之前得知道这件事
    if (runs > 1 && !await confirm({
      title: '总结记忆',
      message: `这段对话尚有 ${pending} 条未总结。一次总结最早的 ${ai.memory.batchSize() || pending} 条，`
        + `追平需要重复 ${runs} 次，每次调用一次接口。现在只总结最早的那一批。`,
      okText: '总结这一批',
    })) return;
    setSumming(true);
    try {
      const r = await ai.memory.extract(chatId);
      setMenu(false);
      toast(r.added + r.updated ? `新增 ${r.added} 条，更新 ${r.updated} 条` : '没有需要记录的新信息');
    } catch (err) {
      toast(String(err.message || err), 'error', 4000);
    } finally { setSumming(false); }
  };

  qbRef.current = { generate: () => generate(), regenerate: () => regenerate(), summarize, toBottom, openMenu: () => setMenu(true) };

  const pending = ai.memory.pendingOf(chatId).length;
  // 那年今天：只在往年的今天有记录时出现在菜单里。菜单开着才翻，翻一遍要过整段历史
  const otdYears = menu ? phone.onThisDay.ofChat(chatId) : [];
  // 追平积压要按几次。1 次是常态，迁进来一堆历史时会很大
  const runs = ai.memory.runsFor(chatId);

  // 不调接口，直接把积压划掉。迁进来一堆历史又不想为它们付钱时用
  const skipSummary = async () => {
    if (!pending) { toast('没有未总结的消息'); return; }
    if (!await confirm({
      title: '标记为已总结', danger: true, okText: '标记',
      message: `将把 ${pending} 条消息记为已总结，不调用接口，也不会生成任何记忆。`
        + '此后只总结新产生的对话。已有的记忆不受影响。',
    })) return;
    const n = ai.memory.markCaughtUp(chatId);
    setMenu(false);
    toast(`已标记 ${n} 条`, 'ok');
  };

  const pro = ai.proactive.configOf(char);
  const proDesc = pro.proactive
    ? `平均每 ${pro.proactiveMinutes < 60
        ? pro.proactiveMinutes + ' 分钟'
        : Math.round(pro.proactiveMinutes / 60) + ' 小时'}一次`
    : '';

  // 每一格干什么。哪些留在面板上、什么顺序，由 system/panel.js 里用户
  // 自己排的那一份决定，这里只负责「按下之后发生什么」。
  const TAP = {
    photo: () => setPicking('photo'),
    voice: startRec,
    transfer: () => setPaying(true),
    call: () => startCall(false),
    video: () => startCall(true),
    gift: () => setGifting(true),
    location: () => setPlacing(true),
    listen: () => nav.push(`/listen/${chatId}`),
    song: () => setSonging(true),
    watch: () => phone.intent.open('theater', { route: `/watch/${chatId}` }),
    takeout: () => setOrdering(true),
    request: () => setAsking(true),
    share: () => setSharing(true),
    dice: () => setDicing(true),
    card: () => setCarding(true),
    file: () => docRef.current?.click(),
    makeclip: () => {
      if (!ai.video.isVideoReady()) {
        toast('还没有配置视频接口，请在「设置 - 生成视频」中添加', 'error', 4500);
        return;
      }
      setClipText(''); setMaking(true);
    },
    // 先问一句是就在这里用气泡演（4.269），还是写成长文（4.107 / 4.110）
    offline: () => setFacePick(true),
    offlineProse: () => {
      if (stage.get().placement !== 'inline') { nav.push(`/stage/${chatId}`); return; }
      if (live) { toast('这一场还没有收场'); return; }
      const row = sceneApi.create({ chatId, castIds: [char.id], inline: true });
      db.messages.create({ chatId, role: 'user', authorId: 'me', kind: 'scene',
        sceneId: row.id, content: '[线下]', status: 'done' });
      db.chats.update(chatId, { lastMessageAt: Date.now() });
      // 把这一场直接交出去。这时候 live 还是创建之前那份
      if (row.opening === sceneApi.CHAR) generateScene({ row });
    },
  };
  // 群里说得通的那几格。转账、礼物、通话、一起听这些都是对着一个人的
  const GROUP_TAPS = new Set(['photo', 'voice', 'dice', 'makeclip', 'song']);
  const runTap = id => {
    if (isGroup && !GROUP_TAPS.has(id)) { toast('群聊中不可用'); return; }
    (TAP[id] || (() => toast('这一项尚未实现')))();
  };
  const PANEL_ITEMS = [
    ...panelCfg.onPanel().filter(id => !isGroup || GROUP_TAPS.has(id))
      .map(id => ({ ...panelCfg.itemOf(id), onTap: () => runTap(id) })),
    { id: '_more', icon: 'more', label: '更多', onTap: () => setMore(true) },
  ];

  // 在会话里直接换头像，不必进角色卡或主页（system/avatar.js 的 setFace）
  const changeFace = async (e, who) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await phone.avatarLink.setFace(who, file);
      setMenu(false);
      toast('已更换头像', 'ok');
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  const quotingRef = quoting ? quoteOf({ quoteId: quoting.id }, { char, chat }) : null;
  // 这段对话里等着确认的第一条。一条一条问，不堆在一起
  const todoAsk = phone.todo.pendingOf(chatId)[0] || null;
  // 那句话里说了时刻的（「明天七点」），计入这一下把闹钟一并排上 ——
  // 点「计入」本来就是「记着，到点叫我」的意思，不该再让人进一次待办去排
  const takeTodo = async () => {
    if (!todoAsk) return;
    phone.todo.accept(todoAsk.id);
    const at = phone.alarm.timeOf(todoAsk);
    if (!phone.alarm.isFuture(at)) { toast('已计入待办', 'ok'); return; }
    const r = await phone.alarm.schedule(todoAsk.id).catch(() => ({ native: false }));
    toast(r.native
      ? `已计入待办，${phone.when.show(at)} 响铃`
      : `已计入待办，${phone.when.show(at)} 提醒`, 'ok', 4000);
  };
  const canRegen = !!(held && held.role === 'char' && held.turnId && held.turnId === lastTurnId);

  return html`
    <${Page} title=${selecting ? `已选 ${picked.length} 条`
      : busy ? html`<span class="conv-typing">正在输入</span>`
      : isGroup ? html`${phone.group.titleOf(chat)}（${members.length}）<${StreakMark} chat=${chat}/>`
      : html`${phone.remark.nameOf(char)}<${StreakMark} chat=${chat}/>`}
      onBack=${selecting ? () => setPicked(null) : nav.pop} noScroll
      cls=${pageLook.cls} vars=${pageLook.vars} statusBarStyle=${pageLook.fg || undefined}
      right=${selecting
        ? html`<button class="nav-text press" onClick=${() => setPicked(view.map(m => m.id))}>全选</button>`
        : html`<${IconButton} name="more" onClick=${() => setMenu(true)} label="更多" cls="ph-nav-action"/>`}>
      <div class="conv ph-chat" ref=${convRef}>
        <${UnlockToast} chatId=${chatId}/>
        <div class="conv-main">
        <div class="conv-strips" ref=${stripsRef}>
        <${ListenBar} chatId=${chatId}/>
        <${WatchBar} chatId=${chatId}/>
        ${phone.face.on(chat) ? html`<${FaceBar} chat=${chat} onEdit=${() => setFaceSetup(true)}/>` : null}
        ${(() => {
          const banner = autoReply.bannerOf(chat);
          const left = pace.leftOf(chat);
          const line = [banner, left === null ? '' : `已送达 · ${pace.pendingText(chat)}`]
            .filter(Boolean).join(' · ');
          return line ? html`
            <button class="pace-bar ph-toolbar press" onClick=${() => nav.push(`/pace/${chatId}`)}>
              ${line}
            </button>` : null;
        })()}
        </div>
        <div class="conv-body ph-chat-body scroll" ref=${bodyRef} onScroll=${onScroll}>
          ${!isGroup && char.firstMessage && !msgs.length ? html`
            <${Bubble} msg=${greeting} char=${char} chat=${chat} frozen
              onRetry=${stable.onRetry} onSwipe=${stable.onSwipe}
              onHold=${stable.noop} onToggle=${stable.noop}/>` : null}
          ${earlier ? html`
            <button class="conv-earlier press" onClick=${loadEarlier}>
              查看更早的消息（还有 ${earlier} 条）</button>` : null}
          ${rows.map((row, i) => {
            const head = row.stack ? row.msgs[0] : row.msg;
            const prevRow = rows[i - 1];
            const prev = prevRow ? (prevRow.stack ? prevRow.msgs[prevRow.msgs.length - 1] : prevRow.msg) : null;
            const sep = stampAt === 'gap' && receipt.needSep(prev, head);
            return [
              sep ? html`<${TimeSep} key=${`sep-${row.id}`} at=${head.createdAt}/>` : null,
              row.stack ? html`
            <${StackRow} key=${row.id} msgs=${row.msgs} char=${authorOf(row.msgs[0].authorId)}
              onExpand=${() => setOpenStack(s => new Set(s).add(row.id))}/>`
          : html`
            <${Bubble} key=${row.id} msg=${row.msg} char=${authorOf(row.msg.authorId)} chat=${chat}
              who=${whoOf(row.msg)} cont=${!sep && contOf(prev, row.msg)}
              onRetry=${stable.onRetry} onSwipe=${stable.onSwipe} onHold=${setHeld}
              onBind=${stable.onBind} onQuote=${stable.onQuote}
              selecting=${selecting} selected=${selecting && pickedSet.has(row.id)}
              onToggle=${stable.onToggle} onTrans=${stable.onTrans} onFile=${stable.onFile}
              transOpen=${settings.translateOpen === 'always' ? 'always' : transOpenIds.has(row.id)}
              onSettle=${stable.onSettle} onOpenLog=${stable.onOpenLog}
              onUnwrap=${stable.onUnwrap} onPat=${stable.onPat}
              onScene=${stable.onScene} innerStyle=${innerStyle} onInnerPage=${stable.onInnerPage}
              stampAt=${stampAt} readOn=${readOn} readUpTo=${readLine}
              fold=${row.foldOf ? () => setOpenStack(s => {
                const n = new Set(s); n.delete(row.foldOf); return n;
              }) : null}
              foldCount=${row.foldCount}/>`];
          })}
          ${live && sceneDraft ? html`
            <div class="sc-block sc-live" style=${stage.varsOf(stage.forScene(live))}>
              <div class="sg-text">${sceneDraft}</div>
            </div>` : null}
          ${!msgs.length && (isGroup || !char.firstMessage) ? html`
            <div class="conv-hint">${isGroup
              ? '发送第一条消息开始群聊。输入 @ 可指定成员回复'
              : '发送第一条消息开始对话'}</div>` : null}
        </div>

        ${!atBottom && !selecting ? html`
          <button class="to-bottom press" onClick=${toBottom} aria-label="回到最新">
            <${Icon} name="chevronDown" size=${18}/>
          </button>` : null}
        </div>

        <div class="conv-foot" ref=${footRef}>
        ${recSec >= 0 ? html`
          <div class="select-bar ph-toolbar">
            <button class="nav-text press" onClick=${cancelRec}>取消</button>
            <span class="rec-live">
              <span class="rec-dot"></span>
              ${`${String(Math.floor(recSec / 60)).padStart(2, '0')}:${String(recSec % 60).padStart(2, '0')}`}
              <button class="rec-write press" onClick=${writeInstead}>改为输入</button>
            </span>
            <button class="nav-text press" onClick=${sendRec}>发送</button>
          </div>`
        : selecting ? html`
          <div class="select-bar ph-toolbar">
            <button class="nav-text press" onClick=${() => setPicked(null)}>取消</button>
            <span class="select-hint">
              ${picked.length ? '' : '点击消息进行选择'}
            </span>
            <button class=${`nav-text press${picked.length ? '' : ' is-off'}`}
              onClick=${() => { if (picked.length) setFwPick(true); }}>转发</button>
            <button class=${`nav-text press${picked.length ? '' : ' is-off'}`}
              onClick=${shotPicked}>存为图片</button>
            <button class=${`nav-text press${picked.length ? ' is-danger' : ' is-off'}`}
              onClick=${deletePicked}>删除</button>
          </div>`
        : html`
          ${draft.trim() && panel !== 'sticker'
            ? html`<${StickerSuggest} text=${draft} onSend=${sendSticker}/>` : null}

          ${todoAsk ? html`
            <div class="todo-bar ph-toolbar">
              <div class="todo-ask">
                <span class="todo-tag">${phone.alarm.timeOf(todoAsk)
                  ? phone.when.show(phone.alarm.timeOf(todoAsk))
                  : phone.todo.fromLabel(todoAsk.from)}</span>
                <b>${todoAsk.text}</b>
              </div>
              <button class="nav-text press" onClick=${takeTodo}>计入<//>
              <button class="nav-text press is-off"
                onClick=${() => phone.todo.ignore(todoAsk.id)}>忽略<//>
            </div>` : null}

          ${quotingRef ? html`
            <div class="quote-bar">
              <${QuoteRef} quote=${quotingRef} onClick=${() => jumpTo(quoting.id)}/>
              <button class="press" onClick=${() => setQuoting(null)} aria-label="不引用了">
                <${Icon} name="close" size=${15}/></button>
            </div>` : null}

          ${isGroup ? html`<${MentionBar} chat=${chat} draft=${draft} onPick=${setDraft}/>` : null}

          <${ComposerBar} draft=${draft} live=${!!live} busy=${busy}
            onDraft=${setDraft} onSend=${send}
            onMenu=${() => setPanel(panel === 'menu' ? null : 'menu')}
            onSticker=${() => setPanel(panel === 'sticker' ? null : 'sticker')}
            onMore=${() => generateScene({ more: true })}
            onLook=${() => setLook(true)}
            onStop=${() => (live ? ai.cancelScene(live.id)
              : isGroup ? ai.group.stop(chat) : ai.cancelReply(chatId, char.id))}
            onGenerate=${() => generate()}/>

          ${panel && !live ? html`
            <div class="composer-panel ph-panel">
              ${panel === 'menu'
                ? html`<div class="panel-grid">
                    ${PANEL_ITEMS.map(it => html`
                      <button key=${it.id} class="panel-item press"
                        onClick=${() => { setPanel(null); it.onTap && it.onTap(); }}>
                        <div class="panel-icon"><${Icon} name=${it.icon} size=${20}/></div>
                        <span>${it.label}</span>
                      </button>`)}
                  </div>`
                : html`<${StickerPanel} onSend=${sendSticker}/>`}
            </div>` : null}`}
        </div>
      </div>

      <input type="file" accept="image/*" ref=${imgRef}
        onChange=${sendImage} style="display:none"/>

      <input type="file" accept="video/*" ref=${clipRef}
        onChange=${sendClip} style="display:none"/>
      <input type="file" accept=${phone.docfile.ACCEPT} ref=${docRef}
        onChange=${sendFile} style="display:none"/>
      ${openFile ? html`<${FileSheet} msg=${openFile} chatId=${chatId} onClose=${() => setOpenFile(null)}/>` : null}
      ${innerPage ? html`<${InnerSheet} chatId=${chatId} msgId=${innerPage.msgId} char=${char} onClose=${() => setInnerPage(null)}/>` : null}

      <${CallLogSheet} msg=${callLog} onClose=${() => setCallLog(null)}/>
      <${ListenLogSheet} msg=${listenLog} onClose=${() => setListenLog(null)}/>
      <${GiftSheet} open=${gifting} chatId=${chatId} onClose=${() => setGifting(false)}/>
      <${UnwrapSheet} msg=${unwrap} onClose=${() => setUnwrap(null)}/>
      <${LetterSheet} msg=${letter} onClose=${() => setLetter(null)}/>
      <${ForwardSheet} msg=${fwView} onClose=${() => setFwView(null)}/>
      <${ForwardPickSheet} open=${fwPick} fromChatId=${chatId} count=${picked?.length || 0}
        onClose=${() => setFwPick(false)}
        onPick=${target => {
          try {
            phone.forward.send({ from: chatId, to: target.id, list: view.filter(m => picked.includes(m.id)) });
            toast(`已转发给「${phone.forward.titleOf(target)}」`, 'ok');
            setFwPick(false); setPicked(null);
          } catch (e) { toast(String(e.message || e), 'error'); }
        }}/>
      <${PactSheet} msg=${pact} onClose=${() => setPact(null)}/>
      <${DiceSheet} open=${dicing} chatId=${chatId} onClose=${() => setDicing(false)}/>
      <${CardSendSheet} open=${carding} char=${char} chat=${chat} onClose=${() => setCarding(false)}/>

      <${Sheet} open=${!!binding} onClose=${() => setBinding(null)} title="指认这个表情" height="76%">
        <div class="settings-foot">
          没有找到名为「${binding?.stickerName || ''}」的表情。
          选择一个之后，这条消息将显示该表情；这个名称会一并记为它的关键词，
          之后再写同一个名称即可自动匹配。
        </div>
        <${StickerPanel} onSend=${s => {
    const m = binding;
    setBinding(null);
    if (!m) return;
    phone.stickers.learnName(s.id, m.stickerName);
    db.messages.update(m.id, { stickerId: s.id, content: `[表情：${s.name}]` });
    toast('已指认', 'ok');
  }}/>
      <//>

      <${Sheet} open=${making} onClose=${() => setMaking(false)} title="生成视频">
        <${Textarea} rows=${4} value=${clipText} onInput=${setClipText}
          placeholder="描述要生成的画面"/>
        <div class="settings-foot">
          由所选的视频接口生成，通常需要一到五分钟。期间可以离开这一页，
          生成完成后会出现在这段对话里。按时长与分辨率计费。
        </div>
        <${Button} full disabled=${!clipText.trim()} onClick=${() => {
    const prompt = clipText.trim();
    setMaking(false);
    const msg = db.messages.create({
      chatId, role: 'user', authorId: 'me', kind: 'clip',
      prompt, content: `[视频：${prompt}]`, status: 'done', media: 'pending',
    });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
    ai.reply.generateClip(msg.id, prompt);
  }}>开始生成<//>
      <//>
      <${TakeoutSheet} open=${ordering} chatId=${chatId} onClose=${() => setOrdering(false)}/>
      <${ShareSheet} open=${sharing} chatId=${chatId} onClose=${() => setSharing(false)}/>
      <${SongPicker} open=${songing} onClose=${() => setSonging(false)}
        onPick=${song => { try { phone.music.share({ chatId, song }); } catch (err) { toast(String(err.message || err), 'error'); } }}/>
      <${MealSettleSheet} msg=${meal} onClose=${() => setMeal(null)}/>
      <${TripSettleSheet} msg=${going} onClose=${() => setGoing(null)}/>
      <${MoreSheet} open=${more} onClose=${() => setMore(false)} onTap=${runTap}/>
      <${FaceChooser} open=${facePick} onClose=${() => setFacePick(false)}
        onHere=${() => setFaceSetup(true)} onProse=${() => TAP.offlineProse()}/>
      ${faceSetup ? html`<${FaceSheet} open=${faceSetup} chat=${chat} chars=${isGroup ? phone.group.members(chat) : [char]}
        onClose=${() => setFaceSetup(false)}/>` : null}
      <${PhotoSource} open=${picking === 'photo'} onClose=${() => setPicking(null)}
        onFile=${() => { setPicking(null); imgRef.current?.click(); }}
        onClip=${() => { setPicking(null); clipRef.current?.click(); }}
        onText=${typePhoto}
        onPick=${async id => {
          setPicking(null);
          const q = draftQuote();
          setQuoting(null);
          db.messages.create({
            chatId, role: 'user', authorId: 'me', kind: 'image',
            imageId: id, content: '[图片]', status: 'done', media: 'done',
            vision: 'off', ...q,
          });
          db.chats.update(chatId, { lastMessageAt: Date.now() });
        }}/>
      <${TransferSheet} open=${paying} chatId=${chatId} onClose=${() => setPaying(false)}/>
      <${LocationSheet} open=${placing} chatId=${chatId} onClose=${() => setPlacing(false)}/>
      <${SettleSheet} msg=${settling} onClose=${() => setSettling(null)}/>
      <${RequestSheet} open=${asking} chatId=${chatId} onClose=${() => setAsking(false)}/>
      <${VoteSheet} msg=${voting} onClose=${() => setVoting(null)}/>

      <${MsgMenu} msg=${held} char=${held ? authorOf(held.authorId) : char} onClose=${() => setHeld(null)}
        onRegenerate=${canRegen ? () => regenerate(held.turnId) : null}
        onQuote=${m => { setQuoting(m); setPanel(null); }}
        onMultiSelect=${m => { setPicked([m.id]); setPanel(null); }}
        onDelete=${id => dropMessages([id])}/>

      <${FullSheet} open=${menu} onClose=${() => setMenu(false)}
        title=${isGroup ? phone.group.titleOf(chat) : phone.remark.nameOf(char)}>
        ${isGroup ? html`
        <${List} title="这个群">
          <${ListItem} title="群资料" arrow
            subtitle=${members.map(c => phone.remark.nameOf(c)).join('、')}
            left=${html`<${Icon} name="users" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/group/${chatId}`); }}/>
          ${members.map(c => html`
            <${ListItem} key=${c.id} title=${`${phone.remark.nameOf(c)} 的角色卡`} arrow
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => { setMenu(false); nav.push(`/edit/${c.id}`); }}/>`)}
        <//>` : html`
        <${List} title="这个角色">
          <${ListItem} title="角色卡" arrow
            subtitle="形象照、人设、当日日程与各项能力的开关"
            left=${html`<${Icon} name="user" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/card/${char.id}`); }}/>
          <${ListItem} title="备注" arrow
            right=${phone.remark.mineOf(char) || '未设置'}
            left=${html`<${Icon} name="edit" size=${18}/>`}
            onClick=${async () => {
              const v = await prompt({ title: '设置备注', value: phone.remark.mineOf(char),
                placeholder: char.name,
                message: `会话列表与标题显示备注。角色知道你给它设的备注。留空则显示本名「${char.name}」。` });
              if (v !== null) phone.remark.setMine(char.id, v);
            }}/>
          <${ListItem} title="角色主页" arrow
            left=${html`<${Icon} name="camera" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/profile/${char.id}`); }}/>
          <${ListItem} title="主动发起对话" arrow
            subtitle=${proDesc}
            right=${pro.proactive ? '已开启' : '关闭'}
            left=${html`<${Icon} name="bell" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/proactive/${char.id}`); }}/>
          ${phone.netease.cookieOf(char.id) ? html`
            <${ListItem} title="查看角色在听什么" arrow
              subtitle=${(() => {
                const np = char.nowPlaying;
                if (!np?.songs?.length) return '读取播放记录，写入本轮上下文';
                const first = np.songs[0];
                return `${np.kind === 'recent' ? '刚刚在听' : '最近常听'}：`
                  + `${first.title}${first.artist ? ' — ' + first.artist : ''}`;
              })()}
              left=${html`<${Icon} name="music" size=${18}/>`}
              onClick=${pullMusic}/>` : null}
        <//>`}

        <input type="file" accept="image/*" ref=${charFaceRef}
          onChange=${e => changeFace(e, { charId: char.id })} style="display:none"/>
        <input type="file" accept="image/*" ref=${myFaceRef}
          onChange=${e => changeFace(e, { personaId: chat.personaId || phone.accounts.current()?.id })} style="display:none"/>
        <${List} title="头像">
          ${isGroup ? null : html`
            <${ListItem} title="更换角色的头像" arrow multiline
              subtitle="换下来的那张保留在角色主页，可以换回"
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => charFaceRef.current?.click()}/>`}
          <${ListItem} title="更换我的头像" arrow multiline
            subtitle=${isGroup ? '所有会话中的头像一起更换' : '所有会话中的头像一起更换，角色会注意到'}
            left=${html`<${Icon} name="camera" size=${18}/>`}
            onClick=${() => myFaceRef.current?.click()}/>
        <//>

        <${List} title="这段对话">
          <${ListItem} title="搜索聊天记录" arrow
            right=${`${msgs.length} 条`}
            left=${html`<${Icon} name="search" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/search/${chatId}`); }}/>
          <${ListItem} title="互动标识" arrow
            subtitle=${(() => {
              const s = phone.badges.streakOf(chat);
              const lv = chat.stats ? phone.badges.levelOf(chat).name : '';
              const n = Object.keys(chat.unlocked || {}).length;
              return [s.state === 'lit' || s.state === 'risk' ? `连续互发 ${s.n} 天` : '', lv,
                n ? `已解锁 ${n} 枚` : '', '年度回顾'].filter(Boolean).join(' · ');
            })()}
            left=${html`<${Icon} name="medal" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/badges/${chatId}`); }}/>
          ${otdYears.length ? html`<${ListItem} title="那年今天" arrow
            subtitle=${`${otdYears[0].ago} 年前的今天，共 ${otdYears[0].msgs.length} 条`}
            left=${html`<${Icon} name="clock" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/onthisday/${chatId}`); }}/>` : null}
          <${ListItem} title="多选消息"
            left=${html`<${Icon} name="check" size=${18}/>`}
            onClick=${() => { setMenu(false); setPicked([]); setPanel(null); }}/>
          <${ListItem} title="节奏与自动回复" arrow
            subtitle=${autoReply.bannerOf(chat) || ''}
            right=${(() => {
              const mode = pace.modeOf(chat);
              return mode === pace.NOW ? '发完就回' : mode === pace.PACED ? '延迟回复' : '按按钮才回';
            })()}
            left=${html`<${Icon} name="clock" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/pace/${chatId}`); }}/>
          <${ListItem} title="聊天背景" arrow
            right=${phone.chatLook.isSet(chat) ? '已设置' : '默认'}
            left=${html`<${Icon} name="image" size=${18}/>`}
            onClick=${() => { setMenu(false); setBgOpen(true); }}/>
          <${ListItem} title="美化" arrow
            right=${mySkin ? mySkin.name : '未设置'}
            left=${html`<${Icon} name="sparkle" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/skin/${chatId}`); }}/>
          <${ListItem} title="翻译" arrow
            right=${chat.translateTo || '关闭'}
            left=${html`<${Icon} name="translate" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/translate/${chatId}`); }}/>
          ${isGroup ? null : html`<${ListItem} title="互动" arrow
            subtitle=${`心声${extras.innerMode(chat) === extras.INNER_OFF ? '关闭'
              : extras.innerMode(chat) === extras.INNER_INLINE ? '随回复生成' : '单独生成'}`
              + ` · 拍一拍 · ${extras.facesOf(chat)} 面骰子`}
            left=${html`<${Icon} name="heart" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/extras/${chatId}`); }}/>
          <${ListItem} title="共享位置" arrow
            subtitle=${(() => {
              const sum = phone.geo.summary(chatId);
              return sum ? `${sum.me.place || '未命名'} 到 ${sum.char.place || '未命名'}`
                + (sum.text ? ` · ${sum.text}` : ' · 缺少坐标') : '';
            })()}
            right=${phone.geo.summary(chatId) ? '' : '关闭'}
            left=${html`<${Icon} name="compass" size=${18}/>`}
            onClick=${() => { setMenu(false); setSharing(true); }}/>`}
        <//>

        <${List} title="记忆">
          <${ListItem} title=${summing ? '正在总结记忆' : '立即总结记忆'} arrow multiline
            subtitle=${summing
              ? '正在调用接口，完成后会给出结果。这段时间请不要离开本页。'
              : `${pending} 条未总结 · ${settings.autoSummarizeInterval > 0
                ? `每 ${settings.autoSummarizeInterval} 轮自动总结`
                : '自动总结已关闭'}`
                + (runs > 1 ? ` · 追平需要 ${runs} 次` : '')}
            left=${summing
              ? html`<${Spinner} size=${16}/>`
              : html`<${Icon} name="brain" size=${18}/>`}
            onClick=${() => !summing && summarize()}/>
          ${runs > 1 ? html`
            <${ListItem} title="标记为已总结" danger arrow multiline
              subtitle=${`把这 ${pending} 条记为已总结，不调用接口，也不生成记忆`}
              left=${html`<${Icon} name="check" size=${18}/>`}
              onClick=${skipSummary}/>` : null}
          ${isGroup ? null : html`<${ListItem} title="关系底色" arrow
            subtitle=${(() => {
              const t = ai.bond.textOf(char, chat.personaId);
              return t ? t.split('\n')[0] : '';
            })()}
            right=${ai.bond.textOf(char, chat.personaId) ? '' : '尚未生成'}
            left=${html`<${Icon} name="users" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/bond/${chatId}`); }}/>
          <${ListItem} title="我们" arrow
            subtitle="长篇与番外"
            right=${(() => { const n = phone.work.ofChat(chatId).length; return n ? `${n} 部` : ''; })()}
            left=${html`<${Icon} name="book" size=${18}/>`}
            onClick=${() => { setMenu(false); phone.intent.open('us', { route: `/chat/${chatId}`, back: true }); }}/>`}
        <//>

        <${List}>
          <${ListItem} title="更多" arrow
            subtitle=${isGroup ? '上下文、表情包、模板、接口调用' : '上下文、表情包、模板、导出与清空数据'}
            left=${html`<${Icon} name="more" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/more/${chatId}`); }}/>
        <//>
      <//>
    ${look ? html`<${LookFloat} sceneId=${live?.id || ''} onClose=${() => setLook(false)}/>` : null}
    ${bgOpen ? html`<${ChatLookSheet} chatId=${chatId} onClose=${() => setBgOpen(false)}/>` : null}
    <//>`;
}
