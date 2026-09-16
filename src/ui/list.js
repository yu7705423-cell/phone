import { html } from '../lib.js';
import { Icon } from '../icons/Icon.js';

export const List = ({ children, title, inset = true }) => html`
  <div class="list-wrap">
    ${title ? html`<div class="list-title">${title}</div>` : null}
    <div class=${`list${inset ? ' list-inset' : ''}`}>${children}</div>
  </div>`;

export const ListItem = ({ title, subtitle, left, right, onClick, arrow, danger, multiline }) => html`
  <div class=${`list-item${onClick ? ' is-tappable press' : ''}${danger ? ' is-danger' : ''}`}
    onClick=${onClick}>
    ${left ? html`<div class="li-left">${left}</div>` : null}
    <div class=${`li-body${multiline ? ' li-multiline' : ''}`}>
      <div class="li-title">${title}</div>
      ${subtitle ? html`<div class="li-sub">${subtitle}</div>` : null}
    </div>
    ${right ? html`<div class="li-right">${right}</div>` : null}
    ${arrow ? html`<${Icon} name="chevronRight" size=${16} class="li-arrow"/>` : null}
  </div>`;
