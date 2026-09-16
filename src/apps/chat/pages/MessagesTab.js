import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Avatar, EmptyState, Button, Icon, Sheet, List, ListItem,
         toast, confirm } from '../../../ui/index.js';
import { relTime, splitBubbles } from '../helpers.js';

const { db, nav } = phone;

function Row({ chat, onHold }) {
  const ids = chat.characterIds || [];
  const char = db.characters.get(ids[0]);
  const avatar = useImage(char?.avatar);
  const last = db.lastMessageOf(chat.id);
  const preview = last ? (splitBubbles(last.content).slice(-1)[0] || last.content) : '还没有消息';
  const isGroup = ids.length > 1;
  const title = isGroup
    ? (chat.title || ids.map(id => db.characters.get(id)?.name).filter(Boolean).join('、'))
    : (char?.name || '已删除的角色');

  let holdTimer = null;
  const start = () => { holdTimer = setTimeout(() => { holdTimer = null; onHold(chat); }, 500); };
  const end = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

  return html`
    <div class="msg-row press"
      onClick=${() => nav.push(`/chat/${chat.id}`)}
      onMouseDown=${start} onMouseUp=${end} onMouseLeave=${end}
      onTouchStart=${start} onTouchEnd=${end} onTouchMove=${end}
      onContextMenu=${e => { e.preventDefault(); onHold(chat); }}>
      <${Avatar} src=${avatar} name=${title} size=${46} radius=${23}/>
      <div class="msg-main">
        <div class="msg-line">
          <span class="msg-name ellipsis">${title}</span>
          <span class="msg-time">${relTime(chat.lastMessageAt)}</span>
        </div>
        <div class="msg-line">
          <span class="msg-preview ellipsis">${chat.muted ? '[免打扰] ' : ''}${preview}</span>
          ${chat.unread ? html`<span class="badge">${chat.unread > 99 ? '99+' : chat.unread}</span>` : null}
        </div>
      </div>
    </div>`;
}

// 置顶的在一个胶囊，其余的在另一个胶囊
function Capsule({ title, chats, onHold }) {
  if (!chats.length) return null;
  return html`
    <div class="cap-wrap">
      ${title ? html`<div class="cap-title">${title}</div>` : null}
      <div class="capsule">
        ${chats.map(c => html`<${Row} key=${c.id} chat=${c} onHold=${onHold}/>`)}
      </div>
    </div>`;
}

export function MessagesTab() {
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.characters.store);
  const [held, setHeld] = useState(null);

  const byTime = (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0);
  const all = db.chats.all();
  const pinned = all.filter(c => c.pinned).sort(byTime);
  const rest = all.filter(c => !c.pinned).sort(byTime);

  const close = () => setHeld(null);

  const remove = async () => {
    if (!await confirm({ title: '删除会话', message: '聊天记录会一起删除，记忆保留。', danger: true })) return;
    db.messages.removeWhere(m => m.chatId === held.id);
    db.chats.remove(held.id);
    close();
  };

  if (!all.length) {
    return html`<${EmptyState} icon="message" title="还没有会话"
      desc="去「联系人」建一个角色卡，然后就能开始聊了。"/>`;
  }

  return html`
    <div class="msg-list">
      <${Capsule} title=${pinned.length ? '置顶' : null} chats=${pinned} onHold=${setHeld}/>
      <${Capsule} title=${pinned.length ? '全部' : null} chats=${rest} onHold=${setHeld}/>

      <${Sheet} open=${!!held} onClose=${close}
        title=${held ? (db.characters.get((held.characterIds || [])[0])?.name || '会话') : ''}>
        ${held ? html`
          <${List} inset=${false}>
            <${ListItem} title=${held.pinned ? '取消置顶' : '置顶这个会话'} arrow
              left=${html`<${Icon} name=${held.pinned ? 'chevronDown' : 'chevronUp'} size=${18}/>`}
              onClick=${() => { db.chats.update(held.id, { pinned: !held.pinned }); close(); }}/>
            <${ListItem} title=${held.unread ? '标记为已读' : '标记为未读'} arrow
              left=${html`<${Icon} name="check" size=${18}/>`}
              onClick=${() => {
                db.chats.update(held.id, { unread: held.unread ? 0 : 1 });
                close();
              }}/>
            <${ListItem} title=${held.muted ? '取消免打扰' : '设为免打扰'} arrow
              left=${html`<${Icon} name="bell" size=${18}/>`}
              onClick=${() => { db.chats.update(held.id, { muted: !held.muted }); close(); }}/>
            <${ListItem} title="删除会话" danger arrow
              left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${remove}/>
          <//>` : null}
      <//>
    </div>`;
}
