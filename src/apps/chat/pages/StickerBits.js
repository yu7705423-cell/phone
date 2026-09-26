import { html, useState } from '../../../lib.js';
import { phone, useImage } from '../../../sdk/index.js';

// 表情要么是本地图片，要么是远程链接。
// 远程的不带 Referer 去取（防盗链，4.284）；取不回来就画一个「打不开」的格子，不留一个空白的破图标
export function StickerImg({ sticker, size }) {
  const local = useImage(sticker?.imageId);
  const [bad, setBad] = useState('');
  const src = local || (sticker?.url ? phone.stickers.displayUrl(sticker.url) : null);
  const style = size ? `width:${size}px;height:${size}px` : '';
  if (!src || bad === src) {
    return html`<div class="stk-miss" style=${style} title=${src ? '链接无法打开' : (sticker?.name || '')}>${src ? '无法打开' : '?'}</div>`;
  }
  return html`<img class="stk-img" style=${style} src=${src} alt=${sticker?.name || ''} loading="lazy"
    referrerpolicy="no-referrer" onError=${() => { if (!local) setBad(src); }}/>`;
}
