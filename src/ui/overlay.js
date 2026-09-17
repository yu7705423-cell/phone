import { html, render, useEffect } from '../lib.js';
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

export function overlayOpen() { return closers.length > 0; }

// 组件式浮层共用这一段：开着的时候把自己的关闭函数压进栈里
function useCloser(open, onClose) {
  useEffect(() => {
    if (!open || !onClose) return undefined;
    return pushCloser(onClose);
  }, [open, onClose]);
}

export const Sheet = ({ open, onClose, title, children, height }) => {
  useCloser(open, onClose);
  if (!open) return null;
  return html`
    <div class="overlay" onClick=${onClose}>
      <div class="sheet" style=${height ? `height:${height}` : ''} onClick=${e => e.stopPropagation()}>
        <div class="sheet-grip"></div>
        ${title ? html`<div class="sheet-title">${title}</div>` : null}
        <div class="sheet-body scroll">${children}</div>
      </div>
    </div>`;
};

// 整屏浮层。盖住当前应用页，自带返回栏，从右边推进来。
// 和 Sheet 的区别只是占满整屏而不是从底下拱一截，内容照样用 List 那一套写。
export const FullSheet = ({ open, onClose, title, right, children }) => {
  useCloser(open, onClose);
  if (!open) return null;
  return html`
    <div class="fullsheet">
      <${Page} title=${title} onBack=${onClose} right=${right}>${children}<//>
    </div>`;
};

export const Modal = ({ open, onClose, title, children, actions }) => {
  useCloser(open, onClose);
  if (!open) return null;
  return html`
    <div class="overlay overlay-center" onClick=${onClose}>
      <div class="modal" onClick=${e => e.stopPropagation()}>
        ${title ? html`<div class="modal-title">${title}</div>` : null}
        <div class="modal-body">${children}</div>
        ${actions ? html`<div class="modal-actions">${actions}</div>` : null}
      </div>
    </div>`;
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
        <div class="modal" onClick=${e => e.stopPropagation()}>
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

export function prompt({ title, value = '', placeholder = '', multiline, okText = '保存' }) {
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
          <div class="modal-body">
            ${multiline
              ? html`<textarea rows="5" placeholder=${placeholder} onInput=${onInput}>${value}</textarea>`
              : html`<input value=${value} placeholder=${placeholder} onInput=${onInput}/>`}
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
