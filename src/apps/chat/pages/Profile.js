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
  const baseFace = useImage(subject?.avatarBase);
  const cover = useImage(subject?.cover);
  const coverRef = useRef(null);
  const avatarRef = useRef(null);

  if (!subject) {
    return html`<${Page} title="主页" onBack=${nav.pop}><${EmptyState} title="该角色已不存在"/><//>`;
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
      // 头像那一张**留着**：原本长什么样是找得回来的（见 system/avatar.js）。
      // 从前换一张就把旧的删了，于是「换回去」这件事根本无从做起。
      // 封面不是脸，照旧换掉就删。
      if (key === 'avatar') {
        const keepBase = subject.avatarBase || subject.avatar || '';
        patch({ avatar: id, ...(keepBase ? { avatarBase: keepBase } : {}) });
      } else {
        if (subject[key]) db.images.remove(subject[key]);
        patch({ [key]: id });
      }
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  // 原本那张与现在这张。角色在对话里自己换过、或者自己手动换过，两张才不一样
  const faces = phone.avatarLink.facesOf(subject);
  const restore = () => {
    const old = subject.avatarBase;
    if (!old || old === subject.avatar) return;
    if (subject.avatar) db.images.remove(subject.avatar);
    patch({ avatar: old, avatarBase: '' });
    toast('已换回原本的头像', 'ok');
  };

  const del = async () => {
    const n = phone.purge.counts(subjectId);
    if (!await confirm({
      title: '删除这个角色', danger: true, okText: '删除',
      message: `将删除「${subject.name}」，以及与它相关的全部内容：`
        + `${n.chats} 段会话、${n.messages} 条消息、${n.memories} 条记忆，`
        + '还有线下、出行、动态、它的每一天与那台手机。此操作无法撤销。',
    })) return;
    // 挂在它名下的每一域都在 purge 里列着，这里不再各删各的
    phone.purge.dropCharacter(subjectId);
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
        ${faces.changed ? html`
          <button class="press face-base" onClick=${restore} aria-label="换回原本的头像">
            <${Avatar} src=${baseFace} name=${subject.name} size=${34} radius=${17}/>
            <span>原本的</span>
          </button>` : null}
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
              onClick=${() => phone.intent.open('contact', { route: `/me/${me.id}` })}>编辑本人人设<//>`
          : html`<${Button} full icon="message"
              onClick=${() => { const c = chatFor(subjectId); nav.push(`/chat/${c.id}`); }}>发消息<//>`}
      </div>

      <${List} title=${`动态 ${mine.length}`}>
        ${mine.length ? mine.map(m => html`
          <${ListItem} key=${m.id} multiline title=${m.text}
            subtitle=${relTime(m.createdAt)}/>`)
        : html`<${ListItem} title="暂无动态"/>`}
      <//>

      ${!isMe ? html`
        <div class="pad">
          <${Button} full variant="danger" onClick=${del}>删除该角色<//>
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
