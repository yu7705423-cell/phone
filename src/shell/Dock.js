import { html } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { useStore } from '../system/store.js';
import { layout, chats, messagesOf } from '../system/db/index.js';
import { getApp, registryStore } from '../system/registry.js';
import { openApp } from '../system/nav.js';
import { DOCK_SIZE } from '../system/db/defaults.js';

function unreadFor(appId) {
  if (appId !== 'chat') return 0;
  return chats.all().reduce((n, c) => n + (c.unread || 0), 0);
}

// 底部四个 app 图标。只是快捷方式,点进去与从网格点完全一样,不构成导航层级。
export function Dock() {
  const lay = useStore(layout.store);
  useStore(registryStore);
  useStore(chats.store);

  const slots = Array.from({ length: DOCK_SIZE }, (_, i) => (lay.dock || [])[i] || null);

  return html`
    <div class="dock">
      ${slots.map((appId, i) => {
        const app = appId ? getApp(appId) : null;
        if (!app) return html`<div key=${i} class="dock-slot dock-empty"></div>`;
        const badge = unreadFor(appId);
        return html`
          <button key=${i} class="dock-slot press" onClick=${() => openApp(appId)}>
            <div class="app-tile" style=${`background:${app.accent}`}>
              <${Icon} name=${app.icon} size=${24} style="color:var(--on-tile)"/>
              ${badge ? html`<span class="tile-badge">${badge > 99 ? '99+' : badge}</span>` : null}
            </div>
            <span class="dock-name ellipsis">${app.name}</span>
          </button>`;
      })}
    </div>`;
}
