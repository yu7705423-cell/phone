import { html, useState, useEffect, useErrorBoundary } from '../lib.js';
import { loadApp, getApp } from './registry.js';
import { goHome } from './nav.js';
import { forceUpdate } from './refresh.js';
import { Icon } from '../icons/Icon.js';
import { reportCrash } from './skin.js';

// 每个 app 外面一层错误边界。一个 app 崩了只显示"应用已停止",不会整机白屏。
export function AppHost({ appId, route }) {
  const [Comp, setComp] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  // 炸了先告诉美化一声：它挂着的那份 CSS 可能就是凶手，卸载时记号要留着
  const [runErr, resetErr] = useErrorBoundary(() => reportCrash());

  useEffect(() => {
    let alive = true;
    setComp(null); setLoadErr(null); resetErr();
    loadApp(appId)
      .then(C => { if (alive) setComp(() => C); })
      .catch(err => { if (alive) setLoadErr(err); });
    return () => { alive = false; };
  }, [appId]);

  const err = runErr || loadErr;
  if (err) {
    const app = getApp(appId);
    // 无构建方案最常见的崩法就是新旧代码混在一起（见 system/refresh.js）。
    // 「更新代码」原先只在设置页里，而设置页本身正是会被这么崩掉的页面之一 ——
    // 恢复手段藏在会坏的东西里面，等于没有。所以崩溃页上也放一个。
    return html`
      <div class="crash">
        <${Icon} name="power" size=${30}/>
        <div class="crash-title">${app?.name || appId} 已停止</div>
        <div class="crash-msg">${String(err.message || err)}</div>
        <div class="crash-actions">
          <button class="btn btn-ghost btn-sm press"
            onClick=${() => { resetErr(); setLoadErr(null); }}>重试</button>
          <button class="btn btn-ghost btn-sm press"
            onClick=${() => forceUpdate().finally(() => location.reload())}>更新代码并重开</button>
          <button class="btn btn-primary btn-sm press" onClick=${goHome}>回到主界面</button>
        </div>
      </div>`;
  }

  if (!Comp) return html`<div class="app-loading"><span class="spinner"></span></div>`;
  return html`<${Comp} route=${route}/>`;
}
