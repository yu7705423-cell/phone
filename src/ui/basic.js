import { html, useState } from '../lib.js';
import { Icon } from '../icons/Icon.js';

export const Button = ({ children, onClick, variant = 'primary', size = 'md',
                         disabled, full, icon, style = '' }) => html`
  <button class=${`btn btn-${variant} btn-${size} press${full ? ' btn-full' : ''}`}
    disabled=${disabled} onClick=${onClick} style=${style}>
    ${icon ? html`<${Icon} name=${icon} size=${size === 'sm' ? 15 : 17}/>` : null}
    ${children}
  </button>`;

// cls 是给契约钩子留的口子。图标是内联 svg，CSS 换不掉里面的路径，
// 换图那一招是「把 svg 藏起来、在按钮上铺一张背景图」—— 那就得先能
// 单独选中这一个按钮，而不是选中所有 .icon-btn（见 ARCHITECTURE 4.138）
export const IconButton = ({ name, onClick, size = 20, label, active, style = '', cls = '' }) => html`
  <button class=${`icon-btn press${active ? ' is-active' : ''}${cls ? ' ' + cls : ''}`}
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
/**
 * 滑杆。右边跟一个数字框，两边同步。
 *
 * **两个都要。** 只有滑杆时调不到精确值，只有数字框时看不出范围，
 * 而生成器上这两件事都要 —— 拖着看效果，定下来再对齐数字。
 */
export const Slider = ({ value, onChange, min = 0, max = 100, step = 1, unit = '' }) => {
  const clamp = v => Math.max(min, Math.min(max, Number(v) || 0));
  return html`
    <div class="slider-row">
      <input type="range" min=${min} max=${max} step=${step} value=${Number(value) || 0}
        onInput=${e => onChange(clamp(e.target.value))}/>
      <input class="slider-num" type="number" inputmode="numeric"
        min=${min} max=${max} step=${step} value=${Number(value) || 0}
        onInput=${e => onChange(clamp(e.target.value))}/>
      ${unit ? html`<span class="slider-unit">${unit}</span>` : null}
    </div>`;
};

/**
 * 取色。带一个「不改这一项」的按钮。
 *
 * 系统的取色器没有「空」这个状态，一点开就必然给回一个颜色。少了那个按钮，
 * 手滑点开就再也回不到「保持默认」，只能删掉整份重来。
 */
export const ColorInput = ({ value, onChange, fallback = '#888888' }) => html`
  <div class="color-row">
    <input type="color" class="color-swatch" value=${value || fallback}
      onInput=${e => onChange(e.target.value)}/>
    <span class="color-hex mono">${value || '未设置'}</span>
    ${value ? html`
      <button type="button" class="color-clear press" onClick=${() => onChange('')}>不改</button>` : null}
  </div>`;

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

// 头像。
//
// **一条真正的尺寸声明都不写在这儿。** 内联样式赢过任何选择器，从前这里
// 直接写 width / height，于是「美化」根本改不动头像大小 —— 外面写什么都
// 盖不住，而且完全看不出为什么。现在只喂三个自定义属性，真正那几条声明
// 在 ui.css 里，从公开变量读起（见 ARCHITECTURE 4.136）。
export const Avatar = ({ src, name = '', size = 44, radius }) => {
  const r = radius != null ? `${radius}px` : `${Math.round(size * .32)}px`;
  const st = `--av-size:${size}px;--av-r:${r};--av-fs:${Math.round(size * .38)}px`;
  return src
    ? html`<img class="avatar ph-avatar" src=${src} style=${st} alt=""/>`
    : html`<div class="avatar ph-avatar avatar-fallback" style=${st}>${(name || '?').slice(0, 1)}</div>`;
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
