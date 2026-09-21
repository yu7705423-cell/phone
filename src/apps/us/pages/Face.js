import { html } from '../../../lib.js';
import { useImage } from '../../../sdk/index.js';

// 署名上那张头像。正文的展示层在 ui/prose.js，那一层不碰 sdk，
// 所以把图片 id 解析成地址这一下留在 app 里，当成组件传过去。
export const Face = ({ id }) => {
  const src = useImage(id);
  return src ? html`<img class="sg-face" src=${src} alt=""/>` : null;
};
