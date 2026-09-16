import { html, useEffect } from '../lib.js';
import { useStore } from '../system/store.js';
import { nav, setSwitcher, goHome, back } from '../system/nav.js';
import { settings } from '../system/db/index.js';
import { StatusBar } from './StatusBar.js';
import { Dock } from './Dock.js';
import { LockScreen } from '../screens/LockScreen.js';
import { HomeScreen } from '../screens/home/HomeScreen.js';
import { AppSwitcher } from '../screens/AppSwitcher.js';
import { AppHost } from '../system/runtime.js';
import { useImage } from '../system/db/useImage.js';
import { layout } from '../system/db/index.js';

export function Root() {
  const s = useStore(nav);
  const cfg = useStore(settings.store);
  const lay = useStore(layout.store);
  const wallpaper = useImage(lay.wallpaper?.home);

  useEffect(() => {
    document.documentElement.dataset.theme = cfg.theme;
  }, [cfg.theme]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') back();
      if (e.key === 'Home') goHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const route = s.appId ? (s.stacks[s.appId] || ['/']).slice(-1)[0] : null;

  return html`
    <div class="root">
      <${StatusBar}/>
      <div class="screen">
        ${s.screen === 'lock' ? html`<${LockScreen}/>` : null}
        ${s.screen === 'home' ? html`
          <div class="home-layer" style=${wallpaper ? `background-image:url(${wallpaper})` : ''}>
            <${HomeScreen}/>
          </div>` : null}
        ${s.screen === 'app' && s.appId ? html`
          <div class="app-layer"><${AppHost} appId=${s.appId} route=${route}/></div>` : null}
        ${s.switcher ? html`<${AppSwitcher}/>` : null}
      </div>
      ${s.screen === 'home' ? html`<${Dock}/>` : null}
      ${s.screen !== 'lock' ? html`
        <div class="home-indicator" onClick=${goHome}
          onDblClick=${() => setSwitcher(true)} title="点击回到主界面，双击打开多任务">
          <span class="hi-bar"></span>
        </div>` : null}
    </div>`;
}
