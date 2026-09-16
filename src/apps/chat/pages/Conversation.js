import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Avatar, Icon, IconButton, Sheet, List, ListItem,
         EmptyState, toast, confirm } from '../../../ui/index.js';
import { splitBubbles, relTime } from '../helpers.js';

const { db, nav, ai } = phone;

function Bubble({ msg, char, onRetry, onSwipe, onDelete }) {
  const mine = msg.role === 'user';
  const avatar = useImage(mine ? db.persona.get().avatar : char?.avatar);
  const parts = splitBubbles(msg.content);
  const swipes = msg.swipes || [];

  return html`
    <div class=${`msg${mine ? ' is-mine' : ''}`}>
      <${Avatar} src=${avatar} name=${mine ? db.persona.get().name : char?.name} size=${34}/>
      <div class="msg-col">
        ${parts.length ? parts.map((p, i) => html`
          <div key=${i} class="bubble" onDblClick=${() => onDelete(msg)}>${p}</div>`)
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
  const settings = useStore(db.settings.store);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const bodyRef = useRef(null);

  const chat = db.chats.get(chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  const msgs = chatId ? db.messagesOf(chatId) : [];

  useEffect(() => {
    if (chat?.unread) db.chats.update(chatId, { unread: 0 });
  }, [chatId, chat?.unread]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, msgs[msgs.length - 1]?.content]);

  if (!chat || !char) {
    return html`<${Page} title="会话" onBack=${nav.pop}><${EmptyState} title="这个会话已不存在"/><//>`;
  }

  async function generate(replaceMsgId) {
    if (!ai.isConfigured()) {
      toast('还没有配置模型接口', 'error');
      return;
    }
    setBusy(true);
    const holder = replaceMsgId
      ? db.messages.update(replaceMsgId, { content: '', status: 'sending' })
      : db.messages.create({
          chatId, role: 'char', authorId: char.id, content: '',
          status: 'sending', swipes: [], swipeIndex: 0,
        });

    try {
      const text = await ai.streamReply({
        chat, char,
        onDelta: (_, full) => db.messages.update(holder.id, { content: full }),
      });
      const clean = String(text || '').trim();
      if (!clean) throw new Error('模型返回了空内容');

      const cur = db.messages.get(holder.id);
      const swipes = replaceMsgId ? [...(cur.swipes || []), clean] : [clean];
      db.messages.update(holder.id, {
        content: clean, status: 'done',
        swipes, swipeIndex: swipes.length - 1,
      });
      db.chats.update(chatId, { lastMessageAt: Date.now() });

      if (ai.memory.shouldAutoExtract(chatId, settings.autoSummarizeInterval)) {
        ai.memory.extract(chatId)
          .then(r => { if (r.added || r.updated) toast(`记忆更新 ${r.added + r.updated} 条`); })
          .catch(err => console.warn('[memory] 自动提取失败', err));
      }
    } catch (err) {
      if (ai.queue.isAbort(err)) {
        db.messages.remove(holder.id);
      } else {
        db.messages.update(holder.id, { status: 'error', error: String(err.message || err) });
        toast(String(err.message || err), 'error', 4500);
      }
    } finally { setBusy(false); }
  }

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    db.messages.create({ chatId, role: 'user', authorId: 'me', content: text, status: 'done' });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
    await generate(null);
  };

  const regenerate = async () => {
    const last = [...msgs].reverse().find(m => m.role === 'char');
    if (!last) return;
    await generate(last.id);
  };

  const onSwipe = (msg, dir) => {
    const swipes = msg.swipes || [];
    if (swipes.length < 2) return;
    const i = ((msg.swipeIndex || 0) + dir + swipes.length) % swipes.length;
    db.messages.update(msg.id, { swipeIndex: i, content: swipes[i] });
  };

  const onDelete = async msg => {
    if (!await confirm({ title: '删除这条消息', danger: true })) return;
    db.messages.remove(msg.id);
  };

  const onRetry = msg => {
    db.messages.remove(msg.id);
    generate(null);
  };

  const summarize = async () => {
    setMenu(false);
    try {
      const r = await ai.memory.extract(chatId);
      toast(r.added + r.updated ? `新增 ${r.added} 条，更新 ${r.updated} 条` : '没有新信息需要记录');
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
  };

  const clearHistory = async () => {
    setMenu(false);
    if (!await confirm({ title: '清空聊天记录', message: '记忆不会被删除。', danger: true })) return;
    db.messages.removeWhere(m => m.chatId === chatId);
    db.chats.update(chatId, { memoryUpTo: null, summary: '' });
  };

  const pending = ai.memory.pendingOf(chatId).length;

  return html`
    <${Page} title=${char.name} onBack=${nav.pop} noScroll
      right=${html`<${IconButton} name="more" onClick=${() => setMenu(true)} label="更多"/>`}>
      <div class="conv">
        <div class="conv-body scroll" ref=${bodyRef}>
          ${char.firstMessage && !msgs.length ? html`
            <${Bubble} msg=${{ id: 'greet', role: 'char', content: char.firstMessage, status: 'done' }}
              char=${char} onRetry=${onRetry} onSwipe=${onSwipe} onDelete=${() => {}}/>` : null}
          ${msgs.map(m => html`
            <${Bubble} key=${m.id} msg=${m} char=${char}
              onRetry=${onRetry} onSwipe=${onSwipe} onDelete=${onDelete}/>`)}
          ${!msgs.length && !char.firstMessage ? html`
            <div class="conv-hint">发第一条消息开始吧</div>` : null}
        </div>

        <div class="composer">
          <textarea rows="1" value=${draft} placeholder="说点什么"
            onInput=${e => setDraft(e.target.value)}
            onKeyDown=${e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
            }}></textarea>
          ${busy
            ? html`<button class="send-btn is-stop press"
                onClick=${() => ai.cancelReply(chatId, char.id)} aria-label="停止">
                <${Icon} name="close" size=${17}/></button>`
            : html`<button class="send-btn press" disabled=${!draft.trim()}
                onClick=${send} aria-label="发送"><${Icon} name="send" size=${17}/></button>`}
        </div>
      </div>

      <${Sheet} open=${menu} onClose=${() => setMenu(false)} title=${char.name}>
        <${List} inset=${false}>
          <${ListItem} title="重新生成上一条" arrow
            left=${html`<${Icon} name="refresh" size=${18}/>`}
            onClick=${() => { setMenu(false); regenerate(); }}/>
          <${ListItem} title="立即总结记忆" subtitle=${`还有 ${pending} 条未总结`} arrow
            left=${html`<${Icon} name="brain" size=${18}/>`} onClick=${summarize}/>
          <${ListItem} title="角色主页" arrow
            left=${html`<${Icon} name="user" size=${18}/>`}
            onClick=${() => { setMenu(false); nav.push(`/profile/${char.id}`); }}/>
          <${ListItem} title="清空聊天记录" danger arrow
            left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${clearHistory}/>
        <//>
      <//>
    <//>`;
}
