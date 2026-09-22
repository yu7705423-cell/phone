import { html } from '../../../lib.js';
import { phone, useStore, useThumb } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Icon, EmptyState } from '../../../ui/index.js';

const { db, album } = phone;

function Cell({ photo, onPick }) {
  const url = useThumb(photo.imageId);
  if (!url) return null;
  return html`
    <button class="photo-cell press" onClick=${() => onPick(photo.imageId)}>
      <div class="photo-tile" style=${`background-image:url(${url})`}></div>
    </button>`;
}

// 发图时挑来源。相册里存过的可以直接发，不必每次从系统相册翻。
export function PhotoSource({ open, onClose, onFile, onPick }) {
  useStore(db.photos.store);
  if (!open) return null;
  // 卡片没光栅成的那些没有图可发，挑不了
  const list = album.allPhotos().filter(p => p.imageId);

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="发送图片" height="76%">
      <${List} inset=${false}>
        <${ListItem} title="从文件选择" arrow
          left=${html`<${Icon} name="upload" size=${18}/>`}
          onClick=${onFile}/>
      <//>
      ${list.length ? html`
        <div class="list-title">相册 · ${list.length}</div>
        <div class="photo-grid">
          ${list.map(p => html`<${Cell} key=${p.id} photo=${p} onPick=${onPick}/>`)}
        </div>`
      : html`<div class="settings-foot">相册里还没有图片。</div>`}
    <//>`;
}
