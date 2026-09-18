import { html, useState } from '../lib.js';
import { Icon } from '../icons/Icon.js';

export const Button = ({ children, onClick, variant = 'primary', size = 'md',
                         disabled, full, icon, style = '' }) => html`
  <button class=${`btn btn-${variant} btn-${size} press${full ? ' btn-full' : ''}`}
    disabled=${disabled} onClick=${onClick} style=${style}>
    ${icon ? html`<${Icon} name=${icon} size=${size === 'sm' ? 15 : 17}/>` : null}
    ${children}
  </button>`;

export const IconButton = ({ name, onClick, size = 20, label, active, style = '' }) => html`
  <button class=${`icon-btn press${active ? ' is-active' : ''}`}
    onClick=${onClick} aria-label=${label || name} style=${style}>
    <${Icon} name=${name} size=${size}/>
  </button>`;

export const Input = ({ value, onInput, placeholder, type = 'text', ...rest }) => html`
  <input type=${type} value=${value} placeholder=${placeholder}
    onInput=${e => onInput && onInput(e.target.value)} ...${rest}/>`;

export const Textarea = ({ value, onInput, placeholder, rows = 4, ...rest }) => html`
  <textarea rows=${rows} value=${value} placeholder=${placeholder}
    onInput=${e => onInput && onInput(e.target.value)} ...${rest}></textarea>`;

// 数字输入。和 Input 的差别只有两点：输入过程中以草稿为准（否则把 "12" 删成
// 空再回填成 0，光标会跳到开头），以及右边带一个单位。
//
// 不设 max。一次能做多少由用户决定，见 CLAUDE.md 第 13 条。min 默认 0，
// 而 0 一律表示「不限」，所以 0 显示为空，由 placeholder 写明不限时的行为。
export const NumberInput = ({ value, onChange, unit = '', min = 0, placeholder = '' }) => {
  const [draft, setDraft] = useState(null);
  const commit = text => {
    setDraft(text);
    const n = Math.floor(Number(text));
    onChange(Number.isFinite(n) ? Math.max(min, n) : min);
  };
  return html`
    <div class="num-row">
      <input type="number" inputmode="numeric" min=${min} placeholder=${placeholder}
        value=${draft != null ? draft : (value ? String(value) : '')}
        onInput=${e => commit(e.target.value)}
        onBlur=${() => setDraft(null)}/>
      ${unit ? html`<span class="num-unit">${unit}</span>` : null}
    </div>`;
};

export const Switch = ({ checked, onChange }) => html`
  <button class=${`switch${checked ? ' is-on' : ''}`} role="switch"
    aria-checked=${!!checked} onClick=${() => onChange && onChange(!checked)}>
    <span class="switch-dot"></span>
  </button>`;

export const Segmented = ({ items, value, onChange }) => html`
  <div class="segmented">
    ${items.map(it => html`
      <button key=${it.value}
        class=${`seg-item${value === it.value ? ' is-active' : ''}`}
        onClick=${() => onChange(it.value)}>${it.label}</button>`)}
  </div>`;

export const Avatar = ({ src, name = '', size = 44, radius }) => {
  const r = radius != null ? `${radius}px` : `${Math.round(size * .32)}px`;
  const st = `width:${size}px;height:${size}px;border-radius:${r};font-size:${Math.round(size * .38)}px`;
  return src
    ? html`<img class="avatar" src=${src} style=${st} alt=""/>`
    : html`<div class="avatar avatar-fallback" style=${st}>${(name || '?').slice(0, 1)}</div>`;
};

export const Spinner = ({ size = 18 }) => html`
  <span class="spinner" style=${`width:${size}px;height:${size}px`}></span>`;

export const EmptyState = ({ icon = 'layers', title, desc, action }) => html`
  <div class="empty">
    <${Icon} name=${icon} size=${34}/>
    <div class="empty-title">${title}</div>
    ${desc ? html`<div class="empty-desc">${desc}</div>` : null}
    ${action || null}
  </div>`;

export const Field = ({ label, desc, children }) => html`
  <label class="field">
    ${label ? html`<div class="field-label">${label}</div>` : null}
    ${children}
    ${desc ? html`<div class="field-desc">${desc}</div>` : null}
  </label>`;
