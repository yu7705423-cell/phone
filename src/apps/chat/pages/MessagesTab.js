import { html } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { List, ListItem, Avatar, EmptyState, Button, Icon } from '../../../ui/index.js';
import { relTime, splitBubbles } from '../helpers.js';

const { db, nav } = phone;

function Row({ chat }) {
  const char = db.characters.get((chat.characterIds || [])[0]);
  const avatar = useImage(char?.avatar);
  const last = db.lastMessageOf(chat.id);
  const preview = last ? splitBubbles(last.content).slice(-1)[0] || last.content : '还没有消息';
  const isGroup = (chat.characterIds || []).length > 1;
  const title = isGroup
    ? (chat.title || chat.characterIds.map(id => db.characters.get(id)?.name).filter(Boolean).join('、'))
    : (char?.name || '已删除的角色');

  return html`
    <${ListItem} title=${title} subtitle=${preview} arrow=${false}
      left=${html`<${Avatar} src=${avatar} name=${title} size=${46} radius=${23}/>`}
      right=${html`
        <div class="chat-meta">
          <span>${relTime(chat.lastMessageAt)}</span>
          ${chat.unread ? html`<span class="badge">${chat.unread > 99 ? '99+' : chat.unread}</span>` : null}
        </div>`}
      onClick=${() => nav.push(`/chat/${chat.id}`)}/>`;
}

export function MessagesTab() {
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.characters.store);

  const list = db.chats.all().sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastMessageAt || 0) - (a.lastMessageAt || 0));

  if (!list.length) {
    return html`<${EmptyState} icon="message" title="还没有会话"
      desc="去「联系人」建一个角色卡，然后就能开始聊了。"
      action=${html`<${Button} size="sm" icon="users"
        onClick=${() => nav.replace('/')}>去联系人<//>`}/>`;
  }

  return html`<${List} inset=${false}>${list.map(c => html`<${Row} key=${c.id} chat=${c}/>`)}<//>`;
}
