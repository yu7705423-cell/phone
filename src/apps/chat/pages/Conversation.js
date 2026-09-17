import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Avatar, Icon, IconButton, FullSheet, List, ListItem,
         EmptyState, toast, confirm } from '../../../ui/index.js';
import { splitBubbles, quoteOf } from '../helpers.js';
import { StickerPanel, StickerSuggest } from './StickerPanel.js';
import { StickerImg } from './StickerBits.js';
import { MediaBubble } from './MediaBubble.js';
import { MsgMenu } from './MsgMenu.js';

const { db, nav, ai } = phone;

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

function Bubble({ msg, char, chat, frozen, onRetry, onSwipe, onHold,
                  selecting, selected, onToggle }) {
  const mine = msg.role === 'user';
  const avatar = useImage(mine ? phone.accounts.current()?.avatar : char?.avatar);
  const hold = useRef({ timer: null, fired: false });

  const parts = splitBubbles(msg.content);
  const swipes = msg.swipes || [];
  const sticker = msg.kind === 'sticker' ? db.stickers.get(msg.stickerId) : null;
  const typing = msg.kind === 'typing';
  const quote = quoteOf(msg, { char, chat });

  const start = () => {
    if (frozen || typing || selecting) return;
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

  return html`
    <div id=${`msg-${msg.id}`}
      class=${`msg${mine ? ' is-mine' : ''}${selecting && !frozen ? ' is-picking' : ''}${selected ? ' is-picked' : ''}`}
      onClickCapture=${capture}
      onTouchStart=${start} onTouchEnd=${end} onTouchMove=${end} onTouchCancel=${end}
      onContextMenu=${e => { e.preventDefault(); if (!selecting && !frozen && !typing) onHold(msg); }}>

      ${selecting && !frozen ? html`
        <span class=${`pick-dot${selected ? ' is-on' : ''}`}>
          ${selected ? html`<${Icon} name="check" size=${11}/>` : null}
        </span>` : null}

      <${Avatar} src=${avatar} name=${mine ? phone.accounts.current()?.name : char?.name} size=${36} radius=${18}/>
      <div class="msg-col">
        <${QuoteRef} quote=${quote} onClick=${() => jumpTo(quote.id)}/>

        ${msg.kind === 'sticker'
          ? html`<div class="bubble-sticker">
              ${sticker ? html`<${StickerImg} sticker=${sticker} size=${112}/>`
                        : html`<span class="stk-miss">表情已删除</span>`}
            </div>`
          : (msg.kind === 'image' || msg.kind === 'voice')
          ? html`<${MediaBubble} msg=${msg} char=${char}/>`
          : parts.length ? parts.map((p, i) => html`
              <div key=${i} class=${`bubble${typing ? ' is-typing' : ''}`}>${p}</div>`)
          : html`<div class="bubble bubble-empty"><span class="spinner"></span></div>`}

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
      </div>
    </div>`;
}

export function Conversation({ chatId }) {
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.characters.store);
  useStore(db.stickers.store);
  const settings = useStore(db.settings.store);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(null);      // menu | sticker | null
  const [held, setHeld] = useState(null);        // 长按选中的那条
  const [picked, setPicked] = useState(null);    // null=不在多选；数组=已选的 id
  const [quoting, setQuoting] = useState(null);  // 这条要被引用
  const [recSec, setRecSec] = useState(-1);      // -1 = 没在录音
  const bodyRef = useRef(null);
  const recRef = useRef(null);
  const imgRef = useRef(null);

  const chat = db.chats.get(chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  const msgs = chatId ? db.messagesOf(chatId) : [];
  const selecting = picked !== null;

  useEffect(() => {
    if (chat?.unread) db.chats.update(chatId, { unread: 0 });
  }, [chatId, chat?.unread]);

  // 录着音的时候退出这一页，麦克风会一直开着，指示灯也一直亮
  useEffect(() => () => { recRef.current?.cancel(); recRef.current = null; }, []);

  // 录音时长。只在录着的时候起一个计时器，停了就撤掉
  useEffect(() => {
    if (recSec < 0) return undefined;
    const t = setInterval(() => setRecSec(n => (n < 0 ? n : n + 1)), 1000);
    return () => clearInterval(t);
  }, [recSec < 0]);

  useEffect(() => {
    // 多选时别乱滚，正挑着消息呢
    if (selecting) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, msgs[msgs.length - 1]?.content, selecting]);

  if (!chat || !char) {
    return html`<${Page} title="会话" onBack=${nav.pop}><${EmptyState} title="该会话已不存在"/><//>`;
  }

  async function generate({ turnId: reuseTurn, swipes: prevSwipes } = {}) {
    if (!ai.isConfigured()) { toast('尚未配置模型接口', 'error'); return; }
    setBusy(true);

    // 生成中先放一条「正在输入」，流式内容打在上面
    const typing = db.messages.create({
      chatId, role: 'char', authorId: char.id, kind: 'typing',
      content: '', status: 'sending',
    });

    try {
      const text = await ai.streamReply({
        chat, char,
        onDelta: (_, full) => db.messages.update(typing.id, { content: full }),
      });
      const clean = String(text || '').trim();
      if (!clean) throw new Error('模型返回了空内容');

      db.messages.remove(typing.id);

      const turnId = reuseTurn || phone.uid('turn');
      const swipes = prevSwipes ? [...prevSwipes, clean] : [clean];
      await ai.reply.renderTurn({
        chat, char, raw: clean, turnId,
        swipes, swipeIndex: swipes.length - 1,
      });

      if (ai.memory.shouldAutoExtract(chatId, settings.autoSummarizeInterval)) {
        ai.memory.extract(chatId)
          .then(r => { if (r.added || r.updated) toast(`记忆更新 ${r.added + r.updated} 条`); })
          .catch(err => console.warn('[memory] 自动提取失败', err));
      }
    } catch (err) {
      db.messages.remove(typing.id);
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
  };

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
      const seeing = ai.vision.isVisionReady();
      const msg = db.messages.create({
        chatId, role: 'user', authorId: 'me', kind: 'image',
        imageId, content: '[图片]', status: 'done', media: 'done',
        vision: seeing ? 'pending' : 'off', ...q,
      });
      db.chats.update(chatId, { lastMessageAt: Date.now() });
      if (!seeing) return;
      ai.vision.describeImage(imageId, `vision:${msg.id}`)
        .then(text => db.messages.update(msg.id, {
          imageDesc: text, vision: 'done', content: `[图片：${text}]`,
        }))
        .catch(err => db.messages.update(msg.id, {
          vision: 'error', visionError: String(err.message || err),
        }));
    } catch (err) { toast('图片处理失败：' + (err.message || err), 'error'); }
  };

  const startRec = async () => {
    if (!ai.asr.isAsrReady()) {
      toast('尚未配置语音识别接口，请先在「设置 - 语音识别」中配置', 'error', 5000);
      return;
    }
    setPanel(null);
    try {
      recRef.current = await phone.audio.record();
      setRecSec(0);
    } catch (err) {
      toast('无法录音：' + (err.message || err), 'error', 5000);
    }
  };

  const cancelRec = () => {
    recRef.current?.cancel();
    recRef.current = null;
    setRecSec(-1);
  };

  // 原件按录下来的格式存着，送去识别前才临时转成 wav（见 system/audio.js）
  const sendRec = async () => {
    const h = recRef.current;
    recRef.current = null;
    setRecSec(-1);
    if (!h) return;
    const q = draftQuote();
    try {
      const { blob, seconds } = await h.stop();
      const audioId = await db.files.put(blob, { name: `voice-${Date.now()}`, type: blob.type });
      setQuoting(null);
      const msg = db.messages.create({
        chatId, role: 'user', authorId: 'me', kind: 'voice',
        audioId, seconds, content: '[语音]', status: 'done', media: 'done',
        asr: 'pending', ...q,
      });
      db.chats.update(chatId, { lastMessageAt: Date.now() });
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

  const regenerate = async () => {
    const last = [...msgs].reverse().find(m => m.role === 'char' && m.turnId);
    if (!last) { generate(); return; }
    const head = ai.reply.turnMessages(chatId, last.turnId)[0];
    const swipes = head?.swipes || [];
    ai.reply.clearTurn(chatId, last.turnId);
    await generate({ turnId: last.turnId, swipes });
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

  const togglePick = msg => setPicked(cur =>
    cur.includes(msg.id) ? cur.filter(x => x !== msg.id) : [...cur, msg.id]);

  const deletePicked = async () => {
    if (!picked.length) return;
    if (!await confirm({
      title: `删除 ${picked.length} 条消息`,
      message: '删除后不再进入上下文。', danger: true,
    })) return;
    dropMessages(picked);
    setPicked(null);
  };

  const summarize = async () => {
    setMenu(false);
    try {
      const r = await ai.memory.extract(chatId);
      toast(r.added + r.updated ? `新增 ${r.added} 条，更新 ${r.updated} 条` : '没有需要记录的新信息');
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
  };

  const clearHistory = async () => {
    setMenu(false);
    if (!await confirm({ title: '清空聊天记录', message: '已提取的记忆不会被删除。', danger: true })) return;
    db.messages.removeWhere(m => m.chatId === chatId);
    db.chats.update(chatId, { memoryUpTo: null, summary: '' });
  };

  const pending = ai.memory.pendingOf(chatId).length;

  const pro = ai.proactive.configOf(char);
  const proDesc = pro.proactive
    ? `已开启 · 平均间隔 ${pro.proactiveMinutes < 60
        ? pro.proactiveMinutes + ' 分钟'
        : Math.round(pro.proactiveMinutes / 60) + ' 小时'}`
    : '已关闭。开启后角色会主动发起对话';

  const MENU_ITEMS = [
    { id: 'photo', icon: 'image', label: '图片', onTap: () => imgRef.current?.click() },
    { id: 'voice', icon: 'headphone', label: '语音', onTap: startRec },
    { id: 'redpack', icon: 'wallet', label: '红包' },
    { id: 'call', icon: 'bell', label: '来电' },
    { id: 'gift', icon: 'cup', label: '礼物' },
    { id: 'location', icon: 'map', label: '位置' },
    { id: 'file', icon: 'notes', label: '文件' },
    { id: 'more', icon: 'more', label: '更多' },
  ].map(it => ({ ...it, onTap: it.onTap || (() => toast(`「${it.label}」尚未实现`)) }));

  const quotingRef = quoting ? quoteOf({ quoteId: quoting.id }, { char, chat }) : null;

  return html`
    <${Page} title=${selecting ? `已选 ${picked.length} 条` : char.name}
      onBack=${selecting ? () => setPicked(null) : nav.pop} noScroll
      right=${selecting
        ? html`<button class="nav-text press" onClick=${() => setPicked(msgs.map(m => m.id))}>全选</button>`
        : html`<${IconButton} name="more" onClick=${() => setMenu(true)} label="更多"/>`}>
      <div class="conv">
        <div class="conv-body scroll" ref=${bodyRef}>
          ${char.firstMessage && !msgs.length ? html`
            <${Bubble} msg=${{ id: 'greet', role: 'char', content: char.firstMessage, status: 'done' }}
              char=${char} chat=${chat} frozen
              onRetry=${onRetry} onSwipe=${onSwipe} onHold=${() => {}} onToggle=${() => {}}/>` : null}
          ${msgs.map(m => html`
            <${Bubble} key=${m.id} msg=${m} char=${char} chat=${chat}
              onRetry=${onRetry} onSwipe=${onSwipe} onHold=${setHeld}
              selecting=${selecting} selected=${selecting && picked.includes(m.id)}
              onToggle=${togglePick}/>`)}
          ${!msgs.length && !char.firstMessage ? html`
            <div class="conv-hint">发送第一条消息开始对话</div>` : null}
        </div>

        ${recSec >= 0 ? html`
          <div class="select-bar">
            <button class="nav-text press" onClick=${cancelRec}>取消</button>
            <span class="rec-live">
              <span class="rec-dot"></span>
              ${`${String(Math.floor(recSec / 60)).padStart(2, '0')}:${String(recSec % 60).padStart(2, '0')}`}
            </span>
            <button class="nav-text press" onClick=${sendRec}>发送</button>
          </div>`
        : selecting ? html`
          <div class="select-bar">
            <button class="nav-text press" onClick=${() => setPicked(null)}>取消</button>
            <span class="select-hint">
              ${picked.length ? '' : '点击消息进行选择'}
            </span>
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
              aria-label="更多"><${Icon} name="plus" size=${20}/></button>

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
                    ${MENU_ITEMS.map(it => html`
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

      <${MsgMenu} msg=${held} char=${char} onClose=${() => setHeld(null)}
        onQuote=${m => { setQuoting(m); setPanel(null); }}
        onMultiSelect=${m => { setPicked([m.id]); setPanel(null); }}
        onDelete=${id => dropMessages([id])}/>

      <${FullSheet} open=${menu} onClose=${() => setMenu(false)} title=${char.name}>
        <${List}>
          <${ListItem} title="角色卡" subtitle="人设、开场白、对话示例、关联世界书" arrow multiline
            left=${html`<${Icon} name="user" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/edit/${char.id}`); }}/>
          <${ListItem} title="角色主页" arrow
            left=${html`<${Icon} name="camera" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/profile/${char.id}`); }}/>
          <${ListItem} title="主动发起对话" arrow multiline
            subtitle=${proDesc}
            left=${html`<${Icon} name="bell" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/proactive/${char.id}`); }}/>
        <//>

        <${List} title="上下文">
          <${ListItem} title="上下文与记忆" subtitle="注入顺序、扫描窗口、历史轮次、自动总结" arrow multiline
            left=${html`<${Icon} name="layers" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push('/context'); }}/>
          <${ListItem} title="Prompt 模板" subtitle="骨架与各任务的提示词" arrow
            left=${html`<${Icon} name="sparkle" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push('/templates'); }}/>
          <${ListItem} title="立即总结记忆" subtitle=${`尚有 ${pending} 条未总结`} arrow
            left=${html`<${Icon} name="brain" size=${18}/>`} onClick=${summarize}/>
          <${ListItem} title="表情包" subtitle=${`共 ${db.stickers.count()} 个`} arrow
            left=${html`<${Icon} name="heart" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push('/stickers'); }}/>
        <//>

        <${List} title="这段对话">
          <${ListItem} title="重新生成上一条" arrow
            left=${html`<${Icon} name="refresh" size=${18}/>`}
            onClick=${() => { setMenu(false); regenerate(); }}/>
          <${ListItem} title="多选消息" subtitle="选择多条消息后一并删除。长按任意消息亦可进入" arrow multiline
            left=${html`<${Icon} name="check" size=${18}/>`}
            onClick=${() => { setMenu(false); setPicked([]); setPanel(null); }}/>
          <${ListItem} title="清空聊天记录" danger arrow
            left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${clearHistory}/>
        <//>
      <//>
    <//>`;
}
