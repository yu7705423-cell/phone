import { html } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { useStore } from '../system/store.js';
import { nav, openApp, closeApp, setSwitcher } from '../system/nav.js';
import { registryStore } from '../system/registry.js';
import { appLook } from '../system/look.js';
import { EmptyState } from '../ui/basic.js';

export function AppSwitcher() {
  const s = useStore(nav);
  useStore(registryStore);
  const list = s.recents.map(id => appLook(id)).filter(Boolean);

  return html`
    <div class="switcher" onClick=${() => setSwitcher(false)}>
      <div class="switcher-head">最近使用</div>
      ${list.length ? html`
        <div class="switcher-cards scroll" onClick=${e => e.stopPropagation()}>
          ${list.map(app => html`
            <div key=${app.id} class="sw-card">
              <button class="sw-close press" onClick=${() => closeApp(app.id)} aria-label="关闭">
                <${Icon} name="close" size=${14}/>
              </button>
              <button class="sw-body press" onClick=${() => openApp(app.id)}>
                <div class="app-tile">
                  <${Icon} name=${app.icon} size=${26} />
                </div>
                <span class="sw-name">${app.name}</span>
              </button>
            </div>`)}
        </div>`
      : html`<${EmptyState} icon="layers" title="没有后台运行的应用"/>`}
    </div>`;
}
