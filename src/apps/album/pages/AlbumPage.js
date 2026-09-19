import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, Icon, EmptyState, toast, confirm, prompt } from '../../../ui/index.js';
import { Thumb } from '../App.js';

const { db, nav, album } = phone;

export function AlbumPage({ albumId }) {
  useStore(db.albums.store);
  useStore(db.photos.store);
  const row = db.albums.get(albumId);
  if (!row) {
    return html`<${Page} title="相册" onBack=${nav.pop}>
      <${EmptyState} title="这个相册已经不在了"/><//>`;
  }
  const list = album.listPhotos(albumId);

  const rename = async () => {
    const v = await prompt({ title: '改名', value: row.name });
    if (v) album.renameAlbum(albumId, v);
  };

  const drop = async () => {
    if (!await confirm({ title: `删除相册「${row.name}」`, danger: true,
      message: '里面的照片不会删除，会退回「未归类」。' })) return;
    album.removeAlbum(albumId);
    nav.pop();
  };

  return html`
    <${Page} title=${row.name} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${rename}>改名</button>`}>
      ${list.length ? html`
        <div class="ph-grid">
          ${list.map(p => html`
            <button key=${p.id} class="ph-cell press"
              onClick=${() => nav.push(`/photo/${p.id}`)}>
              <${Thumb} photo=${p}/>
            </button>`)}
        </div>`
      : html`
        <${EmptyState} icon="camera" title="这个相册是空的"
          desc="在别处保存图片或卡片时可以选择放进这里，也可以在照片页里移动过来。"/>`}

      <div class="pad">
        <button class="nav-text press is-danger" onClick=${drop}>删除这个相册</button>
      </div>
    <//>`;
}
