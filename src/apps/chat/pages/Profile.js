import { html, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Avatar, Button, Icon, List, ListItem, EmptyState, toast, confirm } from '../../../ui/index.js';
import { relTime, chatFor } from '../helpers.js';
import { PHOTO_MAX } from '../../../system/db/images.js';

const { db, nav } = phone;

// 角色主页与我的主页复用同一个组件,只是 subject 不同
export function Profile({ subjectId }) {
  useStore(db.characters.store);
  useStore(db.moments.store);
  useStore(db.persona.store);

  const isMe = subjectId === 'me';
  const me = db.persona.get();
  const subject = isMe ? me : db.characters.get(subjectId);
  const avatar = useImage(subject?.avatar);
  const cover = useImage(subject?.cover);
  const coverRef = useRef(null);

  if (!subject) {
    return html`<${Page} title="主页" onBack=${nav.pop}><${EmptyState} title="这个人不存在了"/><//>`;
  }

  const mine = db.moments.all()
    .filter(m => m.authorId === subjectId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const pickCover = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await db.images.put(file, PHOTO_MAX);
      if (subject.cover) db.images.remove(subject.cover);
      if (isMe) db.persona.set({ cover: id });
      else db.characters.update(subjectId, { cover: id });
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

  return html`
    <${Page} title=${isMe ? '我的主页' : subject.name} onBack=${nav.pop} noScroll=${false}
      right=${isMe ? null : html`
        <button class="nav-text press" onClick=${() => nav.push(`/edit/${subjectId}`)}>编辑</button>`}>
      <div class="profile-cover" style=${cover ? `background-image:url(${cover})` : ''}
        onClick=${() => coverRef.current?.click()}>
        <button class="cover-edit press"><${Icon} name="image" size=${15}/></button>
      </div>
      <input type="file" accept="image/*" ref=${coverRef} onChange=${pickCover} style="display:none"/>

      <div class="profile-head">
        <${Avatar} src=${avatar} name=${subject.name} size=${68}/>
        <div class="profile-meta">
          <div class="profile-name">${subject.name}</div>
          ${subject.signature ? html`<div class="profile-sign">${subject.signature}</div>` : null}
        </div>
      </div>

      ${!isMe ? html`
        <div class="pad-x">
          <${Button} full icon="message"
            onClick=${() => { const c = chatFor(subjectId); nav.push(`/chat/${c.id}`); }}>发消息<//>
        </div>` : html`
        <div class="pad-x">
          <${Button} full variant="ghost" icon="edit"
            onClick=${() => phone.intent.open('settings', { route: '/persona' })}>编辑我的人设<//>
        </div>`}

      ${(isMe ? me.description : subject.persona) ? html`
        <${List} title="人设">
          <${ListItem} multiline title=${isMe ? me.description : subject.persona}/>
        <//>` : null}

      <${List} title=${`动态 ${mine.length}`}>
        ${mine.length ? mine.map(m => html`
          <${ListItem} key=${m.id} multiline title=${m.text}
            subtitle=${relTime(m.createdAt)}
            onClick=${() => nav.push(`/moment/${m.id}`)} arrow/>`)
        : html`<${ListItem} title="还没有动态"/>`}
      <//>

      ${!isMe ? html`
        <div class="pad">
          <${Button} full variant="danger" onClick=${del}>删除这个角色<//>
        </div>` : null}
    <//>`;
}
