import { html, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Avatar, Button, Icon, List, ListItem, Field, Input, Textarea,
         EmptyState, toast, confirm } from '../../../ui/index.js';
import { relTime, chatFor } from '../helpers.js';
import { PHOTO_MAX, AVATAR_MAX } from '../../../system/db/images.js';

const { db, nav } = phone;

// 角色主页与我的主页复用同一个组件，只是 subject 不同。
// 我的人设也在这里编辑，设置里不再重复一份。
export function Profile({ subjectId, embedded }) {
  useStore(db.characters.store);
  useStore(db.moments.store);
  useStore(db.personas.store);

  const isMe = subjectId === 'me';
  const me = phone.accounts.current() || db.persona.get();
  const subject = isMe ? me : db.characters.get(subjectId);
  const avatar = useImage(subject?.avatar);
  const cover = useImage(subject?.cover);
  const coverRef = useRef(null);
  const avatarRef = useRef(null);

  if (!subject) {
    return html`<${Page} title="主页" onBack=${nav.pop}><${EmptyState} title="这个人不存在了"/><//>`;
  }

  const patch = p => isMe ? db.personas.update(me.id, p) : db.characters.update(subjectId, p);

  const mine = db.moments.all()
    .filter(m => m.authorId === subjectId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const pickImage = (ref, key, max) => async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await db.images.put(file, max);
      if (subject[key]) db.images.remove(subject[key]);
      patch({ [key]: id });
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  const del = async () => {
    if (!await confirm({
      title: '删除角色卡', danger: true,
      message: `「${subject.name}」的会话、记忆、动态都会一并删除。`,
    })) return;
    db.chats.all().filter(c => (c.characterIds || []).includes(subjectId)).forEach(c => {
      db.messages.removeWhere(m => m.chatId === c.id);
      db.chats.remove(c.id);
    });
    db.memories.removeWhere(m => m.scope === `character:${subjectId}`);
    db.moments.removeWhere(m => m.authorId === subjectId);
    db.characters.remove(subjectId);
    nav.popToRoot();
  };

  const body = html`
    <div>
      <div class="profile-cover" style=${cover ? `background-image:url(${cover})` : ''}
        onClick=${() => coverRef.current?.click()}>
        <button class="cover-edit press"><${Icon} name="image" size=${15}/></button>
      </div>
      <input type="file" accept="image/*" ref=${coverRef}
        onChange=${pickImage(coverRef, 'cover', PHOTO_MAX)} style="display:none"/>

      <div class="profile-head">
        <button class="press" onClick=${() => isMe && avatarRef.current?.click()}>
          <${Avatar} src=${avatar} name=${subject.name} size=${72} radius=${36}/>
        </button>
        <input type="file" accept="image/*" ref=${avatarRef}
          onChange=${pickImage(avatarRef, 'avatar', AVATAR_MAX)} style="display:none"/>
        <div class="profile-meta">
          <div class="profile-name">${subject.name}</div>
          ${subject.signature ? html`<div class="profile-sign">${subject.signature}</div>` : null}
        </div>
      </div>

      <div class="pad-x">
        ${isMe
          ? html`<${Button} full variant="ghost" icon="edit"
              onClick=${() => phone.intent.open('contact', { route: `/me/${me.id}` })}>编辑我的人设<//>`
          : html`<${Button} full icon="message"
              onClick=${() => { const c = chatFor(subjectId); nav.push(`/chat/${c.id}`); }}>发消息<//>`}
      </div>

      ${(isMe ? me.description : subject.persona) ? html`
        <${List} title=${isMe ? '我的人设' : '人设'}>
          <${ListItem} multiline title=${isMe ? me.description : subject.persona}/>
        <//>` : null}

      <${List} title=${`动态 ${mine.length}`}>
        ${mine.length ? mine.map(m => html`
          <${ListItem} key=${m.id} multiline title=${m.text}
            subtitle=${relTime(m.createdAt)}/>`)
        : html`<${ListItem} title="还没有动态"/>`}
      <//>

      ${!isMe ? html`
        <div class="pad">
          <${Button} full variant="danger" onClick=${del}>删除这个角色<//>
        </div>` : html`<div class="pad-b"></div>`}

    </div>`;

  // 作为聊天 app 的一个分区嵌入时不再套一层导航栏，避免出现两条标题栏
  if (embedded) return body;

  return html`
    <${Page} title=${subject.name} onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => phone.intent.open('contact', { route: `/char/${subjectId}` })}>编辑</button>`}>
      ${body}
    <//>`;
}
