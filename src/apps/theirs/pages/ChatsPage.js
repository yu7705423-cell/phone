import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState, Button,
         confirm, toast } from '../../../ui/index.js';
import { CharAvatar } from '../parts.js';

const { db, nav, theirs, intent } = phone;

// 这台手机上的聊天。
//
// 列表分两块，界线要清楚：
//
//   **和你的那一段是真的。** 它就在库里，不是生成出来的。所以单独一组，
//   点进去跳回「聊天」那个 app 看真的那一段，不在这儿再画一遍。
//
//   **别的都是生成出来的。** 和谁聊优先取这个角色已经认识的人（NPC），
//   对得上的用它的头像、点得进它的卡片。
export function ChatsPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.phoneChats.store);

  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="聊天" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  // 和你的那几段：真数据
  const real = db.chats.all()
    .filter(c => (c.characterIds || []).includes(charId))
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));

  const made = theirs.chatsOf(charId);

  const drop = async c => {
    if (!await confirm({ title: `删除与${c.name}的会话`, danger: true, okText: '删除',
      message: '删除后无法恢复，可以重新生成。' })) return;
    theirs.removeChat(c.id);
    toast('已删除');
  };

  const previewOf = c => {
    const last = db.lastMessageOf(c.id);
    if (!last) return '还没有消息';
    return last.content || (last.kind === 'voice' ? '语音' : last.kind === 'image' ? '图片' : '一条消息');
  };

  if (!real.length && !made.length) {
    return html`<${Page} title="聊天" onBack=${nav.pop}>
      <${EmptyState} icon="message" title="还没有会话"
        desc="依据该角色的设定生成这台手机里的会话列表。与你的对话会自动出现在这里。"
        action=${html`<${Button} size="sm" icon="plus"
          onClick=${() => nav.push(`/make/${charId}`)}>去生成<//>`}/>
    <//>`;
  }

  return html`
    <${Page} title="聊天" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => nav.push(`/make/${charId}`)}>生成</button>`}>

      ${real.length ? html`
        <${List} title="与你">
          ${real.map(c => {
            const me = db.personas.get(c.personaId);
            return html`
              <${ListItem} key=${c.id} title=${me?.name || '我'} arrow multiline
                subtitle=${previewOf(c)}
                left=${html`<${CharAvatar} subject=${me} name=${me?.name || '我'} size=${36}/>`}
                onClick=${() => intent.open('chat', { route: `/chat/${c.id}` })}/>`;
          })}
        <//>
        <div class="settings-foot">这一段是真实的对话记录，点击后回到「聊天」查看。</div>` : null}

      ${made.length ? html`
        <${List} title=${`其他 ${made.length} 条`}>
          ${made.map(c => {
            const npc = c.npcId ? db.characters.get(c.npcId) : null;
            return html`
              <${ListItem} key=${c.id} title=${c.name} arrow multiline
                subtitle=${[c.preview || '还没有内容',
                  c.filled ? `${c.lines.length} 条` : '点击后生成'].filter(Boolean).join(' · ')}
                left=${html`<${CharAvatar} subject=${npc} name=${c.name} size=${36}/>`}
                right=${html`
                  <button class="press" aria-label=${`删除 ${c.name}`}
                    onClick=${ev => { ev.stopPropagation(); drop(c); }}>
                    <${Icon} name="trash" size=${16}/>
                  </button>`}
                onClick=${() => nav.push(`/chat/${c.id}`)}/>`;
          })}
        <//>` : null}

      <div class="settings-foot">
        除「与你」之外的会话依据该角色的设定生成，其中的人名若与已有角色一致，
        会关联到该角色。
      </div>
    <//>`;
}
