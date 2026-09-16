import { html, render } from './lib.js';
import { ready, settings } from './system/db/index.js';
import { registerApps } from './apps/index.js';
import { setConcurrency } from './system/ai/queue.js';
import { healAndSave } from './screens/home/layout.js';
import { Root } from './shell/Root.js';
import { applyLook, applyCustomCSS } from './system/look.js';
import { nav } from './system/nav.js';
import './screens/home/widgets.js';

const mount = document.getElementById('app');

render(html`<div class="boot"><span class="spinner"></span></div>`, mount);

ready.then(() => {
  registerApps();
  healAndSave();

  const s = settings.get();
  document.documentElement.dataset.theme = s.theme;
  applyLook(s);
  applyCustomCSS(s.customCSS);
  setConcurrency(2);
  if (!s.showLockScreen) nav.set({ screen: 'home' });

  render(html`<${Root}/>`, mount);
}).catch(err => {
  console.error('[boot] 启动失败', err);
  render(html`
    <div class="boot boot-error">
      <div class="boot-title">启动失败</div>
      <div class="boot-msg">${String(err.message || err)}</div>
      <div class="boot-hint">若是首次运行，请确认浏览器允许使用 IndexedDB。</div>
    </div>`, mount);
});
