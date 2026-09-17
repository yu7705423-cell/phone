import { html, useEffect } from '../lib.js';
import { useStore } from '../system/store.js';
import { nav, setSwitcher, goHome, back } from '../system/nav.js';
import { settings } from '../system/db/index.js';
import { StatusBar } from './StatusBar.js';
import { Dock } from './Dock.js';
import { NotifyBanner } from './NotifyBanner.js';
import { LockScreen } from '../screens/LockScreen.js';
import { HomeScreen } from '../screens/home/HomeScreen.js';
import { AppSwitcher } from '../screens/AppSwitcher.js';
import { AppHost } from '../system/runtime.js';
import { useImage } from '../system/db/useImage.js';
import { applyLook, applyCustomCSS } from '../system/look.js';
import { apply as applyFonts } from '../system/fonts.js';
import { layout } from '../system/db/index.js';
import { start as startProactive } from '../system/ai/proactive.js';
import { installUnlock } from '../system/sound.js';
import { installBridge } from '../system/push.js';

export function Root() {
  const s = useStore(nav);
  const cfg = useStore(settings.store);
  const lay = useStore(layout.store);
  const homeWall = useImage(lay.wallpaper?.home);
  const lockWall = useImage(lay.wallpaper?.lock);
  const wallpaper = s.screen === 'lock' ? (lockWall || homeWall)
    : s.screen === 'home' ? homeWall : null;

  useEffect(() => {
    document.documentElement.dataset.theme = cfg.theme;
  }, [cfg.theme]);

  useEffect(() => { applyLook(cfg); },
    [cfg.iconColor, cfg.iconShadow, cfg.iconLabels, cfg.bottomLift]);

  useEffect(() => { applyCustomCSS(cfg.customCSS); }, [cfg.customCSS]);

  useEffect(() => { applyFonts(cfg); }, [cfg.fontBody, cfg.fontSerif, cfg.fonts]);

  // 铺了壁纸就换成毛玻璃那套底色，避免白板灰板压在壁纸上
  useEffect(() => {
    document.documentElement.dataset.wallpaper = wallpaper ? 'on' : 'off';
  }, [wallpaper]);


  // 角色主动发消息的调度。跟着整个外壳的生命周期跑，
  // 所以不管当前开着哪个 app 都在数着时间。
  useEffect(() => startProactive(), []);

  // iOS 上 AudioContext 必须由一次真实触摸唤醒，越早挂上越好
  useEffect(() => { installUnlock(); }, []);

  // 系统通知：点了要能跳回来，页面不在前台时改由系统弹
  useEffect(() => { installBridge(); }, []);

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
      ${wallpaper ? html`
        <div class="wallpaper" style=${`background-image:url(${wallpaper})`}></div>` : null}
      <${StatusBar}/>
      <div class="screen">
        ${s.screen === 'lock' ? html`<${LockScreen}/>` : null}
        ${s.screen === 'home' ? html`
          <div class="home-layer"><${HomeScreen}/></div>` : null}
        ${s.screen === 'app' && s.appId ? html`
          <div class="app-layer"><${AppHost} appId=${s.appId} route=${route}/></div>` : null}
        ${s.switcher ? html`<${AppSwitcher}/>` : null}
      </div>
      ${s.screen === 'home' ? html`<${Dock}/>` : null}
      ${s.screen !== 'lock' ? html`
        <div class="home-indicator" onClick=${goHome}
          onDblClick=${() => setSwitcher(true)} title="点击返回主界面，双击打开多任务">
          <span class="hi-bar"></span>
        </div>` : null}
      <${NotifyBanner}/>
    </div>`;
}
