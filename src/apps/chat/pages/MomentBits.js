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
  return html`<div class="mo-photo ph-moment-photo" style=${url ? `--mo-img:url(${url})` : ''}></div>`;
}

export const authorOf = id =>
  (id === 'me' ? (phone.accounts.current() || db.persona.get()) : db.characters.get(id));

export const nameOf = id =>
  (id === 'me' ? (phone.accounts.current()?.name || '我') : (phone.remark.nameOf(db.characters.get(id)) || '某人'));

/** 动态作者显示的名字：角色走备注（没备注就是本名），我自己是身份名 */
export const shownName = (id, author) =>
  (!author ? '已删除' : id === 'me' ? (author.name || '我') : (phone.remark.nameOf(author) || '已删除'));

// 角色发的也能删。删掉之后聊天里不再提到它，删除不可恢复
export async function removeMoment(mo) {
  if (!await confirm({
    title: '删除这条动态', danger: true, okText: '删除',
    message: mo.authorId === 'me' ? '删除后不可恢复。' : '删除后不可恢复。评论与点赞一并删除。',
  })) return false;
  (mo.images || []).forEach(id => db.images.remove(id));
  db.moments.remove(mo.id);
  return true;
}

/** 动态里带的那首歌。角色的那首还在找时显示「正在找」，找不到就不显示 */
export function MomentSong({ mo, cls = '' }) {
  if (!mo.songId && mo.songState !== 'pending') return null;
  return html`<${SongCard} songId=${mo.songId} query=${mo.songQuery} state=${mo.songState}
    layout="row" cls=${`mo-song ph-moment-song ${cls}`}/>`;
}

export function CommentList({ comments }) {
  return html`
    <div class="mo-comment-list ph-moment-comment-list">
      ${(comments || []).map(c => html`
        <div key=${c.id} class="mo-comment ph-moment-comment"><b class="ph-moment-comment-name">${nameOf(c.authorId)}</b>：${c.text}</div>`)}
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

// 角色撤回的那一条：折成一行，点一下展开原文（见 system/recall.js）。
// 展开之后仍然点不了赞、写不了评论 —— 那一条已经不在对方的朋友圈上了
export function MomentCard(props) {
  const [open, setOpen] = useState(false);
  const { mo } = props;
  if (!phone.recall.momentRecalled(mo)) return html`<${MomentBody} ...${props}/>`;
  return html`
    <div class=${`mo-recalled ph-moment-recalled${open ? ' is-open' : ''}`}>
      <button class="mo-recalled-line press ph-moment-recalled-line" onClick=${() => setOpen(!open)}>
        <span>${nameOf(mo.authorId)}撤回了一条动态</span>
        <${Icon} name=${open ? 'chevronUp' : 'chevronDown'} size=${13}/>
      </button>
      ${open ? html`<${MomentBody} ...${props} gone=${true}/>` : null}
    </div>`;
}

function MomentBody({ mo, onComment, onOpen, gone = false }) {
  const isMe = mo.authorId === 'me';
  const author = authorOf(mo.authorId);
  const avatar = useImage(author?.avatar);
  const liked = (mo.likes || []).includes('me');
  const open = onOpen && !gone ? () => onOpen(mo) : null;

  return html`
    <div class=${`mo-card ph-moment${isMe ? ' ph-moment-mine' : ''}${gone ? ' is-gone' : ''}`}>
      <${Avatar} src=${avatar} name=${author?.name} size=${40} radius=${8}/>
      <div class="mo-main ph-moment-main">
        <div class="mo-name ph-moment-name">${shownName(mo.authorId, author)}</div>
        ${mo.text ? html`<div class=${`mo-text ph-moment-text${open ? ' press' : ''}`} onClick=${open}>${mo.text}</div>` : null}
        <${MomentSong} mo=${mo}/>
        ${mo.imagePending ? html`
          <div class="mo-genning"><span class="spinner"></span>正在配图</div>` : null}
        ${mo.imageError ? html`<div class="mo-genfail">配图没生成出来：${mo.imageError}</div>` : null}
        ${(mo.images || []).length ? html`
          <div class=${`mo-photos ph-moment-photos n${Math.min(mo.images.length, 9)}${open ? ' press' : ''}`} onClick=${open}>
            ${mo.images.slice(0, 9).map(id => html`<${Photo} key=${id} id=${id}/>`)}
          </div>` : null}
        <div class="mo-foot ph-moment-foot">
          <span class="mo-time ph-moment-time">${relTime(mo.createdAt)}${isMe && Array.isArray(mo.visibleTo)
            ? (mo.visibleTo.length ? ` · ${mo.visibleTo.length} 位角色可见` : ' · 仅自己可见') : ''}</span>
          <div class="mo-actions ph-moment-actions">
            ${gone ? null : html`
            <button class=${`mo-act press ph-moment-act ph-moment-like${liked ? ' is-on' : ''}`}
              onClick=${() => ai.moments.toggleLike(mo.id)}>
              <${Icon} name="heart" size=${14} fill=${liked ? 'currentColor' : 'none'}/>
              ${(mo.likes || []).length || ''}
            </button>
            <button class="mo-act press ph-moment-act ph-moment-comment-btn" onClick=${() => onComment(mo)}>
              <${Icon} name="message" size=${14}/>${(mo.comments || []).length || ''}
            </button>`}
            <button class="mo-act press ph-moment-act ph-moment-delete" aria-label="删除" onClick=${() => removeMoment(mo)}>
              <${Icon} name="trash" size=${14}/></button>
          </div>
        </div>

        ${(mo.comments || []).length ? html`
          <div class="mo-comments ph-moment-comments"><${CommentList} comments=${mo.comments}/></div>` : null}
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
                  ${asking === c.id ? '正在评论' : phone.remark.nameOf(c)}
                </button>`)}
            </div>
          </div>` : null}
        ${(mo.comments || []).length ? html`
          <div class="mo-comment-list"><${CommentList} comments=${mo.comments}/></div>`
        : html`<div class="settings-foot">暂无评论。</div>`}` : null}
    <//>`;
}
