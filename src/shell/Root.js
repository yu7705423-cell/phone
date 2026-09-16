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

  // 手机浏览器里 100vh 算的是地址栏收起后的高度，比实际可视区高一截，
  // 底部会被压到屏幕外。这里量一次真实可视高度写进 --app-h。
  // 只在宽度变化（横竖屏切换）时重算：地址栏显隐只改高度，忽略它，
  // 界面就不会像用了 dvh 那样抽动。见 CLAUDE.md 第 1 条。
  useEffect(() => {
    const apply = () => {
      const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
    };
    apply();
    let lastW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastW) return;   // 只是地址栏,不动
      lastW = window.innerWidth;
      apply();
    };
    const onOrient = () => setTimeout(apply, 260);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrient);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrient);
    };
  }, []);

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
