import { html } from '../../../lib.js';
import { phone, useImage } from '../../../sdk/index.js';
import { Icon, Sheet, List, ListItem, Avatar } from '../../../ui/index.js';

// 转发的聊天记录（system/forward.js，ARCHITECTURE 4.260）：气泡、展开看全部、选转发到哪一段

const { db, forward } = phone;

export function ForwardBubble({ msg, onOpen }) {
  const fw = msg.forward || {};
  const items = fw.items || [];
  return html`
    <div class="bubble bubble-forward" onClick=${onOpen ? () => onOpen(msg) : null}>
      <div class="fw-title ellipsis">${fw.title || '聊天记录'}</div>
      <div class="fw-lines">
        ${items.slice(0, 3).map((i, k) => html`<div key=${k} class="fw-line">${i.who}：${i.kind === 'image' ? '[图片]' : i.text}</div>`)}
      </div>
      <div class="tr-foot">聊天记录 · ${items.length} 条</div>
    </div>`;
}

function Item({ item }) {
  const url = useImage(item.imageId || null);
  return html`
    <div class="fw-item">
      <div class="fw-who">${item.who}${item.at ? ` · ${new Date(item.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
      ${url ? html`<img class="fw-img" src=${url} alt=""/>` : html`<div class="fw-text">${item.text}</div>`}
    </div>`;
}

export function ForwardSheet({ msg, onClose }) {
  const fw = msg?.forward || {};
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose} title=${fw.title || '聊天记录'} height="80%">
      <div class="pad">
        <div class="fw-list">
          ${(fw.items || []).map((it, k) => html`<${Item} key=${k} item=${it}/>`)}
        </div>
      </div>
    <//>`;
}

function TargetRow({ chat, onPick }) {
  const ids = chat.characterIds || [];
  const group = ids.length > 1;
  const char = group ? null : db.characters.get(ids[0]);
  const url = useImage(group ? chat.avatar : char?.avatar);
  const title = group ? phone.group.titleOf(chat) : (char ? phone.remark.nameOf(char) : '已删除的角色');
  return html`
    <${ListItem} title=${title} subtitle=${group ? `${ids.length} 位成员` : (char?.signature || '')} arrow
      left=${html`<${Avatar} src=${url} name=${title} size=${36} radius=${18}/>`}
      onClick=${() => onPick(chat)}/>`;
}

/** 选转发到哪一段。只列当前账号名下的会话，除了自己这一段与说这几句话的角色所在的会话 */
export function ForwardPickSheet({ open, fromChatId, ids = [], count, onPick, onClose }) {
  const me = phone.accounts.currentId();
  const authors = ids.map(id => phone.db.messages.get(id)?.authorId).filter(Boolean);
  const list = open ? forward.targets(fromChatId, me, authors) : [];
  return html`
    <${Sheet} open=${open} onClose=${onClose} title=${`转发 ${count} 条消息给`} height="70%">
      ${list.length ? html`
        <${List} inset=${false}>
          ${list.map(c => html`<${TargetRow} key=${c.id} chat=${c} onPick=${onPick}/>`)}
        <//>` : html`<div class="settings-foot">没有其他会话可以转发</div>`}
      <div class="settings-foot">转发后在对方的会话中显示为一条聊天记录，对方在下一次回复时读到它。不会立即调用接口。</div>
    <//>`;
}
