import { html } from '../../../lib.js';
import { useImage } from '../../../sdk/index.js';

// 表情要么是本地图片，要么是远程链接
export function StickerImg({ sticker, size }) {
  const local = useImage(sticker?.imageId);
  const src = local || sticker?.url || null;
  const style = size ? `width:${size}px;height:${size}px` : '';
  if (!src) {
    return html`<div class="stk-miss" style=${style} title=${sticker?.name || ''}>?</div>`;
  }
  return html`<img class="stk-img" style=${style} src=${src} alt=${sticker?.name || ''} loading="lazy"/>`;
}
