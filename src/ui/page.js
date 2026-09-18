import { html, useEffect, useRef } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { IconButton } from './basic.js';

// 从左边缘往右一划就是返回。
//
// 返回键在左上角，那是右手拇指最够不着的一个角。真机上谁也不去点它，
// 都是从边上划。所以这个手势不是锦上添花，它才是主路。
//
// 只认**起手在左边缘 24 像素以内**的那一划，横向位移也要明显大于纵向 ——
// 否则页面里任何一次斜着的滑动都会把人划出去。
const EDGE = 24;
const GO = 64;

function useSwipeBack(onBack) {
  const t = useRef(null);
  if (!onBack) return {};
  return {
    onTouchStart: e => {
      const p = e.touches[0];
      t.current = p && p.clientX <= EDGE ? { x: p.clientX, y: p.clientY } : null;
    },
    onTouchEnd: e => {
      const s = t.current;
      t.current = null;
      if (!s) return;
      const p = e.changedTouches[0];
      if (!p) return;
      const dx = p.clientX - s.x;
      const dy = Math.abs(p.clientY - s.y);
      if (dx > GO && dx > dy * 1.5) onBack();
    },
    onTouchCancel: () => { t.current = null; },
  };
}

// 所有页面必须包在 Page 里。滚动、安全区、导航栏、应用内 TabBar 由它统一处理。
// app 不允许自己写 overflow,见 CLAUDE.md
export function Page({ title, onBack, right, tabs, children, noScroll,
                       statusBarStyle, scrollRef, headerExtra }) {
  useEffect(() => {
    if (!statusBarStyle) return;
    document.documentElement.dataset.statusbar = statusBarStyle;
    return () => { delete document.documentElement.dataset.statusbar; };
  }, [statusBarStyle]);

  const swipe = useSwipeBack(onBack);

  return html`
    <div class="page" ...${swipe}>
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
