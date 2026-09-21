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
// step 小于 1 时收小数（字幕偏移要 ±0.5 秒），其余照旧取整。
// max 与负的 min 也放开了：偏移可以是负数。
export const NumberInput = ({ value, onChange, unit = '', min = 0, max = null,
                              step = 1, placeholder = '' }) => {
  const [draft, setDraft] = useState(null);
  const commit = text => {
    setDraft(text);
    const raw = Number(text);
    if (!Number.isFinite(raw)) { onChange(min); return; }
    const n = step < 1 ? Math.round(raw / step) * step : Math.floor(raw);
    const lo = Math.max(min, n);
    onChange(max === null ? lo : Math.min(max, lo));
  };
  return html`
    <div class="num-row">
      <input type="number" inputmode=${step < 1 ? 'decimal' : 'numeric'}
        min=${min} max=${max === null ? undefined : max} step=${step}
        placeholder=${placeholder}
        value=${draft != null ? draft : (value ? String(value) : '')}
        onInput=${e => commit(e.target.value)}
        onBlur=${() => setDraft(null)}/>
      ${unit ? html`<span class="num-unit">${unit}</span>` : null}
    </div>`;
};

// 开关常常放在一整行可点的 ListItem 里。点击事件必须停在这儿：
// 不拦住的话，拨一下开关会顺着冒泡触发整行的 onClick，
// 于是关掉一个世界书条目的同时又进了它的编辑页。
export const Switch = ({ checked, onChange }) => html`
  <button class=${`switch${checked ? ' is-on' : ''}`} role="switch"
    aria-checked=${!!checked}
    onClick=${e => { e.stopPropagation(); if (onChange) onChange(!checked); }}>
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
  // 圆角留一个变量口子。内联样式盖得过类选择器，不留口子的话「美化」
  // 改不动头像形状，只能靠 !important（见 system/skin.js）
  const st = `width:${size}px;height:${size}px;border-radius:var(--avatar-r, ${r});`
    + `font-size:${Math.round(size * .38)}px`;
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
