import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Avatar, Icon, IconButton, EmptyState } from '../../../ui/index.js';
import { relTime } from '../helpers.js';
import { authorOf, CommentList, sendComment, removeMoment, MomentSong } from './MomentBits.js';

const { db, nav, ai } = phone;

// 一条动态的详情。主页网格里点一格、列表里点一条都到这里：
// 图按原比例整幅看，多张可左右翻；正文、时间、点赞与评论都在一屏。

function Big({ id }) {
  const url = useImage(id);
  return html`<div class="ig-slide" style=${url ? `background-image:url(${url})` : ''}></div>`;
}

export function MomentPage({ id }) {
  useStore(db.moments.store);
  useStore(db.characters.store);
  const [text, setText] = useState('');
  const [at, setAt] = useState(0);
  const mo = db.moments.get(id);
  const author = authorOf(mo?.authorId);
  const avatar = useImage(author?.avatar);

  if (!mo) {
    return html`<${Page} title="动态" onBack=${nav.pop}>
      <${EmptyState} title="这条动态已不在了"/><//>`;
  }

  const imgs = mo.images || [];
  // 角色撤回了的：原文照样看得到，赞和评论不再收（见 system/recall.js）
  const gone = phone.recall.momentRecalled(mo);
  const liked = (mo.likes || []).includes('me');
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await sendComment(mo, t);
  };
  const del = async () => { if (await removeMoment(mo)) nav.pop(); };
  const onScroll = e => setAt(Math.round(e.target.scrollLeft / Math.max(1, e.target.clientWidth)));

  return html`
    <${Page} title="动态" onBack=${nav.pop}
      right=${html`<${IconButton} name="trash" label="删除" onClick=${del}/>`}>
      <div class="ig-author press" onClick=${() => nav.push(`/profile/${mo.authorId}`)}>
        <${Avatar} src=${avatar} name=${author?.name} size=${36} radius=${18}/>
        <div>
          <div class="ig-author-name">${author?.name || '已删除'}</div>
          <div class="ig-author-time">${relTime(mo.createdAt)}</div>
        </div>
      </div>

      ${imgs.length ? html`
        <div class="ig-pager" onScroll=${onScroll}>
          ${imgs.map(pid => html`<${Big} key=${pid} id=${pid}/>`)}
        </div>
        ${imgs.length > 1 ? html`
          <div class="ig-dots">
            ${imgs.map((pid, i) => html`<span key=${pid} class=${`ig-dot${i === at ? ' is-on' : ''}`}></span>`)}
          </div>` : null}` : null}
      ${mo.imagePending ? html`<div class="mo-genning pad-x"><span class="spinner"></span>正在配图</div>` : null}

      ${gone ? html`<div class="mo-gone-note">${author?.name || '对方'}已撤回这条动态。以下是撤回前的内容。</div>` : null}
      <div class="ig-foot">
        <button class=${`mo-act press${liked ? ' is-on' : ''}`} disabled=${gone}
          onClick=${() => ai.moments.toggleLike(mo.id)}>
          <${Icon} name="heart" size=${20} fill=${liked ? 'currentColor' : 'none'}/>
          ${(mo.likes || []).length || ''}
        </button>
        <span class="mo-act"><${Icon} name="message" size=${20}/>${(mo.comments || []).length || ''}</span>
      </div>

      ${mo.text ? html`<div class="ig-text">${mo.text}</div>` : null}
      <div class="pad-x"><${MomentSong} mo=${mo}/></div>

      <div class="ig-comments">
        <${CommentList} comments=${mo.comments}/>
        ${gone ? null : html`
        <div class="composer composer-inline">
          <textarea rows="1" value=${text} placeholder="写下评论"
            onInput=${e => setText(e.target.value)}></textarea>
          <button class="send-btn press" disabled=${!text.trim()} onClick=${send}>
            <${Icon} name="send" size=${16}/></button>
        </div>`}
      </div>
    <//>`;
}
