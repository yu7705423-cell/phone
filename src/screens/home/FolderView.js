import { html, useRef, useState } from '../../lib.js';
import { Sheet } from '../../ui/index.js';
import { appLook } from '../../system/look.js';
import { openApp } from '../../system/nav.js';
import { AppTile } from './AppTile.js';
import { IconSheet } from './IconSheet.js';

// 打开的文件夹。一层浮层，点里面的图标就进那个 app，长按改它的图标与名称。
// 不做「文件夹里再套文件夹」：主界面一共几十个图标，套两层只会更难找。
export function FolderView({ cell, onClose }) {
  const [editing, setEditing] = useState(null);
  const timer = useRef(null);
  const fired = useRef(false);
  if (!cell) return null;

  const apps = (cell.apps || []).map(appLook).filter(Boolean);

  const start = id => {
    clearTimeout(timer.current);
    fired.current = false;
    timer.current = setTimeout(() => { fired.current = true; setEditing(id); }, 550);
  };
  const end = () => clearTimeout(timer.current);
  // 长按松手浏览器还会补一次 click，不吞掉的话菜单刚弹出来就进 app 了
  const tap = id => { if (fired.current) { fired.current = false; return; } onClose(); openApp(id); };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${cell.name || '文件夹'}>
      <div class="folder-open">
        ${apps.map(a => html`
          <button key=${a.id} class="folder-app press no-callout"
            onClick=${() => tap(a.id)}
            onMouseDown=${() => start(a.id)} onMouseUp=${end} onMouseLeave=${end}
            onTouchStart=${() => start(a.id)} onTouchEnd=${end}
            onTouchMove=${end} onTouchCancel=${end}
            onContextMenu=${e => { e.preventDefault(); setEditing(a.id); }}>
            <${AppTile} app=${a}/>
            <span class="app-name ellipsis">${a.name}</span>
          </button>`)}
      </div>
      <div class="settings-foot">长按图标可更改它的图标与名称。</div>
      <${IconSheet} appId=${editing} onClose=${() => setEditing(null)}/>
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
