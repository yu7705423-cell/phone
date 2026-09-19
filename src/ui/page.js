import { html, useEffect, useRef } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { IconButton } from './basic.js';

// 从左边缘往右一划就是返回。
//
// 返回键在左上角，那是右手拇指最够不着的一个角。真机上谁也不去点它，
// 都是从边上划。所以这个手势不是锦上添花，它才是主路。
//
// **只认起手落在左边缘那一条里的。** 横着的手势在这个项目里已经有主了：
// 主屏是一页一页翻的，列表里的长按靠 touchmove 取消，表情面板、头像池这些
// 还横着滚。限制在边缘那一条里，谁都不抢。iOS 自己也是这么分的。
//
// **跟着手指走，松手再决定。** 从前是松手那一刻直接跳，中途看出不对也收不回来
// —— 而这个项目里退出一页常常意味着那一屏的状态没了（写了一半的消息、
// 选了一半的多选）。现在页面跟着手指平移，松手时没走够就弹回去。
//
// **退到哪儿由这一页自己的 onBack 决定，不是统一 nav.pop。** 一百多页里有七页
// 的返回是「退出多选」「关掉预览」这种页内的事，统一处理会把它们一起退掉。
//
// 三处不接这一下：
//   一、弹窗或底部浮层开着的时候（.overlay）。它们各有各的关法，而且盖在上面，
//       底下这层跟着手指动会很怪。整屏浮层（.fullsheet）不在此列 ——
//       它自带一个 Page，那一层自己接。
//   二、起手落在横向滚得动的东西里。那一下是人家的。
//   三、挂了 .no-edge-back 的地方。自己要用这个方向的页面写上它。
//
// 嵌套的两层 Page（整屏浮层盖在应用页上）只能有一层接：事件会往上冒，
// 两层都接就是关掉浮层的同时把底下那页也退了。所以起手时认一下
// 最近的那个 .page 是不是自己。

// 起手必须落在最左边这么宽的一条里。
// 原来是 24，照着 iOS 自己那条定的。但在 iOS 上这一条是**系统先看**的：
// 从最左边起手的触摸先归系统的边缘手势判，交到网页手里时往往已经划出去
// 几十像素，clientX 早就不在 24 以内，这套判定根本不会开始。
// 放宽到 40 能救回一部分；ipa 里则整套让给原生手势（见下面 phoneNativeBack）。
const EDGE = 40;
const OWN = 8;        // 横向先走够这么多，这一下才算归我
const TAKE = 0.3;     // 松手时走过页宽的这个比例就算完成
const FLING = 0.5;    // px/ms。甩得够快，没走够距离也算

/** 从这个节点往上找到 stop 为止，路上有没有横着滚得动的容器。 */
function scrollsSideways(node, stop) {
  for (let n = node; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

/** 这个元素上的过渡有多长。时长写在 tokens.css 里，这边只管读。 */
function durOf(el) {
  const raw = (getComputedStyle(el).transitionDuration || '0s').split(',')[0].trim();
  const n = parseFloat(raw) || 0;
  return raw.endsWith('ms') ? n : n * 1000;
}

function useSwipeBack(onBack) {
  // hook 一律无条件调用，不能因为这一页没有返回就少调一个
  const ref = useRef(null);
  const g = useRef(null);

  const settle = go => {
    const el = ref.current;
    g.current = null;
    if (!el) return;
    el.classList.remove('is-swiping');
    el.classList.add('is-settling');
    el.style.transform = go ? 'translateX(100%)' : 'translateX(0)';
    setTimeout(() => {
      el.classList.remove('is-settling');
      el.style.transform = '';
      if (go && onBack) onBack();
    }, durOf(el));
  };

  const handlers = {
    onTouchStart: e => {
      g.current = null;
      // 外壳自己有原生的边缘手势时让开，免得两边各退一级。
      // ios/Sources/ShellViewController.swift 在文档一开始就注入这个标记
      if (window.phoneNativeBack) return;
      if (!onBack || e.touches.length !== 1) return;
      const p = e.touches[0];
      if (p.clientX > EDGE) return;
      if (document.querySelector('.overlay')) return;
      const t = e.target;
      if (!t.closest || t.closest('.page') !== ref.current) return;
      if (t.closest('.no-edge-back')) return;
      if (scrollsSideways(t, ref.current)) return;
      const now = performance.now();
      g.current = { x: p.clientX, y: p.clientY, t: now, lx: p.clientX, lt: now, own: false };
    },

    onTouchMove: e => {
      const s = g.current;
      if (!s) return;
      const p = e.touches[0];
      if (!p) return;
      const dx = p.clientX - s.x;
      const dy = p.clientY - s.y;
      if (!s.own) {
        // 往回走、或者竖着走得更多，那是别人的手势，让开
        if (dx < 0 || Math.abs(dy) > Math.abs(dx)) { g.current = null; return; }
        if (dx < OWN) return;
        s.own = true;
        ref.current?.classList.add('is-swiping');
      }
      // 归我了才拦。拦早了会把正常的竖向滚动也吃掉
      e.preventDefault();
      s.lx = p.clientX;
      s.lt = performance.now();
      if (ref.current) ref.current.style.transform = `translateX(${Math.max(0, dx)}px)`;
    },

    onTouchEnd: () => {
      const s = g.current;
      if (!s) return;
      if (!s.own) { g.current = null; return; }
      const moved = Math.max(0, s.lx - s.x);
      const speed = moved / Math.max(1, s.lt - s.t);
      const width = ref.current?.clientWidth || 1;
      settle(moved > width * TAKE || speed > FLING);
    },

    onTouchCancel: () => {
      if (g.current?.own) settle(false); else g.current = null;
    },
  };
  return { ref, handlers };
}

// ---- 「返回」这一下归谁 ----
//
// 外壳那个悬浮返回键要做的事，必须和这一页左上角那个箭头一模一样。
// 一百多页里有七页的返回是「退出多选」「关掉预览」这种**页内**的事，
// 外壳统一调 nav.pop 会把它们连页面一起退掉。
//
// 所以每个带返回的 Page 把自己的 onBack 压进这个栈，最上面那个就是当前
// 该执行的（整屏浮层套在应用页上时，里面那层后挂，正好在上面）。
// 和 ui/overlay.js 里那个关闭栈是同一套写法。
const backs = [];
export const topBack = () => backs[backs.length - 1] || null;

function useBackRegistry(onBack) {
  const ref = useRef(onBack);
  ref.current = onBack;
  // 依赖只看「有没有返回」。onBack 多半是每次渲染新建的箭头函数，
  // 拿它本身当依赖会一渲染就摘一次挂一次
  useEffect(() => {
    if (!ref.current) return undefined;
    const fn = () => ref.current?.();
    backs.push(fn);
    return () => {
      const i = backs.indexOf(fn);
      if (i >= 0) backs.splice(i, 1);
    };
  }, [!onBack]);
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
  useBackRegistry(onBack);

  return html`
    <div class="page" ref=${swipe.ref} ...${swipe.handlers}>
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
