import { html, useState, useEffect, useLayoutEffect, useRef, useMemo, memo } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Avatar, Icon, IconButton, FullSheet, List, ListItem,
         EmptyState, Spinner, toast, confirm, prompt } from '../../../ui/index.js';
import { splitBubbles, quoteOf } from '../helpers.js';
import { StickerPanel, StickerSuggest } from './StickerPanel.js';
import { StickerImg } from './StickerBits.js';
import { groupImages, ImageStack, StackFold } from './ImageStack.js';
import { MediaBubble } from './MediaBubble.js';
import { MsgMenu } from './MsgMenu.js';
import { PactBubble, LetterBubble, LetterSheet, PactSheet } from './SpaceBits.js';
import { DiceBubble, InnerVoice, DiceSheet } from './ExtrasBits.js';
import { TakeoutBubble, TakeoutSheet, MealSettleSheet, ShareSheet, MoreSheet } from './MealBits.js';
import { PhotoSource } from './PhotoSource.js';
import { TransferBubble, NoticeLine, TransferSheet, SettleSheet,
         LocationBubble, LocationSheet, CallBubble, CallLogSheet,
         GiftBubble, GiftSheet, UnwrapSheet,
         ListenBubble, ListenLogSheet, ListenBar, WatchBubble, ReadBubble, ExcerptBubble,
         WatchBar, RequestBubble, RequestSheet, VoteSheet } from './TransferBits.js';

// panel 这个名字在本文件里已经被「当前开着哪个面板」占了（见下面的 useState），
// 所以模块换个名字进来 —— 同名会被局部变量盖掉，读出来是 null。
const { db, nav, ai, call, extras, pace, autoReply, panel: panelCfg } = phone;

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

function QuoteRef({ quote, onClick }) {
  if (!quote) return null;
  return html`
    <button class=${`quote-ref${quote.id ? ' press' : ' is-dead'}`}
      onClick=${quote.id && onClick ? onClick : null}>
      ${quote.name ? html`<span class="quote-name">${quote.name}</span>` : null}
      <span class="quote-text ellipsis">${quote.text}</span>
    </button>`;
}

// 记忆化：流式回复时只有最后那条在变，别的几百条没必要跟着重画。
// 下面传给它的函数属性都是稳定身份的，见 Conversation 里的 stable。
const Bubble = memo(function Bubble({ msg, char, chat, frozen, onRetry, onSwipe, onHold,
                  selecting, selected, onToggle, transOpen, onSettle, onOpenLog, onUnwrap,
                  onPat, innerStyle, fold, foldCount }) {
  const mine = msg.role === 'user';
  const avatar = useImage(mine ? phone.accounts.current()?.avatar : char?.avatar);
  const hold = useRef({ timer: null, fired: false });
  // 默认展开时就一直开着；点一下展开这一档，点过才开
  const [openTrans, setOpenTrans] = useState(false);
  // 心声默认藏着，点头像才展开
  const [openInner, setOpenInner] = useState(false);
  // 单击看心声、双击拍一拍，只能等一下才分得清是哪一个
  const tap = useRef(null);

  const parts = splitBubbles(msg.content);
  const swipes = msg.swipes || [];
  const sticker = msg.kind === 'sticker' ? db.stickers.get(msg.stickerId) : null;
  const quote = quoteOf(msg, { char, chat });
  const trans = (msg.translation || '').trim();
  const showTrans = trans && (transOpen === 'always' || openTrans);

  const start = () => {
    if (frozen || selecting) return;
    hold.current.fired = false;
    hold.current.timer = setTimeout(() => {
      hold.current.timer = null;
      hold.current.fired = true;
      onHold(msg);
    }, 460);
  };
  const end = () => {
    if (hold.current.timer) { clearTimeout(hold.current.timer); hold.current.timer = null; }
  };

  // 多选时整条都是选择区，子元素的点击一律不放行。
  // 平时只吃掉长按之后紧跟的那一次 click —— 不然手一松语音就播了。
  const capture = e => {
    if (selecting && !frozen) { e.preventDefault(); e.stopPropagation(); onToggle(msg); return; }
    if (hold.current.fired) { hold.current.fired = false; e.preventDefault(); e.stopPropagation(); }
  };

  // 提示行不是谁说的话，不给头像也不给气泡，居中一行就够
  if (msg.kind === 'notice') {
    return html`<div id=${`msg-${msg.id}`}><${NoticeLine} msg=${msg}/></div>`;
  }

  return html`
    <div id=${`msg-${msg.id}`}
      class=${`msg no-callout${mine ? ' is-mine' : ''}${selecting && !frozen ? ' is-picking' : ''}${selected ? ' is-picked' : ''}`}
      onClickCapture=${capture}
      onTouchStart=${start} onTouchEnd=${end} onTouchMove=${end} onTouchCancel=${end}
      onContextMenu=${e => { e.preventDefault(); if (!selecting && !frozen) onHold(msg); }}>

      ${selecting && !frozen ? html`
        <span class=${`pick-dot${selected ? ' is-on' : ''}`}>
          ${selected ? html`<${Icon} name="check" size=${11}/>` : null}
        </span>` : null}

      <div class="msg-face no-callout"
        onClick=${selecting || frozen ? null : () => {
          if (tap.current) { clearTimeout(tap.current); tap.current = null; onPat && onPat(); return; }
          tap.current = setTimeout(() => { tap.current = null; setOpenInner(v => !v); }, 260);
        }}>
        <${Avatar} src=${avatar} name=${mine ? phone.accounts.current()?.name : char?.name} size=${36} radius=${18}/>
      </div>
      <div class="msg-col">
        <${QuoteRef} quote=${quote} onClick=${() => jumpTo(quote.id)}/>

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
          : msg.kind === 'sticker'
          ? html`<div class="bubble-sticker">
              ${sticker ? html`<${StickerImg} sticker=${sticker} size=${112}/>`
                : html`<span class="stk-gone">
                    ${msg.stickerName ? `表情：${msg.stickerName}` : '表情已删除'}
                  </span>`}
            </div>`
          : (msg.kind === 'image' || msg.kind === 'voice')
          ? html`<${MediaBubble} msg=${msg} char=${char}/>`
          : parts.length ? parts.map((p, i) => html`
              <div key=${i}
                class=${`bubble${trans && i === parts.length - 1 ? ' has-trans' : ''}`}
                onClick=${trans && i === parts.length - 1 && !selecting
                  ? () => setOpenTrans(v => !v) : null}>
                ${p}
                ${trans && i === parts.length - 1 && showTrans ? html`
                  <div class="bubble-trans">${trans}</div>` : null}
              </div>`)
          : null}

        ${msg.inner && openInner
          ? html`<${InnerVoice} text=${msg.inner} style=${innerStyle}/>` : null}

        ${msg.status === 'error' ? html`
          <button class="msg-retry press" onClick=${() => onRetry(msg)}>
            <${Icon} name="refresh" size=${13}/> 重试
          </button>` : null}

        ${!mine && swipes.length > 1 && msg.status === 'done' ? html`
          <div class="swipes">
            <button class="swipe-btn press" onClick=${() => onSwipe(msg, -1)}>
              <${Icon} name="chevronLeft" size=${13}/></button>
            <span>${(msg.swipeIndex || 0) + 1}/${swipes.length}</span>
            <button class="swipe-btn press" onClick=${() => onSwipe(msg, 1)}>
              <${Icon} name="chevronRight" size=${13}/></button>
          </div>` : null}

        ${fold ? html`<${StackFold} count=${foldCount} onFold=${fold}/>` : null}
      </div>
    </div>`;
});

// 摞起来的那一叠。它不是一条消息，所以不走 Bubble 那一套（没有重试、没有候选、
// 没有译文），只借头像和左右对齐。长按任意一张进选择模式，那时整叠会摊开。
function StackRow({ msgs, char, onExpand }) {
  const mine = msgs[0].role === 'user';
  const avatar = useImage(mine ? phone.accounts.current()?.avatar : char?.avatar);
  return html`
    <div class=${`msg no-callout${mine ? ' is-mine' : ''}`}>
      <div class="msg-face no-callout">
        <${Avatar} src=${avatar} name=${mine ? phone.accounts.current()?.name : char?.name}
          size=${36} radius=${18}/>
      </div>
      <div class="msg-col">
        <${ImageStack} msgs=${msgs} onExpand=${onExpand}/>
      </div>
    </div>`;
}

export function Conversation({ chatId, focusId = '' }) {
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.characters.store);
  useStore(db.stickers.store);
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
  const [packing, setPacking] = useState(false); // 正在打这个角色的包
  const [summing, setSumming] = useState(false); // 正在总结记忆
  const [voting, setVoting] = useState(null);    // 正在表态的那一条申请
  const [placing, setPlacing] = useState(false); // 发位置的面板开着
  const [callLog, setCallLog] = useState(null);  // 正在看的那通电话
  const [gifting, setGifting] = useState(false); // 送礼物面板开着
  const [unwrap, setUnwrap] = useState(null);    // 正在拆的那一件
  const [listenLog, setListenLog] = useState(null); // 正在看的那一场
  const [letter, setLetter] = useState(null);    // 正在读的那封信
  const [pact, setPact] = useState(null);        // 正在标完成的那条约定
  const [dicing, setDicing] = useState(false);   // 骰子面板开着
  const [ordering, setOrdering] = useState(false);  // 点外卖面板开着
  const [sharing, setSharing] = useState(false);    // 共享位置面板开着
  const [more, setMore] = useState(false);          // 面板的「更多」开着
  const [meal, setMeal] = useState(null);           // 正在处理的那一单
  // 只画最近这么多条。聊了两万条的会话一次性铺出来要一两秒，手机上十几秒，
  // 而且往上翻从来也不会翻到那么远。不够就按「查看更早的消息」再要一段。
  const [shown, setShown] = useState(pageSize);
  const bodyRef = useRef(null);
  const keepRef = useRef(0);      // 加载更早时用来把滚动位置钉住
  const recRef = useRef(null);
  const localRef = useRef(null);
  const imgRef = useRef(null);

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
    noop: () => {},
  }), []);
  const pickedSet = useMemo(() => new Set(picked || []), [picked]);
  const innerStyle = extras.innerStyle();

  const chat = db.chats.get(chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  // 开场白那条不入库，每次渲染现造。现造的对象身份每次都不一样，
  // 记忆化就永远判不出相等，所以这里也钉住。
  const greeting = useMemo(
    () => ({ id: 'greet', role: 'char', content: char?.firstMessage || '', status: 'done' }),
    [char?.firstMessage]);
  const msgs = chatId ? db.messagesOf(chatId) : [];
  const selecting = picked !== null;

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

  useEffect(() => {
    if (chat?.unread) db.chats.update(chatId, { unread: 0 });
  }, [chatId, chat?.unread]);

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

  if (!chat || !char) {
    return html`<${Page} title="会话" onBack=${nav.pop}><${EmptyState} title="该会话已不存在"/><//>`;
  }

  async function generate({ turnId: reuseTurn, swipes: prevSwipes } = {}) {
    if (!ai.isConfigured()) { toast('尚未配置模型接口', 'error'); return; }
    setBusy(true);

    // 生成期间**不放占位气泡**。要说的是「对方在输入」，那句话属于标题栏，
    // 不属于消息流 —— 聊天记录里凭空多一个空泡，是这个界面在说自己的事。
    // 气泡等内容真的好了再出现。
    try {
      const text = await ai.streamReply({ chat, char });
      const clean = String(text || '').trim();
      if (!clean) throw new Error('模型返回了空内容');

      const turnId = reuseTurn || phone.uid('turn');
      const swipes = prevSwipes ? [...prevSwipes, clean] : [clean];
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
        db.messages.create({
          chatId, role: 'char', authorId: char.id, kind: 'text',
          content: '', status: 'error', error: String(err.message || err),
        });
        toast(String(err.message || err), 'error', 4500);
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
    const q = draftQuote();
    setDraft('');
    setQuoting(null);
    db.messages.create({ chatId, role: 'user', authorId: 'me', kind: 'text',
      content: text, status: 'done', ...q });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
    afterSend(text);
  };

  // 发完之后由谁接。三种可能，互斥：
  //   她开着自动回复  回一句固定的，不调接口，也不再排正常的回复
  //   节奏是「发完就回」立刻生成
  //   节奏是「过一会儿」 记一个到点时刻，下面那个 effect 负责等
  function afterSend(text) {
    if (autoReply.shouldReply(chatId, 'hers')) { autoReply.fire(chatId, 'hers'); return; }
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
    : m.kind === 'pact' ? setPact(m)
    : setCallLog(m));
  // 「处理对方发来的那一件」两种气泡共用一个入口，按 kind 分流。
  // 各给一个 prop 的话，气泡的记忆化就得多认一个函数身份。
  const settleAny = m => (m.kind === 'takeout' ? setMeal(m)
    : m.kind === 'request' ? setVoting(m) : setSettling(m));
  latest.current = { onRetry, onSwipe, togglePick, onSettle: settleAny,
    onOpenLog: openLog, onUnwrap: setUnwrap,
    onPat: () => extras.pat({ chatId, role: 'user' }) };

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
        const id = await db.images.put(new File([blob], 'card.png', { type: 'image/png' }));
        phone.album.attachRaster(photo.id, id);
      }).catch(() => { /* 画不出来就只留快照那一份 */ });
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  // 只打包这一个角色。整个库那一份是「设置 - 存储」里的完整备份。
  const exportChar = async () => {
    setPacking(true);
    try {
      const blob = await phone.charpack.build(char.id, { history: true });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = phone.charpack.fileNameFor(char.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setMenu(false);
      toast(`已导出 ${phone.backup.sizeText(blob.size)}`, 'ok', 4000);
    } catch (err) {
      toast('导出失败：' + (err.message || err), 'error', 5000);
    } finally { setPacking(false); }
  };

  // 清除数据。三样都删不回来，所以数目先在确认框里摆出来，不让用户蒙着点。
  // 作用范围是这个角色名下的全部会话，不只是眼前这一段 —— 说明里写明了。
  const wipe = async which => {
    const n = phone.purge.counts(char.id);
    const act = {
      history: {
        title: '清空聊天记录',
        message: `将删除 ${n.messages} 条消息，其中的图片与语音一并清除。`
          + '已提取的记忆保留。由聊天记录推算出的账目会随之消失。',
        run: () => { phone.purge.clearHistory(char.id); return `已清空 ${n.messages} 条消息`; },
      },
      memory: {
        title: '清空记忆',
        message: `将删除 ${n.memories} 条记忆。聊天记录保留，`
          + '下次总结时会从现有的聊天记录重新提取。',
        run: () => { phone.purge.clearMemories(char.id); return `已清空 ${n.memories} 条记忆`; },
      },
      both: {
        title: '清空记忆与聊天记录',
        message: `将删除 ${n.messages} 条消息与 ${n.memories} 条记忆，`
          + '消息中的图片与语音一并清除。角色卡本身保留。',
        run: () => {
          phone.purge.clearAll(char.id);
          return `已清空 ${n.messages} 条消息、${n.memories} 条记忆`;
        },
      },
    }[which];
    if (!await confirm({ title: act.title, message: act.message, danger: true })) return;
    setMenu(false);
    toast(act.run(), 'ok');
  };

  // 菜单没开就不数。counts 要把这个角色名下所有会话的消息过一遍，
  // 而这一页每来一条消息就重渲染一次
  const wipeN = menu ? phone.purge.counts(char.id) : { chats: 0, messages: 0, memories: 0 };

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

  const pending = ai.memory.pendingOf(chatId).length;
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
    ? `已开启 · 平均间隔 ${pro.proactiveMinutes < 60
        ? pro.proactiveMinutes + ' 分钟'
        : Math.round(pro.proactiveMinutes / 60) + ' 小时'}`
    : '已关闭。开启后角色会主动发起对话';

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
    watch: () => phone.intent.open('theater', { route: `/watch/${chatId}` }),
    takeout: () => setOrdering(true),
    request: () => setAsking(true),
    share: () => setSharing(true),
    dice: () => setDicing(true),
  };
  const runTap = id => (TAP[id] || (() => toast('这一项尚未实现')))();
  const PANEL_ITEMS = [
    ...panelCfg.onPanel().map(id => ({ ...panelCfg.itemOf(id), onTap: () => runTap(id) })),
    { id: '_more', icon: 'more', label: '更多', onTap: () => setMore(true) },
  ];

  const quotingRef = quoting ? quoteOf({ quoteId: quoting.id }, { char, chat }) : null;
  const canRegen = !!(held && held.role === 'char' && held.turnId && held.turnId === lastTurnId);

  return html`
    <${Page} title=${selecting ? `已选 ${picked.length} 条`
      : busy ? html`<span class="conv-typing">正在输入</span>` : char.name}
      onBack=${selecting ? () => setPicked(null) : nav.pop} noScroll
      right=${selecting
        ? html`<button class="nav-text press" onClick=${() => setPicked(view.map(m => m.id))}>全选</button>`
        : html`<${IconButton} name="more" onClick=${() => setMenu(true)} label="更多"/>`}>
      <div class="conv">
        <${ListenBar} chatId=${chatId}/>
        <${WatchBar} chatId=${chatId}/>
        ${(() => {
          const banner = autoReply.bannerOf(chat);
          const left = pace.leftOf(chat);
          const line = [banner, left === null ? '' : `已送达 · ${pace.leftText(left)}`]
            .filter(Boolean).join(' · ');
          return line ? html`
            <button class="pace-bar press" onClick=${() => nav.push(`/pace/${chatId}`)}>
              ${line}
            </button>` : null;
        })()}
        <div class="conv-main">
        <div class="conv-body scroll" ref=${bodyRef} onScroll=${onScroll}>
          ${char.firstMessage && !msgs.length ? html`
            <${Bubble} msg=${greeting} char=${char} chat=${chat} frozen
              onRetry=${stable.onRetry} onSwipe=${stable.onSwipe}
              onHold=${stable.noop} onToggle=${stable.noop}/>` : null}
          ${earlier ? html`
            <button class="conv-earlier press" onClick=${loadEarlier}>
              查看更早的消息（还有 ${earlier} 条）</button>` : null}
          ${rows.map(row => (row.stack ? html`
            <${StackRow} key=${row.id} msgs=${row.msgs} char=${char}
              onExpand=${() => setOpenStack(s => new Set(s).add(row.id))}/>`
          : html`
            <${Bubble} key=${row.id} msg=${row.msg} char=${char} chat=${chat}
              onRetry=${stable.onRetry} onSwipe=${stable.onSwipe} onHold=${setHeld}
              selecting=${selecting} selected=${selecting && pickedSet.has(row.id)}
              onToggle=${stable.onToggle} transOpen=${settings.translateOpen}
              onSettle=${stable.onSettle} onOpenLog=${stable.onOpenLog}
              onUnwrap=${stable.onUnwrap} onPat=${stable.onPat}
              innerStyle=${innerStyle}
              fold=${row.foldOf ? () => setOpenStack(s => {
                const n = new Set(s); n.delete(row.foldOf); return n;
              }) : null}
              foldCount=${row.foldCount}/>`))}
          ${!msgs.length && !char.firstMessage ? html`
            <div class="conv-hint">发送第一条消息开始对话</div>` : null}
        </div>

        ${!atBottom && !selecting ? html`
          <button class="to-bottom press" onClick=${toBottom} aria-label="回到最新">
            <${Icon} name="chevronDown" size=${18}/>
          </button>` : null}
        </div>

        ${recSec >= 0 ? html`
          <div class="select-bar">
            <button class="nav-text press" onClick=${cancelRec}>取消</button>
            <span class="rec-live">
              <span class="rec-dot"></span>
              ${`${String(Math.floor(recSec / 60)).padStart(2, '0')}:${String(recSec % 60).padStart(2, '0')}`}
              <button class="rec-write press" onClick=${writeInstead}>改为输入</button>
            </span>
            <button class="nav-text press" onClick=${sendRec}>发送</button>
          </div>`
        : selecting ? html`
          <div class="select-bar">
            <button class="nav-text press" onClick=${() => setPicked(null)}>取消</button>
            <span class="select-hint">
              ${picked.length ? '' : '点击消息进行选择'}
            </span>
            <button class=${`nav-text press${picked.length ? '' : ' is-off'}`}
              onClick=${shotPicked}>存为图片</button>
            <button class=${`nav-text press${picked.length ? ' is-danger' : ' is-off'}`}
              onClick=${deletePicked}>删除</button>
          </div>`
        : html`
          ${draft.trim() && panel !== 'sticker'
            ? html`<${StickerSuggest} text=${draft} onSend=${sendSticker}/>` : null}

          ${quotingRef ? html`
            <div class="quote-bar">
              <${QuoteRef} quote=${quotingRef} onClick=${() => jumpTo(quoting.id)}/>
              <button class="press" onClick=${() => setQuoting(null)} aria-label="不引用了">
                <${Icon} name="close" size=${15}/></button>
            </div>` : null}

          <div class="composer-bar">
            <button class="composer-side press" onClick=${() => setPanel(panel === 'menu' ? null : 'menu')}
              aria-label="添加内容"><${Icon} name="plus" size=${20}/></button>

            <textarea class="composer-input" rows="1" value=${draft} placeholder="说点什么"
              onInput=${e => setDraft(e.target.value)}
              onKeyDown=${e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
              }}></textarea>

            <button class="composer-side press" onClick=${() => setPanel(panel === 'sticker' ? null : 'sticker')}
              aria-label="表情"><${Icon} name="heart" size=${20}/></button>

            ${draft.trim()
              ? html`<button class="send-btn press" onClick=${send} aria-label="发送">
                  <${Icon} name="send" size=${17}/></button>`
              : busy
                ? html`<button class="send-btn is-stop press"
                    onClick=${() => ai.cancelReply(chatId, char.id)} aria-label="停止">
                    <${Icon} name="close" size=${17}/></button>`
                : html`<button class="send-btn is-ghost press" onClick=${() => generate()}
                    aria-label="让对方回复"><${Icon} name="reply" size=${22}/></button>`}
          </div>

          ${panel ? html`
            <div class="composer-panel">
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

      <input type="file" accept="image/*" ref=${imgRef}
        onChange=${sendImage} style="display:none"/>

      <${CallLogSheet} msg=${callLog} onClose=${() => setCallLog(null)}/>
      <${ListenLogSheet} msg=${listenLog} onClose=${() => setListenLog(null)}/>
      <${GiftSheet} open=${gifting} chatId=${chatId} onClose=${() => setGifting(false)}/>
      <${UnwrapSheet} msg=${unwrap} onClose=${() => setUnwrap(null)}/>
      <${LetterSheet} msg=${letter} onClose=${() => setLetter(null)}/>
      <${PactSheet} msg=${pact} onClose=${() => setPact(null)}/>
      <${DiceSheet} open=${dicing} chatId=${chatId} onClose=${() => setDicing(false)}/>
      <${TakeoutSheet} open=${ordering} chatId=${chatId} onClose=${() => setOrdering(false)}/>
      <${ShareSheet} open=${sharing} chatId=${chatId} onClose=${() => setSharing(false)}/>
      <${MealSettleSheet} msg=${meal} onClose=${() => setMeal(null)}/>
      <${MoreSheet} open=${more} onClose=${() => setMore(false)} onTap=${runTap}/>
      <${PhotoSource} open=${picking === 'photo'} onClose=${() => setPicking(null)}
        onFile=${() => { setPicking(null); imgRef.current?.click(); }}
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

      <${MsgMenu} msg=${held} char=${char} onClose=${() => setHeld(null)}
        onRegenerate=${canRegen ? () => regenerate(held.turnId) : null}
        onQuote=${m => { setQuoting(m); setPanel(null); }}
        onMultiSelect=${m => { setPicked([m.id]); setPanel(null); }}
        onDelete=${id => dropMessages([id])}/>

      <${FullSheet} open=${menu} onClose=${() => setMenu(false)} title=${char.name}>
        <${List} title="这个角色">
          <${ListItem} title="角色卡" arrow multiline
            subtitle="人设、核心设定、开场白、对话示例、关联世界书，以及当日日程与各项能力的开关"
            left=${html`<${Icon} name="user" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/edit/${char.id}`); }}/>
          <${ListItem} title="角色主页" subtitle="头像、封面与该角色发布的动态" arrow multiline
            left=${html`<${Icon} name="camera" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/profile/${char.id}`); }}/>
          <${ListItem} title="主动发起对话" arrow multiline
            subtitle=${proDesc}
            left=${html`<${Icon} name="bell" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/proactive/${char.id}`); }}/>
          ${phone.netease.cookieOf(char.id) ? html`
            <${ListItem} title="看看她在听什么" arrow multiline
              subtitle=${(() => {
                const np = char.nowPlaying;
                if (!np?.songs?.length) return '读取该角色音乐账号的播放记录，写入本轮上下文';
                const first = np.songs[0];
                return `${np.kind === 'recent' ? '刚刚在听' : '最近常听'}：`
                  + `${first.title}${first.artist ? ' — ' + first.artist : ''}`;
              })()}
              left=${html`<${Icon} name="music" size=${18}/>`}
              onClick=${pullMusic}/>` : null}
        <//>

        <${List} title="这段对话">
          <${ListItem} title="搜索聊天记录" subtitle=${`在这段对话中查找，共 ${msgs.length} 条消息`}
            arrow multiline
            left=${html`<${Icon} name="search" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/search/${chatId}`); }}/>
          <${ListItem} title="多选消息" subtitle="选择多条消息后一并删除。长按任意消息亦可进入" arrow multiline
            left=${html`<${Icon} name="check" size=${18}/>`}
            onClick=${() => { setMenu(false); setPicked([]); setPanel(null); }}/>
          <${ListItem} title="节奏与自动回复" arrow multiline
            subtitle=${(() => {
              const mode = pace.modeOf(chat);
              const m = mode === pace.NOW ? '发完就回'
                : mode === pace.PACED ? '过一会儿才回' : '按按钮才回';
              return `${m}${autoReply.bannerOf(chat) ? ' · ' + autoReply.bannerOf(chat) : ''}`;
            })()}
            left=${html`<${Icon} name="clock" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/pace/${chatId}`); }}/>
          <${ListItem} title="翻译" arrow multiline
            subtitle=${chat.translateTo
              ? `每条同时给出${chat.translateTo}译文，${settings.translateOpen === 'always' ? '默认展开' : '点气泡展开'}`
              : '关着。开启后角色每说一条会同时给出译文'}
            left=${html`<${Icon} name="translate" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/translate/${chatId}`); }}/>
          <${ListItem} title="互动" arrow multiline
            subtitle=${`心声${extras.innerMode(chat) === extras.INNER_OFF ? '关着'
              : extras.innerMode(chat) === extras.INNER_INLINE ? '随回复一起生成' : '每轮单独生成'}`
              + ` · 拍一拍 · ${extras.facesOf(chat)} 面骰子`}
            left=${html`<${Icon} name="heart" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/extras/${chatId}`); }}/>
          <${ListItem} title="共享位置" arrow multiline
            subtitle=${(() => {
              const sum = phone.geo.summary(chatId);
              return sum ? `${sum.me.place || '未命名'} 到 ${sum.char.place || '未命名'}`
                + (sum.text ? ` · ${sum.text}` : ' · 缺少坐标，算不出距离')
                : '关着。开启后角色知道你们相距多远，距离由本地计算';
            })()}
            left=${html`<${Icon} name="compass" size=${18}/>`}
            onClick=${() => { setMenu(false); setSharing(true); }}/>
        <//>

        <${List} title="记忆与上下文">
          <${ListItem} title="上下文与记忆" subtitle="注入顺序、扫描窗口、历史范围、自动总结" arrow multiline
            left=${html`<${Icon} name="layers" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push('/context'); }}/>
          <${ListItem} title=${summing ? '正在总结记忆' : '立即总结记忆'} arrow multiline
            subtitle=${summing
              ? '正在调用接口，完成后会给出结果。这段时间请不要离开本页。'
              : `尚有 ${pending} 条未总结 · ${settings.autoSummarizeInterval > 0
                ? `自动总结每 ${settings.autoSummarizeInterval} 轮一次`
                : '自动总结已关闭'}`
                + (runs > 1 ? `。一次总结最早的一批，追平需要 ${runs} 次` : '')}
            left=${summing
              ? html`<${Spinner} size=${16}/>`
              : html`<${Icon} name="brain" size=${18}/>`}
            onClick=${() => !summing && summarize()}/>
          ${runs > 1 ? html`
            <${ListItem} title="标记为已总结" danger arrow multiline
              subtitle=${`把这 ${pending} 条记为已总结，不调用接口。`
                + '从别处迁入大量历史、又不打算为它们生成记忆时用'}
              left=${html`<${Icon} name="check" size=${18}/>`}
              onClick=${skipSummary}/>` : null}
          <${ListItem} title="关系底色" arrow multiline
            subtitle=${(() => {
              const t = ai.bond.textOf(char, chat.personaId);
              const n = ai.bond.sourceOf(char.id, chat.personaId).length;
              return t ? `${t.split('\n')[0].slice(0, 20)}… · 由 ${n} 条关系转折级记忆压成`
                : `尚未生成 · 当前有 ${n} 条关系转折级记忆`;
            })()}
            left=${html`<${Icon} name="users" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/bond/${chatId}`); }}/>
          <${ListItem} title="每轮的接口调用" arrow multiline
            subtitle=${(() => {
              const n = ai.cost.perTurn(chatId);
              const worst = ai.cost.worstPerTurn(chatId);
              const head = n > 1
                ? `这段对话每轮固定调用 ${n} 次接口`
                : '这段对话每轮调用 1 次接口';
              // 重试与换套相乘，失败那一轮的数目和顺利时不是一回事
              const tail = worst > n ? `，请求失败时最多 ${worst} 次` : '';
              return `${head}${tail}${n > 1 || worst > n
                ? '。点击查看是哪几项，并可逐项关闭' : ''}`;
            })()}
            left=${html`<${Icon} name="filter" size=${18}/>`}
            onClick=${() => { setMenu(false); phone.intent.open('settings', { route: '/limits' }); }}/>
        <//>

        <${List} title="所有角色通用">
          <${ListItem} title="表情包" subtitle=${`共 ${db.stickers.count()} 个，所有角色共用`} arrow multiline
            left=${html`<${Icon} name="image" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push('/stickers'); }}/>
          <${ListItem} title="能力开关" arrow multiline
            subtitle=${(() => {
              const list = ai.caps.switchable();
              const off = ai.caps.offSet(settings);
              const n = list.length - list.filter(c => off.has(c.id)).length;
              return `已开启 ${n} / ${list.length} 项。关闭的不会写进 prompt`;
            })()}
            left=${html`<${Icon} name="filter" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push('/caps'); }}/>
          <${ListItem} title="Prompt 模板" subtitle="骨架与各任务的提示词" arrow multiline
            left=${html`<${Icon} name="sparkle" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push('/templates'); }}/>
        <//>

        <${List} title="数据">
          <${ListItem} title=${packing ? '正在打包' : '导出这个角色'} arrow multiline
            subtitle="打包该角色及其相关数据为压缩包。整库备份在「设置 - 存储」"
            left=${packing
              ? html`<${Spinner} size=${16}/>`
              : html`<${Icon} name="download" size=${18}/>`}
            onClick=${() => !packing && exportChar()}/>
          <${ListItem} title="导入角色" arrow multiline
            subtitle="装回上面导出的压缩包，或从一份资料整理出新角色。与「联系」右上角的入口是同一页"
            left=${html`<${Icon} name="upload" size=${18}/>`}
            onClick=${() => { setMenu(false); phone.intent.open('contact', { route: '/import' }); }}/>
          <${ListItem} title="清空聊天记录" danger arrow multiline
            subtitle=${wipeN.chats > 1
              ? `${wipeN.messages} 条消息，分布在 ${wipeN.chats} 段会话中。已提取的记忆保留`
              : `${wipeN.messages} 条消息。已提取的记忆保留`}
            left=${html`<${Icon} name="trash" size=${18}/>`}
            onClick=${() => wipe('history')}/>
          <${ListItem} title="清空记忆" danger arrow multiline
            subtitle=${`${wipeN.memories} 条记忆。聊天记录保留`}
            left=${html`<${Icon} name="brain" size=${18}/>`}
            onClick=${() => wipe('memory')}/>
          <${ListItem} title="清空记忆与聊天记录" danger arrow multiline
            subtitle="两者一并删除，角色卡本身保留"
            left=${html`<${Icon} name="close" size=${18}/>`}
            onClick=${() => wipe('both')}/>
        <//>
        <div class="settings-foot">
          清除操作针对该角色名下的全部内容。同一角色与多个身份分别聊过的，
          各段会话与各身份下的记忆都会被清除。角色卡、世界书关联与各项设置不受影响。
        </div>
      <//>
    <//>`;
}
