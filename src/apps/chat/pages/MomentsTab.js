import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Avatar, Button, Icon, EmptyState, Sheet, List, ListItem,
         Textarea, toast, confirm } from '../../../ui/index.js';
import { relTime } from '../helpers.js';
import { PHOTO_MAX } from '../../../system/db/images.js';

const { db, nav, ai } = phone;

function Photo({ id }) {
  const url = useImage(id);
  return html`<div class="mo-photo" style=${url ? `background-image:url(${url})` : ''}></div>`;
}

function MomentCard({ mo, onComment }) {
  const isMe = mo.authorId === 'me';
  const author = isMe ? db.persona.get() : db.characters.get(mo.authorId);
  const avatar = useImage(author?.avatar);
  const liked = (mo.likes || []).includes('me');

  const del = async () => {
    if (!await confirm({ title: '删除这条动态', danger: true })) return;
    (mo.images || []).forEach(id => db.images.remove(id));
    db.moments.remove(mo.id);
  };

  return html`
    <div class="mo-card">
      <${Avatar} src=${avatar} name=${author?.name} size=${38}/>
      <div class="mo-main">
        <div class="mo-name">${author?.name || '已删除'}</div>
        <div class="mo-text">${mo.text}</div>
        ${(mo.images || []).length ? html`
          <div class=${`mo-photos n${Math.min(mo.images.length, 9)}`}>
            ${mo.images.slice(0, 9).map(id => html`<${Photo} key=${id} id=${id}/>`)}
          </div>` : null}
        <div class="mo-foot">
          <span class="mo-time">${relTime(mo.createdAt)}</span>
          <div class="mo-actions">
            <button class=${`mo-act press${liked ? ' is-on' : ''}`}
              onClick=${() => ai.moments.toggleLike(mo.id)}>
              <${Icon} name="heart" size=${14} fill=${liked ? 'currentColor' : 'none'}/>
              ${(mo.likes || []).length || ''}
            </button>
            <button class="mo-act press" onClick=${() => onComment(mo)}>
              <${Icon} name="message" size=${14}/>${(mo.comments || []).length || ''}
            </button>
            ${isMe ? html`<button class="mo-act press" onClick=${del}>
              <${Icon} name="trash" size=${14}/></button>` : null}
          </div>
        </div>

        ${(mo.comments || []).length ? html`
          <div class="mo-comments">
            ${mo.comments.map(c => {
              const who = c.authorId === 'me'
                ? (db.persona.get().name || '我')
                : (db.characters.get(c.authorId)?.name || '某人');
              return html`<div key=${c.id} class="mo-comment"><b>${who}</b>：${c.text}</div>`;
            })}
          </div>` : null}
      </div>
    </div>`;
}

export function MomentsTab() {
  useStore(db.moments.store);
  useStore(db.characters.store);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [imgs, setImgs] = useState([]);
  const [target, setTarget] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const list = db.moments.all().sort((a, b) => b.createdAt - a.createdAt);
  const chars = db.characters.all();

  const addPhotos = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    const room = 9 - imgs.length;
    if (!files.length) return;
    try {
      const ids = [];
      for (const f of files.slice(0, room)) ids.push(await db.images.put(f, PHOTO_MAX));
      setImgs([...imgs, ...ids]);
      if (files.length > room) toast('最多九张');
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  const post = () => {
    if (!text.trim() && !imgs.length) return;
    db.moments.create({
      authorId: 'me', text: text.trim(), images: imgs, likes: [], comments: [],
    });
    setText(''); setImgs([]); setComposing(false);
  };

  const genMoment = async () => {
    if (!chars.length) { toast('先建一个角色卡'); return; }
    if (!ai.isConfigured()) { toast('还没有配置模型接口', 'error'); return; }
    setBusy(true);
    try {
      const char = chars[Math.floor(Math.random() * chars.length)];
      await ai.moments.createMoment(char.id);
      toast(`${char.name} 发了一条动态`);
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  const sendComment = async () => {
    const t = comment.trim();
    if (!t || !target) return;
    ai.moments.addComment(target.id, 'me', t);
    setComment('');
    const mo = db.moments.get(target.id);
    setTarget(mo);
    if (mo.authorId !== 'me' && ai.isConfigured()) {
      try { await ai.moments.replyComment(mo.id, mo.authorId, t); setTarget(db.moments.get(mo.id)); }
      catch (err) { toast(String(err.message || err), 'error', 4000); }
    }
  };

  return html`
    <div class="moments">
      <div class="mo-bar">
        <${Button} size="sm" variant="ghost" icon="edit" onClick=${() => setComposing(true)}>发一条<//>
        <${Button} size="sm" variant="ghost" icon="sparkle" disabled=${busy}
          onClick=${genMoment}>${busy ? '生成中' : '让角色发'}<//>
      </div>

      ${list.length ? list.map(mo => html`
        <${MomentCard} key=${mo.id} mo=${mo} onComment=${m => { setTarget(m); setComment(''); }}/>`)
      : html`<${EmptyState} icon="compass" title="还没有动态"
          desc="你可以自己发，也可以让角色根据人设和最近的聊天自动发一条。图片从本地上传，存在这台设备上。"/>`}

      <${Sheet} open=${composing} onClose=${() => setComposing(false)} title="发动态">
        <${Textarea} rows=${4} value=${text} onInput=${setText} placeholder="这一刻的想法"/>
        <div class="mo-upload">
          ${imgs.map(id => html`
            <div key=${id} class="mo-thumb">
              <${Photo} id=${id}/>
              <button class="mo-thumb-x press" onClick=${() => {
                db.images.remove(id); setImgs(imgs.filter(x => x !== id));
              }}><${Icon} name="close" size=${12}/></button>
            </div>`)}
          ${imgs.length < 9 ? html`
            <button class="mo-add press" onClick=${() => fileRef.current?.click()}>
              <${Icon} name="plus" size=${20}/></button>` : null}
        </div>
        <input type="file" accept="image/*" multiple ref=${fileRef}
          onChange=${addPhotos} style="display:none"/>
        <${Button} full onClick=${post} disabled=${!text.trim() && !imgs.length}>发布<//>
      <//>

      <${Sheet} open=${!!target} onClose=${() => setTarget(null)} title="评论">
        ${target ? html`
          <div class="mo-comment-list">
            ${(db.moments.get(target.id)?.comments || []).map(c => {
              const who = c.authorId === 'me'
                ? (db.persona.get().name || '我')
                : (db.characters.get(c.authorId)?.name || '某人');
              return html`<div key=${c.id} class="mo-comment"><b>${who}</b>：${c.text}</div>`;
            })}
          </div>
          <div class="composer composer-inline">
            <textarea rows="1" value=${comment} placeholder="说点什么"
              onInput=${e => setComment(e.target.value)}></textarea>
            <button class="send-btn press" disabled=${!comment.trim()} onClick=${sendComment}>
              <${Icon} name="send" size=${16}/></button>
          </div>` : null}
      <//>
    </div>`;
}
