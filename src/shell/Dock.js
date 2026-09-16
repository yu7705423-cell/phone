import { html } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { useStore } from '../system/store.js';
import { layout, chats, settings } from '../system/db/index.js';
import { registryStore } from '../system/registry.js';
import { appLook } from '../system/look.js';
import { openApp } from '../system/nav.js';
import { DOCK_SIZE } from '../system/db/defaults.js';

function unreadFor(appId) {
  if (appId !== 'chat') return 0;
  return chats.all().reduce((n, c) => n + (c.unread || 0), 0);
}

// 底部四个 app 图标，包在一个胶囊里。只是快捷方式，点进去与从网格点完全一样。
// 不显示名称：胶囊里放文字会挤，也不符合这个版式。
export function Dock() {
  const lay = useStore(layout.store);
  useStore(registryStore);
  useStore(chats.store);
  useStore(settings.store);

  const slots = Array.from({ length: DOCK_SIZE }, (_, i) => (lay.dock || [])[i] || null);

  return html`
    <div class="dock">
      <div class="dock-capsule">
        ${slots.map((appId, i) => {
          const app = appId ? appLook(appId) : null;
          if (!app) return html`<div key=${i} class="dock-slot dock-empty"></div>`;
          const badge = unreadFor(appId);
          return html`
            <button key=${i} class="dock-slot press" onClick=${() => openApp(appId)}
              aria-label=${app.name}>
              <div class="app-tile">
                <${Icon} name=${app.icon} size=${24}/>
                ${badge ? html`<span class="tile-badge">${badge > 99 ? '99+' : badge}</span>` : null}
              </div>
            </button>`;
        })}
      </div>
    </div>`;
}
