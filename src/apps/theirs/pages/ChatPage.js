import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, Icon, Button, Spinner, EmptyState, toast } from '../../../ui/index.js';
import { CharAvatar } from '../parts.js';

const { db, nav, theirs, ai, intent } = phone;

// 一段生成出来的会话。
//
// **进来才生成。** 列表那一步只给了「和谁在聊、最后一句是什么」；正文是点进来
// 这一下才要的 —— 一次把十条会话的正文都要回来，模型多半写到第三条就收尾了。
//
// 已经有正文的不重新生成。要换一份得自己按「重新生成」，那是另一次请求，
// 说清楚了再花。
export function ChatPage({ chatId }) {
  useStore(db.phoneChats.store);
  useStore(db.characters.store);
  const row = theirs.chat(chatId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const make = async () => {
    setBusy(true); setErr('');
    try {
      const n = await ai.phone.fillChat(chatId);
      toast(`生成了 ${n} 条`, 'ok');
    } catch (e) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  };

  // 第一次进来、还没有正文时自动要一次。hook 一律无条件调用
  useEffect(() => {
    if (!row || row.filled || busy) return;
    make();
    // 只在这条会话换了的时候再跑
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
        <button class="nav-text press" disabled=${busy} onClick=${make}>
          ${busy ? '生成中' : '重新生成'}
        </button>`}>

      ${npc ? html`
        <div class="pad-x pad-t">
          <div class="tp-who" onClick=${() => intent.open('chat', { route: `/edit/${npc.id}` })}>
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
            <${Button} full variant="ghost" disabled=${busy} onClick=${make}>再试一次<//>
          </div>
        </div>` : null}

      ${lines.length ? html`
        <div class="tp-talk">
          ${lines.map((l, i) => html`
            <div key=${i} class=${`tp-line${l.from === 'char' ? ' is-me' : ''}`}>
              ${l.from === 'char' ? null
                : html`<${CharAvatar} subject=${npc} name=${row.name} size=${28}/>`}
              <span class="tp-bubble">${l.text}</span>
              ${l.from === 'char'
                ? html`<${CharAvatar} subject=${char} size=${28}/>` : null}
            </div>`)}
        </div>` : null}

      ${!busy && !lines.length && !err ? html`
        <${EmptyState} icon="message" title="还没有内容"
          desc="这一段对话尚未生成。"
          action=${html`<${Button} size="sm" onClick=${make}>生成<//>`}/>` : null}

      <div class="settings-foot">
        这一段对话依据该角色与对方的设定生成，不是实际发生过的对话，
        也不会进入与你的聊天上下文。
      </div>
    <//>`;
}
