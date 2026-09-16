import { html, render, useEffect } from '../lib.js';
import { Icon } from '../icons/Icon.js';

export const Sheet = ({ open, onClose, title, children, height }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
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

export const Modal = ({ open, onClose, title, children, actions }) => {
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
    const done = v => { render(null, box); box.remove(); resolve(v); };
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
    const done = v => { render(null, box); box.remove(); resolve(v); };
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
