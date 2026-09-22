import { html } from '../../lib.js';
import { Icon } from '../../icons/Icon.js';
import { useImage } from '../../system/db/useImage.js';

// 应用图标。自定义了图片就显示图片，否则显示 SVG。
export function AppTile({ app, badge }) {
  const url = useImage(app?.imageId);
  return html`
    <div class=${`app-tile ph-tile${url ? ' has-image' : ''}`}
      style=${url ? `--tile-img:url(${url})` : ''}>
      ${url ? null : html`<${Icon} name=${app.icon} size=${24}/>`}
      ${badge ? html`<span class="tile-badge">${badge > 99 ? '99+' : badge}</span>` : null}
    </div>`;
}
