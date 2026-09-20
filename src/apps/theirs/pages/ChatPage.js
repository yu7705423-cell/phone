import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, Icon, Button, Spinner, EmptyState, toast, confirm } from '../../../ui/index.js';
import { CharAvatar } from '../parts.js';

const { db, nav, theirs, ai, intent } = phone;

// 一段和别人的会话。
//
// **进来才生成。** 列表那一步只给了「和谁在聊、最后一句是什么」；正文是点进来
// 这一下才要的 —— 一次把十条会话的正文都要回来，模型多半写到第三条就收尾了。
//
// ---- 打得出字 ----
//
// 你登着的是它的手机，所以在这儿打出去的那一句是**它发给对方的**。
// 发出去先落库（不调接口，那句话是你写的），然后**一次请求**要对面回话。
// 请求失败时你打的那句还在，按一下「让对方回复」再试就是了 ——
// 不自动重试（第 15 条）。
//
// 一次发送一次请求，和聊天那边「发一条回一次」是同一个数，所以这条路由本身
// 不另给开关。走副用接口：这不是你正盯着屏幕等的那两件事之一。
//
// ---- 头像站哪边 ----
//
// 它说的话在右边（is-me），那一行是 row-reverse，**所以头像要写在气泡前面**，
// 翻过来才落在气泡右边。写在后面的话翻过来就跑到气泡左边去了，
// 两边的头像挤在中间 —— 原先就是这个样子。
export function ChatPage({ chatId }) {
  useStore(db.phoneChats.store);
  useStore(db.characters.store);
  const row = theirs.chat(chatId);
  const [busy, setBusy] = useState(false);
  // 出错的是哪一件事：整段没生成出来，还是对面没回话。
  // 两件事的「再来一次」不是同一个动作，合成一个按钮就会去重生成整段
  const [err, setErr] = useState('');
  const [failed, setFailed] = useState('make');
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  const toEnd = () => requestAnimationFrame(() =>
    endRef.current?.scrollIntoView({ block: 'end' }));

  const make = async () => {
    setBusy(true); setErr('');
    try {
      const n = await ai.phone.fillChat(chatId);
      toast(`生成了 ${n} 条`, 'ok');
      toEnd();
    } catch (e) {
      setErr(String(e.message || e)); setFailed('make');
    } finally { setBusy(false); }
  };

  // 对面回一句。发出去那一句已经落库了，这里只管要回话
  const reply = async () => {
    setBusy(true); setErr('');
    try {
      await ai.phone.replyInChat(chatId);
      toEnd();
    } catch (e) {
      setErr(String(e.message || e)); setFailed('reply');
    } finally { setBusy(false); }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    theirs.addLine(chatId, { from: 'char', text });
    toEnd();
    await reply();
  };

  // 重新生成会把这一整段换掉，自己打进去的那几句也在其中
  const regen = async () => {
    if ((row?.lines || []).length && !await confirm({
      title: '重新生成这一段',
      message: '当前这一段对话将被整段替换，其中自行发送的消息也会一并删除。',
      okText: '重新生成',
      danger: true,
    })) return;
    make();
  };

  // 第一次进来、还没有正文时自动要一次。hook 一律无条件调用
  useEffect(() => {
    if (!row || row.filled || busy) return;
    make();
    // 只在这条会话换了的时候再跑
  }, [chatId]);

  // 进来先看见最近那几句，和输入框
  useEffect(() => {
    const t = setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 60);
    return () => clearTimeout(t);
  }, [chatId]);

  if (!row) {
    return html`<${Page} title="聊天" onBack=${nav.pop}>
      <${EmptyState} title="这条会话已经不在了"/><//>`;
  }

  const char = db.characters.get(row.charId);
  const npc = row.npcId ? db.characters.get(row.npcId) : null;
  const lines = row.lines || [];

  return html`
    <${Page} title=${row.name} onBack=${nav.pop}
      right=${html`
        <button class="nav-text press" disabled=${busy} onClick=${regen}>
          ${busy ? '请稍候' : '重新生成'}
        </button>`}>

      ${npc ? html`
        <div class="pad-x pad-t">
          <div class="tp-who" onClick=${() => intent.open('chat', { route: `/edit/${npc.id}`, back: true })}>
            <${CharAvatar} subject=${npc} size=${32}/>
            <span>${npc.name}</span>
            <${Icon} name="chevronRight" size=${15}/>
          </div>
        </div>` : null}

      ${busy && !lines.length ? html`
        <div class="tp-wait"><${Spinner} size=${20}/><span>正在生成这一段对话</span></div>` : null}

      ${err ? html`
        <div class="pad-x pad-t">
          <div class="hint-box">${err}</div>
          <div class="pad-t">
            ${failed === 'reply'
              ? html`<${Button} full variant="ghost" disabled=${busy}
                  onClick=${reply}>让对方回复<//>`
              : html`<${Button} full variant="ghost" disabled=${busy}
                  onClick=${make}>再试一次<//>`}
          </div>
        </div>` : null}

      ${lines.length ? html`
        <div class="tp-talk">
          ${lines.map((l, i) => html`
            <div key=${i} class=${`tp-line${l.from === 'char' ? ' is-me' : ''}`}>
              ${l.from === 'char'
                ? html`<${CharAvatar} subject=${char} size=${28}/>`
                : html`<${CharAvatar} subject=${npc} name=${row.name} size=${28}/>`}
              <span class="tp-bubble">${l.text}</span>
            </div>`)}
          ${busy && lines.length ? html`
            <div class="tp-wait"><${Spinner} size=${16}/><span>对方正在回复</span></div>` : null}
          <div ref=${endRef}></div>
        </div>` : null}

      ${!busy && !lines.length && !err ? html`
        <${EmptyState} icon="message" title="还没有内容"
          desc=${`在下面写一句，以${char?.name || '该角色'}的身份发给${row.name}。`}
          action=${html`<${Button} size="sm" onClick=${make}>生成一整段<//>`}/>` : null}

      <div class="pad-x pad-t">
        <div class="composer composer-inline">
          <textarea rows="1" value=${draft} disabled=${busy}
            placeholder=${`以${char?.name || '该角色'}的身份发送`}
            onInput=${e => setDraft(e.target.value)}></textarea>
          <button class="send-btn press" disabled=${busy || !draft.trim()}
            aria-label="发送" onClick=${send}>
            <${Icon} name="send" size=${16}/>
          </button>
        </div>
      </div>

      <div class="settings-foot">
        这一段对话依据该角色与对方的设定生成，不是实际发生过的对话，
        也不会进入与你的聊天上下文。<br/>
        在此处发送的消息以${char?.name || '该角色'}的身份写入这一段，
        每发送一次调用一次副用接口，由对方回复；发送失败时已写入的消息保留。
        「重新生成」会整段替换，包括自行发送的消息。
      </div>
    <//>`;
}
