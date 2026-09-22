import { html } from '../lib.js';
import { Icon } from '../icons/Icon.js';

// cap: 列表自己在区域内滚动，不往下无限蔓延。
// 条数不定的列表（接口预设、角色列表）一多，整页就被它撑成一条长走廊，
// 底下的东西全被推到看不见的地方。
export const List = ({ children, title, inset = true, cap = false }) => html`
  <div class="list-wrap">
    ${title ? html`<div class="list-title ph-list-title">${title}</div>` : null}
    <div class=${`list ph-list${inset ? ' list-inset' : ''}${cap ? ' list-cap' : ''}`}>${children}</div>
  </div>`;

export const ListItem = ({ title, subtitle, left, right, onClick, arrow, danger, multiline,
                          class: cls = '' }) => html`
  <div class=${`list-item ph-list-item${onClick ? ' is-tappable press' : ''}${danger ? ' is-danger' : ''}${cls ? ' ' + cls : ''}`}
    onClick=${onClick}>
    ${left ? html`<div class="li-left">${left}</div>` : null}
    <div class=${`li-body${multiline ? ' li-multiline' : ''}`}>
      <div class="li-title">${title}</div>
      ${subtitle ? html`<div class="li-sub">${subtitle}</div>` : null}
    </div>
    ${right ? html`<div class="li-right">${right}</div>` : null}
    ${arrow ? html`<${Icon} name="chevronRight" size=${16} class="li-arrow"/>` : null}
  </div>`;
