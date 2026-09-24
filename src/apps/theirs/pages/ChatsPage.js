import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState, Button, Sheet, Input, Field,
         confirm, toast } from '../../../ui/index.js';
import { CharAvatar } from '../parts.js';

const { db, nav, theirs, ai } = phone;

// 这台手机上的聊天。
//
// 列表分两块，界线要清楚：
//
//   **和你的那一段是真的。** 它就在库里，不是生成出来的。所以单独一组 ——
//   但仍然在这台手机上看（/real/…），不跳回「聊天」那个 app。跨 app 那一跳
//   把「翻别人手机」这件事整个打断了，而且过去了退不回来。
//
//   **别的都是生成出来的。** 和谁聊优先取这个角色已经认识的人（NPC），
//   对得上的用它的头像、点得进它的卡片。
//
// 右上角那个加号是**自己起一条**：登着它的手机，给一个还没聊过的人发消息。
// 名单先列这个角色已经认识的那几个（走 relationsOf，和生成列表用的是同一份），
// 名单里没有的自己填一个名字。起出来的是一条空会话，进去自己打第一句。
export function ChatsPage({ charId }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
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

  // 起一条新的：点名单里那个人，或者按自己填的名字
  const start = (npcId, who) => {
    try {
      const row = theirs.startChat(charId, { npcId, name: who });
      setAdding(false);
      setName('');
      nav.push(`/chat/${row.id}`);
    } catch (e) {
      toast(String(e.message || e), 'error', 4000);
    }
  };

  const previewOf = c => {
    const last = db.lastMessageOf(c.id);
    if (!last) return '还没有消息';
    return last.content || (last.kind === 'voice' ? '语音' : last.kind === 'image' ? '图片' : '一条消息');
  };

  // 已经认识、但这台手机上还没有会话的那几个
  const have = new Set(made.map(c => c.name));
  const known = ai.card.relationsOf(charId)
    .map(r => ({ id: r.charId, row: db.characters.get(r.charId), label: r.label }))
    .filter(k => k.row?.name && !have.has(k.row.name));

  const sheet = html`
    <${Sheet} open=${adding} title="发消息给" onClose=${() => setAdding(false)}>
      ${known.length ? html`
        <${List} title="该角色认识的人">
          ${known.map(k => html`
            <${ListItem} key=${k.id} title=${k.row.name} subtitle=${k.label || ''} arrow
              left=${html`<${CharAvatar} subject=${k.row} size=${36}/>`}
              onClick=${() => start(k.id, k.row.name)}/>`)}
        <//>` : null}
      <div class="pad-x pad-t">
        <${Field} label="其他人"
          desc="填写对方的名称。名称与已有角色一致时会关联到该角色。">
          <${Input} value=${name} placeholder="对方的名称"
            onInput=${v => setName(v)}/>
        <//>
      </div>
      <div class="pad">
        <${Button} full disabled=${!name.trim()}
          onClick=${() => {
            const hit = db.characters.all().find(c => c.name === name.trim());
            start(hit?.id || '', name.trim());
          }}>发起会话<//>
      </div>
    <//>`;

  const plus = html`<button class="nav-text press"
    onClick=${() => setAdding(true)} aria-label="发起新会话">发消息</button>`;

  if (!real.length && !made.length) {
    return html`<${Page} title="聊天" onBack=${nav.pop} right=${plus}>
      <${EmptyState} icon="message" title="还没有会话"
        desc="依据该角色的设定生成这台手机里的会话列表，或者直接给某个人发消息。与你的对话会自动出现在这里。"
        action=${html`<${Button} size="sm" icon="plus"
          onClick=${() => nav.push(`/make/${charId}`)}>去生成<//>`}/>
      ${sheet}
    <//>`;
  }

  return html`
    <${Page} title="聊天" onBack=${nav.pop} right=${plus}>

      ${real.length ? html`
        <${List} title="与你">
          ${real.map(c => {
            const me = db.personas.get(c.personaId);
            return html`
              <${ListItem} key=${c.id} title=${phone.remark.shownToChar(c)} arrow multiline
                subtitle=${previewOf(c)}
                left=${html`<${CharAvatar} subject=${me} name=${me?.name || '我'} size=${36}/>`}
                onClick=${() => nav.push(`/real/${charId}/${c.id}`)}/>`;
          })}
        <//>
        <div class="settings-foot">这一段是真实的对话记录，点击后在这台手机上查看。</div>` : null}

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

      <div class="pad">
        <${Button} full variant="ghost" icon="plus"
          onClick=${() => nav.push(`/make/${charId}`)}>生成更多会话<//>
      </div>
      <div class="settings-foot">
        除「与你」之外的会话依据该角色的设定生成，其中的人名若与已有角色一致，
        会关联到该角色。右上角可以直接给某个人发消息。
      </div>
      ${sheet}
    <//>`;
}
