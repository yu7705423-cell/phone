import { html, useEffect } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { IconButton } from './basic.js';

// 所有页面必须包在 Page 里。滚动、安全区、导航栏、应用内 TabBar 由它统一处理。
// app 不允许自己写 overflow,见 CLAUDE.md
export function Page({ title, onBack, right, tabs, children, noScroll,
                       statusBarStyle, scrollRef, headerExtra }) {
  useEffect(() => {
    if (!statusBarStyle) return;
    document.documentElement.dataset.statusbar = statusBarStyle;
    return () => { delete document.documentElement.dataset.statusbar; };
  }, [statusBarStyle]);

  return html`
    <div class="page">
      ${(title || onBack || right) ? html`
        <div class="navbar">
          <div class="nav-left">
            ${onBack ? html`<${IconButton} name="chevronLeft" size=${22} onClick=${onBack} label="返回"/>` : null}
          </div>
          <div class="nav-title ellipsis">${title}</div>
          <div class="nav-right">${right || null}</div>
        </div>` : null}
      ${headerExtra || null}
      <div class=${`page-body${noScroll ? '' : ' scroll'}`} ref=${scrollRef}>${children}</div>
      ${tabs ? html`<${TabBar} ...${tabs}/>` : null}
    </div>`;
}

export const TabBar = ({ items, value, onChange }) => html`
  <div class="tabbar">
    ${items.map(it => html`
      <button key=${it.id} class=${`tab${value === it.id ? ' is-active' : ''}`}
        onClick=${() => onChange(it.id)}>
        <div class="tab-icon">
          <${Icon} name=${it.icon} size=${21}/>
          ${it.badge ? html`<span class="tab-badge">${it.badge > 99 ? '99+' : it.badge}</span>` : null}
        </div>
        <span class="tab-label">${it.label}</span>
      </button>`)}
  </div>`;
