import { html, useState, useRef } from '../../lib.js';
import { phone, useStore, useThumb } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, Button, Sheet, Field, Input,
         EmptyState, toast, confirm, prompt } from '../../ui/index.js';
import { AlbumPage } from './pages/AlbumPage.js';
import { PhotoPage } from './pages/PhotoPage.js';

const { db, nav, album } = phone;

// 相册。放两种东西：一张图，或者几条消息存下来的一张卡片。
// 卡片连着**存它那一刻的美化 CSS** 一起存，之后换美化也不会跟着变。

export function Thumb({ photo }) {
  const url = useThumb(photo.kind === 'card' ? photo.imageId : photo.imageId);
  if (url) {
    return html`<div class="photo-tile" style=${`background-image:url(${url})`}></div>`;
  }
  // 卡片没光栅成功时给个能认出来的占位，别留一块空白
  return html`
    <div class=${`photo-tile is-blank${photo.kind === 'card' ? ' is-card' : ''}`}>
      <${Icon} name=${photo.kind === 'card' ? 'message' : 'image'} size=${18}/>
      ${photo.kind === 'card' ? html`<span>${(photo.msgs || []).length} 条</span>` : null}
    </div>`;
}

function Home() {
  useStore(db.albums.store);
  useStore(db.photos.store);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const fileRef = useRef(null);

  const list = album.listAlbums();
  const loose = album.listPhotos(album.UNFILED);
  const total = db.photos.count();

  const make = () => {
    try { album.createAlbum(name); setName(''); setMaking(false); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };

  const pick = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    try {
      for (const f of files) await album.importFile(f);
      toast(`已导入 ${files.length} 张`, 'ok');
    } catch (err) { toast('导入失败：' + (err.message || err), 'error', 4000); }
  };

  return html`
    <${Page} title="相册"
      right=${html`<button class="nav-text press"
        onClick=${() => fileRef.current?.click()}>导入</button>`}>

      ${total ? null : html`
        <${EmptyState} icon="camera" title="相册是空的"
          desc="长按会话里的图片可以保存到这里；多选几条消息可以存成一张卡片。也可以直接导入。"
          action=${html`<${Button} size="sm" icon="upload"
            onClick=${() => fileRef.current?.click()}>导入图片<//>`}/>`}

      <${List} title=${`相册 · ${list.length}`}>
        ${list.map(a => html`
          <${ListItem} key=${a.id} title=${a.name} arrow multiline
            subtitle=${`${album.countOf(a.id)} 张`}
            left=${html`<${Icon} name="folder" size=${18}/>`}
            onClick=${() => nav.push(`/album/${a.id}`)}/>`)}
        <${ListItem} title="新建相册" arrow multiline
          subtitle="把存下来的图片与卡片分门别类"
          left=${html`<${Icon} name="plus" size=${18}/>`}
          onClick=${() => setMaking(true)}/>
      <//>

      ${loose.length ? html`
        <div class="list-title">未归类 · ${loose.length}</div>
        <div class="photo-grid">
          ${loose.map(p => html`
            <button key=${p.id} class="photo-cell press"
              onClick=${() => nav.push(`/photo/${p.id}`)}>
              <${Thumb} photo=${p}/>
            </button>`)}
        </div>` : null}

      <input type="file" accept="image/*" multiple ref=${fileRef}
        onChange=${pick} style="display:none"/>

      <${Sheet} open=${making} onClose=${() => setMaking(false)} title="新建相册">
        <div class="pad-x">
          <${Field} label="名称">
            <${Input} value=${name} placeholder="例如 她发的图"
              onInput=${setName}/>
          <//>
          <div class="pad-b">
            <${Button} full disabled=${!name.trim()} onClick=${make}>建好了<//>
          </div>
        </div>
      <//>
    <//>`;
}

export default function AlbumApp({ route }) {
  const a = route?.match(/^\/album\/(.+)$/);
  if (a) return html`<${AlbumPage} albumId=${a[1]}/>`;
  const p = route?.match(/^\/photo\/(.+)$/);
  if (p) return html`<${PhotoPage} photoId=${p[1]}/>`;
  return html`<${Home}/>`;
}
