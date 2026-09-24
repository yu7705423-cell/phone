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
import { CallLayer } from '../screens/CallLayer.js';
import { AppHost } from '../system/runtime.js';
import { closeTopOverlay } from '../ui/overlay.js';
import * as alarm from '../system/alarm.js';
import { notify } from '../system/notify.js';
import { useImage } from '../system/db/useImage.js';
import { applyLook, applyCustomCSS, syncThemeColor } from '../system/look.js';
import * as skin from '../system/skin.js';
import { apply as applyFonts } from '../system/fonts.js';
import { layout } from '../system/db/index.js';
import { start as startProactive } from '../system/ai/proactive.js';
import { start as startMedRemind } from '../system/medremind.js';
import { installUnlock } from '../system/sound.js';
import { installBridge } from '../system/push.js';
import * as keepAlive from '../system/keepalive.js';
import { KeepAliveBanner } from './KeepAliveBanner.js';
import { NavBack } from './NavBack.js';
import * as goback from './goback.js';

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
    // 下一次的启动画面（index.html）用同一套颜色，不先白一下再黑
    try { localStorage.setItem('eira-theme', cfg.theme); } catch { /* 隐私模式会抛 */ }
  }, [cfg.theme]);

  // 全局那一层美化。见 ARCHITECTURE 4.136
  //
  // **设置 app 打开时一律摘掉。** 这是全局美化唯一的逃生口：一份写坏了
  // 整个界面的美化，人还得进得去设置把它关掉。会话那一层的逃生口是
  // 「消息列表不上美化」，天然存在；全局这一层没有天然的地方，只能人为留。
  const globalSkin = skin.globalSkin();
  const inSettings = s.screen === 'app' && s.appId === 'settings';
  const gid = inSettings ? '' : (globalSkin?.id || '');
  const gat = inSettings ? 0 : (globalSkin?.updatedAt || 0);
  useEffect(() => {
    if (!gid) { skin.unmountGlobal(); return; }
    skin.mountGlobal(skin.get(gid));
    // 活过这么久就认为它没把页面弄垮，把「上次崩在它身上」那个记号清掉
    const t = setTimeout(() => skin.settle(), 1200);
    return () => { clearTimeout(t); skin.unmountGlobal(); };
  }, [gid, gat]);

  useEffect(() => { applyLook(cfg); },
    [cfg.iconColor, cfg.iconShadow, cfg.iconLabels, cfg.bottomLift, cfg.glass]);

  useEffect(() => { applyCustomCSS(cfg.customCSS); }, [cfg.customCSS]);

  // 放在主题、美化、自定义 CSS 之后：它们都可能改底色
  useEffect(() => { syncThemeColor(); }, [cfg.theme, gid, gat, cfg.customCSS]);

  // 返回怎么做。两套只能有一套：样式里按这个属性藏掉另一套
  useEffect(() => {
    document.documentElement.dataset.nav = cfg.navStyle === 'back' ? 'back' : 'bar';
  }, [cfg.navStyle]);

  useEffect(() => { applyFonts(cfg); }, [cfg.fontBody, cfg.fontSerif, cfg.fontHand, cfg.fonts]);

  // 铺了壁纸就换成毛玻璃那套底色，避免白板灰板压在壁纸上
  useEffect(() => {
    document.documentElement.dataset.wallpaper = wallpaper ? 'on' : 'off';
  }, [wallpaper]);


  // 角色主动发消息的调度。跟着整个外壳的生命周期跑，
  // 所以不管当前开着哪个 app 都在数着时间。
  useEffect(() => startProactive(), []);

  // 用药到点提醒。纯本地，一分钟看一眼
  useEffect(() => startMedRemind(), []);

  // iOS 上 AudioContext 必须由一次真实触摸唤醒，越早挂上越好
  useEffect(() => { installUnlock(); }, []);

  // 系统通知：点了要能跳回来，页面不在前台时改由系统弹
  useEffect(() => { installBridge(); }, []);

  // 把「返回上一级」挂到 window 上，给原生外壳调。iOS 的 WKWebView 里，
  // 屏幕最左边那一条触摸先归系统的边缘手势判，交到网页手里时
  // touchstart 的 clientX 往往已经划出去几十像素，网页自己那套判定
  // 根本不会开始。ipa 那层改用原生手势，识别完回调这个
  useEffect(() => goback.install(), []);

  // 保活。开着就放无声音频；没有过真实触摸时浏览器会拦下来，等第一次点击补一次
  useEffect(() => {
    if (!cfg.keepAlive) { keepAlive.stop(); return undefined; }
    keepAlive.start();
    return keepAlive.install(() => settings.get().keepAlive);
  }, [cfg.keepAlive]);

  // 待办到点。**这是浏览器那一半** —— 关着 app 就不跑，那种要靠系统闹钟
  // （见 system/alarm.js 开头）。两边都在时会各响一次，位置不同，不算重复
  useEffect(() => alarm.start(row => notify({
    title: '待办', body: row.text, icon: 'bell', appId: 'todo',
    payload: { route: '/' },
  })), []);

  // 全场唯一的 Esc 监听。开着浮层时 Esc 归浮层 —— 只关最上面那一层，
  // 不退出当前页；一层都没开才轮到「返回」。见 ui/overlay.js 顶上那段。
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        if (!closeTopOverlay()) back();
      }
      if (e.key === 'Home') goHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const route = s.appId ? (s.stacks[s.appId] || ['/']).slice(-1)[0] : null;

  return html`
    <div class="root">
      ${wallpaper ? html`
        <div class="wallpaper ph-wallpaper" style=${`--wall:url(${wallpaper})`}></div>` : null}
      <${StatusBar}/>
      <div class="screen ph-screen">
        ${s.screen === 'lock' ? html`<${LockScreen}/>` : null}
        ${s.screen === 'home' ? html`
          <div class="home-layer"><${HomeScreen}/></div>` : null}
        ${s.screen === 'app' && s.appId ? html`
          <div class="app-layer"><${AppHost} appId=${s.appId} route=${route}/></div>` : null}
        ${s.switcher ? html`<${AppSwitcher}/>` : null}
        ${s.screen === 'app' && cfg.navStyle === 'back'
          ? html`<${NavBack}/>` : null}
      </div>
      ${s.screen === 'home' ? html`<${Dock}/>` : null}
      ${s.screen !== 'lock' && cfg.navStyle !== 'back' ? html`
        <div class="home-indicator" onClick=${goHome}
          onDblClick=${() => setSwitcher(true)} title="点击返回主界面，双击打开多任务">
          <span class="hi-bar"></span>
        </div>` : null}
      <${KeepAliveBanner}/>
      <${NotifyBanner}/>
      <${CallLayer}/>
    </div>`;
}
