import { html, useState } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { useStore } from '../system/store.js';
import { layout, chats, settings } from '../system/db/index.js';
import * as accounts from '../system/accounts.js';
import { registryStore } from '../system/registry.js';
import { appLook } from '../system/look.js';
import { openApp } from '../system/nav.js';
import { DOCK_SIZE } from '../system/db/defaults.js';
import { AppTile } from '../screens/home/AppTile.js';
import { editState, setPicked, clearPicked } from '../screens/home/editState.js';
import { movePicked, clearDockSlot, newFolderAuto, putInFolder } from '../screens/home/layout.js';
import { Sheet, List, ListItem, toast } from '../ui/index.js';

function unreadFor(appId) {
  if (appId !== 'chat') return 0;
  const me = accounts.currentId();
  return chats.where(c => (c.personaId || me) === me)
    .reduce((n, c) => n + (c.unread || 0), 0);
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
  const [into, setInto] = useState(false);

  const folders = (lay.pages || []).flatMap(p => (p.cells || []).filter(c => c.kind === 'folder'));

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
    if (!slots[i]) { toast('请先选择一个图标，再点击此处移入'); return; }
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
            <${ListItem} title="移动到其他位置" subtitle="随后点击网格中的位置，或底部的其他格位" arrow multiline
              left=${html`<${Icon} name="drag" size=${18}/>`}
              onClick=${() => { setPicked({ type: 'dock', i: menu }); setMenu(null); }}/>
            <${ListItem} title="新建文件夹" subtitle="在主界面的空位上新建，该应用移入其中" arrow multiline
              left=${html`<${Icon} name="folder" size=${18}/>`}
              onClick=${() => {
                const r = newFolderAuto(pageIdx, [slots[menu]], appLook(slots[menu])?.name || '文件夹');
                if (!r.ok) toast(r.reason, 'error');
                setMenu(null);
              }}/>
            ${folders.length ? html`
              <${ListItem} title="装进已有的文件夹" subtitle="从底栏移出，收进主界面的文件夹" arrow multiline
                left=${html`<${Icon} name="folder" size=${18}/>`}
                onClick=${() => setInto(true)}/>` : null}
            <${ListItem} title="从底栏移除" subtitle="应用本身保留，仅从该栏移出" danger arrow multiline
              left=${html`<${Icon} name="trash" size=${18}/>`}
              onClick=${() => { clearDockSlot(menu); setMenu(null); }}/>
          <//>` : null}
      <//>

      <${Sheet} open=${into} onClose=${() => setInto(false)} title="装进哪个文件夹">
        <${List} inset=${false}>
          ${folders.map(f => html`
            <${ListItem} key=${f.id} title=${f.name || '文件夹'} arrow
              subtitle=${`已有 ${(f.apps || []).length} 个应用`}
              left=${html`<${Icon} name="folder" size=${18}/>`}
              onClick=${() => {
                const r = putInFolder(f.id, slots[menu]);
                if (!r.ok) toast(r.reason, 'error');
                setInto(false); setMenu(null);
              }}/>`)}
        <//>
      <//>
    </div>`;
}
