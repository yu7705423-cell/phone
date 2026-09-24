import { html, useState } from '../../../lib.js';
import { phone, useImage, useThumb } from '../../../sdk/index.js';
import { Avatar, Icon, Sheet, confirm, toast } from '../../../ui/index.js';
import { relTime } from '../helpers.js';
import { SongCard } from './SongCard.js';

const { db, ai } = phone;

// 一条动态在三个地方出现：朋友圈、主页的列表分栏、详情页。
// 卡片、评论表、删除，都只写在这一处。

export function Photo({ id }) {
  // 九宫格一格才 120 逻辑像素宽，用缩略图
  const url = useThumb(id);
  return html`<div class="mo-photo" style=${url ? `background-image:url(${url})` : ''}></div>`;
}

export const authorOf = id =>
  (id === 'me' ? (phone.accounts.current() || db.persona.get()) : db.characters.get(id));

export const nameOf = id =>
  (id === 'me' ? (phone.accounts.current()?.name || '我') : (db.characters.get(id)?.name || '某人'));

export async function removeMoment(mo) {
  if (!await confirm({ title: '删除这条动态', danger: true })) return false;
  (mo.images || []).forEach(id => db.images.remove(id));
  db.moments.remove(mo.id);
  return true;
}

/** 动态里带的那首歌。角色的那首还在找时显示「正在找」，找不到就不显示 */
export function MomentSong({ mo, cls = '' }) {
  if (!mo.songId && mo.songState !== 'pending') return null;
  return html`<${SongCard} songId=${mo.songId} query=${mo.songQuery} state=${mo.songState}
    layout="row" cls=${`mo-song ${cls}`}/>`;
}

export function CommentList({ comments }) {
  return html`
    <div class="mo-comment-list">
      ${(comments || []).map(c => html`
        <div key=${c.id} class="mo-comment"><b>${nameOf(c.authorId)}</b>：${c.text}</div>`)}
    </div>`;
}

/** 写一条评论。作者是角色且配了接口，角色会接着回一条。 */
export async function sendComment(mo, text) {
  const t = String(text || '').trim();
  if (!t || !mo) return;
  ai.moments.addComment(mo.id, 'me', t);
  if (mo.authorId !== 'me' && ai.isConfigured()) {
    try { await ai.moments.replyComment(mo.id, mo.authorId, t); }
    catch (err) { toast(String(err.message || err), 'error', 4000); }
  }
}

export function MomentCard({ mo, onComment, onOpen }) {
  const isMe = mo.authorId === 'me';
  const author = authorOf(mo.authorId);
  const avatar = useImage(author?.avatar);
  const liked = (mo.likes || []).includes('me');
  const open = onOpen ? () => onOpen(mo) : null;

  return html`
    <div class="mo-card">
      <${Avatar} src=${avatar} name=${author?.name} size=${40} radius=${8}/>
      <div class="mo-main">
        <div class="mo-name">${author?.name || '已删除'}</div>
        ${mo.text ? html`<div class=${`mo-text${open ? ' press' : ''}`} onClick=${open}>${mo.text}</div>` : null}
        <${MomentSong} mo=${mo}/>
        ${mo.imagePending ? html`
          <div class="mo-genning"><span class="spinner"></span>正在配图</div>` : null}
        ${mo.imageError ? html`<div class="mo-genfail">配图没生成出来：${mo.imageError}</div>` : null}
        ${(mo.images || []).length ? html`
          <div class=${`mo-photos n${Math.min(mo.images.length, 9)}${open ? ' press' : ''}`} onClick=${open}>
            ${mo.images.slice(0, 9).map(id => html`<${Photo} key=${id} id=${id}/>`)}
          </div>` : null}
        <div class="mo-foot">
          <span class="mo-time">${relTime(mo.createdAt)}${isMe && Array.isArray(mo.visibleTo)
            ? (mo.visibleTo.length ? ` · ${mo.visibleTo.length} 位角色可见` : ' · 仅自己可见') : ''}</span>
          <div class="mo-actions">
            <button class=${`mo-act press${liked ? ' is-on' : ''}`}
              onClick=${() => ai.moments.toggleLike(mo.id)}>
              <${Icon} name="heart" size=${14} fill=${liked ? 'currentColor' : 'none'}/>
              ${(mo.likes || []).length || ''}
            </button>
            <button class="mo-act press" onClick=${() => onComment(mo)}>
              <${Icon} name="message" size=${14}/>${(mo.comments || []).length || ''}
            </button>
            ${isMe ? html`<button class="mo-act press" onClick=${() => removeMoment(mo)}>
              <${Icon} name="trash" size=${14}/></button>` : null}
          </div>
        </div>

        ${(mo.comments || []).length ? html`
          <div class="mo-comments"><${CommentList} comments=${mo.comments}/></div>` : null}
      </div>
    </div>`;
}

/** 评论那张底部表。target 是要评论的那条，null 表示关着。 */
export function CommentSheet({ target, onClose }) {
  const [text, setText] = useState('');
  const [asking, setAsking] = useState('');     // 正在写评论的那个角色
  const mo = target ? db.moments.get(target.id) : null;
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await sendComment(mo, t);
  };
  // 自己发的动态：请某个角色来看。点一位调一次接口，由该角色写一条评论并点赞。
  // 不在发布时自动叫所有角色 —— 那是用户没点头的花费（CLAUDE.md 第 15 条）
  const ask = async char => {
    if (asking) return;
    if (!ai.isConfigured()) { toast('尚未配置模型接口', 'error'); return; }
    setAsking(char.id);
    try { await ai.moments.commentMoment(mo.id, char.id); }
    catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setAsking(''); }
  };
  const chars = mo?.authorId === 'me' ? db.characters.all() : [];
  // 输入框放在最上面，表占大半屏。从前输入框在表的最底下，键盘一起来就压在它上面、
  // 和底栏叠在一起写不了字；放在上半屏，键盘只盖得住下半截
  return html`
    <${Sheet} open=${!!target} onClose=${onClose} title="评论" height="72%">
      ${mo ? html`
        <div class="composer composer-inline mo-comment-input">
          <textarea rows="2" value=${text} placeholder="写下评论"
            onInput=${e => setText(e.target.value)}></textarea>
          <button class="send-btn press" disabled=${!text.trim()} onClick=${send}>
            <${Icon} name="send" size=${16}/></button>
        </div>
        ${chars.length ? html`
          <div class="mo-ask">
            <div class="mo-ask-title">请角色评论</div>
            <div class="mo-ask-desc">点一位角色，调用一次接口，由该角色看过这条动态后写一条评论并点赞。</div>
            <div class="btn-row is-chips">
              ${chars.map(c => html`
                <button key=${c.id} class=${`btn btn-sm btn-ghost press${asking === c.id ? ' is-busy' : ''}`}
                  disabled=${!!asking} onClick=${() => ask(c)}>
                  ${asking === c.id ? '正在评论' : c.name}
                </button>`)}
            </div>
          </div>` : null}
        ${(mo.comments || []).length ? html`
          <div class="mo-comment-list"><${CommentList} comments=${mo.comments}/></div>`
        : html`<div class="settings-foot">暂无评论。</div>`}` : null}
    <//>`;
}
