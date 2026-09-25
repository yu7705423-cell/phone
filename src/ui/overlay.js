import { html, render, useEffect, useLayoutEffect, useRef } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { Page } from './page.js';

// ---- Esc 归谁管 ----
//
// 浮层和外壳都想响应 Esc：浮层要关自己，外壳要「返回」。
// 原先各自挂一个 window keydown，同一次按键两边都跑 —— 外壳先注册所以先执行，
// 于是浮层还没关，人已经被退出会话了。命令式的 confirm / prompt 更糟，
// 它们压根没处理 Esc，按下去弹窗留在原地，底下的页面却退掉了。
//
// 现在只有一个监听器，在 shell/Root.js 里。这边只维护一个栈，
// 外壳按下 Esc 时先问它：关掉了最上面那层就到此为止，一层都没有才轮到「返回」。
const closers = [];

function pushCloser(fn) {
  closers.push(fn);
  return () => {
    const i = closers.lastIndexOf(fn);
    if (i >= 0) closers.splice(i, 1);
  };
}

// 关掉最上面那层浮层。返回是否真的关掉了什么。
export function closeTopOverlay() {
  const fn = closers[closers.length - 1];
  if (!fn) return false;
  fn();
  return true;
}

// 组件式浮层共用这一段：开着的时候把自己的关闭函数压进栈里
function useCloser(open, onClose) {
  useEffect(() => {
    if (!open || !onClose) return undefined;
    return pushCloser(onClose);
  }, [open, onClose]);
}

// cls 挂在遮罩那一层上。is-preview：遮罩不压暗，底下的页面照原样看得见（边调边看的那种）
// ---- 浮层挂到哪儿 ----
//
// 浮层是在页面里面写的（哪个组件要弹就在哪儿写一个 <Sheet>），可它**不能留在页面里面画**：
// iPhone 上可滚动的那一块自成一层，里面的东西 z-index 写得再高也盖不过它后面的兄弟 ——
// 朋友圈的评论表就被底部标签栏的图标压在了输入框上。电脑上的浏览器没有这回事，
// 所以一直没发现。
//
// 所以原地只留一个看不见的占位，真正的内容渲染到所在那一层（应用层、主界面层）的最后面：
// 那里没有滚动容器挡着，后开的浮层自然叠在先开的上面。
const HOSTS = '.app-layer, .home-layer, .screen';
function Portal({ children }) {
  const spot = useRef(null);
  const box = useRef(null);
  useLayoutEffect(() => {
    const el = document.createElement('div');
    el.className = 'sheet-host';
    (spot.current?.closest(HOSTS) || document.querySelector('.screen') || document.body).appendChild(el);
    box.current = el;
    return () => { render(null, el); el.remove(); box.current = null; };
  }, []);
  // 每次重画都把最新的内容交过去。同一个容器里 render 是比对着改，里面的组件状态不丢
  useLayoutEffect(() => { if (box.current) render(children, box.current); });
  return html`<span class="overlay-spot" ref=${spot} hidden></span>`;
}

export const Sheet = ({ open, onClose, title, children, height, cls }) => {
  useCloser(open, onClose);
  if (!open) return null;
  return html`<${Portal}>
    <div class=${`overlay${cls ? ' ' + cls : ''}`} onClick=${onClose}>
      <div class="sheet ph-sheet" style=${height ? `--sheet-h:${height}` : ''} onClick=${e => e.stopPropagation()}>
        <div class="sheet-grip"></div>
        ${title ? html`<div class="sheet-title">${title}</div>` : null}
        <div class="sheet-body scroll">${children}</div>
      </div>
    </div><//>`;
};

// 整屏浮层。盖住当前应用页，自带返回栏，从右边推进来。
// 和 Sheet 的区别只是占满整屏而不是从底下拱一截，内容照样用 List 那一套写。
export const FullSheet = ({ open, onClose, title, right, children }) => {
  useCloser(open, onClose);
  if (!open) return null;
  return html`<${Portal}>
    <div class="fullsheet">
      <${Page} title=${title} onBack=${onClose} right=${right}>${children}<//>
    </div><//>`;
};

// ---- 命令式浮层。挂在独立根节点,不干扰应用树 ----
let hostEl = null;
function host() {
  if (!hostEl) {
    hostEl = document.createElement('div');
    hostEl.className = 'overlay-host';
    document.body.appendChild(hostEl);
  }
  return hostEl;
}

let toasts = [];
let toastSeq = 0;
function paintToasts() {
  render(html`<div class="toast-stack">
    ${toasts.map(t => html`<div key=${t.id} class=${`toast toast-${t.kind}`}>
      ${t.kind !== 'plain' ? html`<${Icon} name=${t.kind === 'error' ? 'close' : 'check'} size=${15}/>` : null}
      <span>${t.text}</span>
    </div>`)}
  </div>`, host());
}

export function toast(text, kind = 'plain', ms = 2000) {
  const id = ++toastSeq;
  toasts = [...toasts, { id, text, kind }];
  paintToasts();
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); paintToasts(); }, ms);
}

export function confirm({ title, message, okText = '确定', cancelText = '取消', danger }) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    let pop = () => {};
    const done = v => { pop(); render(null, box); box.remove(); resolve(v); };
    pop = pushCloser(() => done(false));
    render(html`
      <div class="overlay overlay-center" onClick=${() => done(false)}>
        <div class="modal ph-modal" onClick=${e => e.stopPropagation()}>
          <div class="modal-title">${title}</div>
          ${message ? html`<div class="modal-body modal-message">${message}</div>` : null}
          <div class="modal-actions">
            <button class="modal-btn press" onClick=${() => done(false)}>${cancelText}</button>
            <button class=${`modal-btn modal-btn-primary press${danger ? ' is-danger' : ''}`}
              onClick=${() => done(true)}>${okText}</button>
          </div>
        </div>
      </div>`, box);
  });
}

export function prompt({ title, message = '', value = '', placeholder = '', multiline, okText = '保存', type = 'text' }) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    let cur = value;
    let pop = () => {};
    const done = v => { pop(); render(null, box); box.remove(); resolve(v); };
    pop = pushCloser(() => done(null));
    const onInput = e => { cur = e.target.value; };
    render(html`
      <div class="overlay overlay-center" onClick=${() => done(null)}>
        <div class="modal" onClick=${e => e.stopPropagation()}>
          <div class="modal-title">${title}</div>
          ${message ? html`<div class="modal-message">${message}</div>` : null}
          <div class="modal-body">
            ${multiline
              ? html`<textarea rows="5" placeholder=${placeholder} onInput=${onInput}>${value}</textarea>`
              : html`<input type=${type} value=${value} placeholder=${placeholder} onInput=${onInput}/>`}
          </div>
          <div class="modal-actions">
            <button class="modal-btn press" onClick=${() => done(null)}>取消</button>
            <button class="modal-btn modal-btn-primary press"
              onClick=${() => done(cur)}>${okText}</button>
          </div>
        </div>
      </div>`, box);
  });
}
