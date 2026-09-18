import { html } from '../../lib.js';
import { Sheet } from '../../ui/index.js';
import { appLook } from '../../system/look.js';
import { openApp } from '../../system/nav.js';
import { AppTile } from './AppTile.js';

// 打开的文件夹。一层浮层，点里面的图标就进那个 app。
// 不做「文件夹里再套文件夹」：主界面一共几十个图标，套两层只会更难找。
export function FolderView({ cell, onClose }) {
  if (!cell) return null;
  const apps = (cell.apps || []).map(appLook).filter(Boolean);
  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${cell.name || '文件夹'}>
      <div class="folder-open">
        ${apps.map(a => html`
          <button key=${a.id} class="folder-app press"
            onClick=${() => { onClose(); openApp(a.id); }}>
            <${AppTile} app=${a}/>
            <span class="app-name ellipsis">${a.name}</span>
          </button>`)}
      </div>
    <//>`;
}

// 主界面上那一格的样子：最多露出四个图标，剩下的看不见。
export function FolderTile({ cell }) {
  const apps = (cell.apps || []).map(appLook).filter(Boolean).slice(0, 4);
  return html`
    <div class="folder-tile">
      ${apps.map(a => html`
        <span key=${a.id} class="folder-dot"><${AppTile} app=${a}/></span>`)}
    </div>`;
}
