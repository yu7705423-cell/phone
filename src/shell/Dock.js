import { html, useState } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { useStore } from '../system/store.js';
import { layout, chats, settings } from '../system/db/index.js';
import { registryStore } from '../system/registry.js';
import { appLook } from '../system/look.js';
import { openApp } from '../system/nav.js';
import { DOCK_SIZE } from '../system/db/defaults.js';
import { AppTile } from '../screens/home/AppTile.js';
import { editState, setPicked, clearPicked } from '../screens/home/editState.js';
import { movePicked, clearDockSlot } from '../screens/home/layout.js';
import { Sheet, List, ListItem, toast } from '../ui/index.js';

function unreadFor(appId) {
  if (appId !== 'chat') return 0;
  return chats.all().reduce((n, c) => n + (c.unread || 0), 0);
}

// 底部四个 app 图标，包在一个胶囊里。整理模式下也能点，
// 和网格里的图标互相挪动走的是同一套逻辑。
export function Dock() {
  const lay = useStore(layout.store);
  const { edit, picked } = useStore(editState);
  useStore(registryStore);
  useStore(chats.store);
  useStore(settings.store);
  const [menu, setMenu] = useState(null);

  const slots = Array.from({ length: DOCK_SIZE }, (_, i) => (lay.dock || [])[i] || null);
  const pageIdx = Math.min(lay.currentPage || 0, Math.max(0, (lay.pages || []).length - 1));

  const tap = i => {
    if (!edit) {
      if (slots[i]) openApp(slots[i]);
      return;
    }
    if (picked) {
      if (picked.type === 'dock' && picked.i === i) { clearPicked(); return; }
      const r = movePicked(pageIdx, picked, { type: 'dock', i });
      if (!r.ok) toast(r.reason, 'error');
      clearPicked();
      return;
    }
    if (!slots[i]) { toast('先点一个图标，再点这里把它挪过来'); return; }
    setMenu(i);
  };

  return html`
    <div class="dock">
      <div class=${`dock-capsule${edit ? ' is-edit' : ''}`}>
        ${slots.map((appId, i) => {
          const app = appId ? appLook(appId) : null;
          const isPicked = picked?.type === 'dock' && picked.i === i;
          if (!app) {
            return html`
              <button key=${i} class=${`dock-slot dock-empty${edit ? ' is-edit' : ''}`}
                onClick=${() => tap(i)} aria-label="空位"></button>`;
          }
          return html`
            <button key=${i} class=${`dock-slot press${isPicked ? ' is-picked' : ''}`}
              onClick=${() => tap(i)} aria-label=${app.name}>
              <${AppTile} app=${app} badge=${unreadFor(appId)}/>
            </button>`;
        })}
      </div>

      <${Sheet} open=${menu !== null} onClose=${() => setMenu(null)}
        title=${menu !== null && slots[menu] ? (appLook(slots[menu])?.name || '') : ''}>
        ${menu !== null ? html`
          <${List} inset=${false}>
            <${ListItem} title="移动到别处" subtitle="接着点网格里的位置，或底部另一格" arrow multiline
              left=${html`<${Icon} name="drag" size=${18}/>`}
              onClick=${() => { setPicked({ type: 'dock', i: menu }); setMenu(null); }}/>
            <${ListItem} title="从底部移除" subtitle="应用本身还在，只是不放在这一排" danger arrow multiline
              left=${html`<${Icon} name="trash" size=${18}/>`}
              onClick=${() => { clearDockSlot(menu); setMenu(null); }}/>
          <//>` : null}
      <//>
    </div>`;
}
