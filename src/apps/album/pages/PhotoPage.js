import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, Sheet, Spinner, EmptyState,
         toast, confirm } from '../../../ui/index.js';
import { CardBox } from './CardBox.js';

const { db, nav, album, cardshot } = phone;

export function PhotoPage({ photoId }) {
  useStore(db.photos.store);
  useStore(db.albums.store);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const p = db.photos.get(photoId);
  const url = useImage(p?.kind === 'image' ? p.imageId : null);
  if (!p) {
    return html`<${Page} title="照片" onBack=${nav.pop}>
      <${EmptyState} title="这张已经不在了"/><//>`;
  }

  const isCard = p.kind === 'card';
  const here = p.albumId ? db.albums.get(p.albumId)?.name : '未归类';

  // 卡片存的时候可能没光栅成（Safari 那边 foreignObject 不一定给画），
  // 所以补一张的入口一直留着 —— 快照那一份在，随时能再试
  const makePng = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await cardshot.rasterCard({
        msgs: p.msgs || [], css: album.shotCss(p.shotId),
      });
      if (!blob) { toast('这台设备画不出这张图。卡片本身不受影响', 'error', 5000); return; }
      const id = await db.images.put(new File([blob], 'card.png', { type: 'image/png' }));
      if (p.imageId) db.images.remove(p.imageId);
      album.attachRaster(p.id, id);
      toast('已生成图片', 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };

  const drop = async () => {
    if (!await confirm({ title: '删除这一张', danger: true,
      message: p.kind === 'image' && p.from
        ? '只从相册里移除。会话里那一条不受影响。'
        : '删除之后不可恢复。' })) return;
    album.removePhoto(p.id);
    nav.pop();
  };

  return html`
    <${Page} title=${isCard ? '消息卡片' : '照片'} onBack=${nav.pop}>
      <div class="ph-stage">
        ${isCard
          ? html`<${CardBox} photo=${p}/>`
          : (url
            ? html`<img class="ph-full" src=${url} alt=""/>`
            : html`<div class="pad"><${Spinner} size=${18}/></div>`)}
      </div>

      <${List}>
        ${p.from ? html`
          <${ListItem} title="来自" multiline
            subtitle=${`${p.from.name || '对方'} · ${new Date(p.from.at || p.createdAt).toLocaleString()}`}
            left=${html`<${Icon} name="message" size=${18}/>`}/>` : null}
        ${isCard ? html`
          <${ListItem} title="包含 ${(p.msgs || []).length} 条消息" multiline
            subtitle=${'连同保存当时的美化一起存下。之后更换美化，这张不会跟着变'}
            left=${html`<${Icon} name="layers" size=${18}/>`}/>
          <${ListItem} title=${p.imageId ? '重新生成图片' : '生成图片'} arrow multiline
            subtitle=${p.imageId
              ? '已经有一张。重新生成会按当前渲染再画一次'
              : '把这张卡片画成 png，便于导出。部分设备可能画不出来，不影响卡片本身'}
            left=${busy ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="image" size=${18}/>`}
            onClick=${makePng}/>` : null}
        <${ListItem} title="所在相册" subtitle=${here} arrow multiline
          left=${html`<${Icon} name="folder" size=${18}/>`}
          onClick=${() => setMoving(true)}/>
        ${p.albumId ? html`
          <${ListItem} title="设为相册封面" arrow multiline
            subtitle="用这一张作为该相册的封面"
            left=${html`<${Icon} name="bookmark" size=${18}/>`}
            onClick=${() => { album.setCover(p.albumId, p.id); toast('已设为封面', 'ok'); }}/>` : null}
        <${ListItem} title="删除" danger arrow
          left=${html`<${Icon} name="trash" size=${18}/>`}
          onClick=${drop}/>
      <//>

      <${Sheet} open=${moving} onClose=${() => setMoving(false)} title="移到哪个相册" height="70%">
        <${List} inset=${false}>
          <${ListItem} title="未归类"
            right=${!p.albumId ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => { album.movePhoto(p.id, album.UNFILED); setMoving(false); }}/>
          ${album.listAlbums().map(a => html`
            <${ListItem} key=${a.id} title=${a.name} subtitle=${`${album.countOf(a.id)} 张`}
              right=${p.albumId === a.id ? html`<${Icon} name="check" size=${16}/>` : null}
              onClick=${() => { album.movePhoto(p.id, a.id); setMoving(false); }}/>`)}
        <//>
      <//>
    <//>`;
}
