import { html, useState } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Icon } from '../../../ui/index.js';

const { clock } = phone;

// 选时区。每行右边直接显示那边此刻几点 —— 与其让人回忆时差，不如直接给答案。
export function ZonePicker({ open, value, onPick, onClose, title = '选一个时区', allowSame }) {
  const [q, setQ] = useState('');
  const key = q.trim().toLowerCase();
  const now = clock.now();

  const items = clock.ZONES.filter(z =>
    !key || z.label.toLowerCase().includes(key) || z.id.toLowerCase().includes(key));

  const pick = id => { onPick(id); setQ(''); onClose(); };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title=${title} height="82%">
      <div class="pad-x">
        <div class="search-bar">
          <${Icon} name="search" size=${16}/>
          <input value=${q} placeholder="搜城市或国家"
            onInput=${e => setQ(e.target.value)}/>
          ${q ? html`<button class="press" onClick=${() => setQ('')}>
            <${Icon} name="close" size=${15}/></button>` : null}
        </div>
      </div>

      <${List} inset=${false}>
        ${allowSame ? html`
          <${ListItem} title="跟我同一个时区" subtitle="绝大多数情况就是这个" multiline
            right=${!value ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => pick('')}/>` : null}
        ${items.map(z => html`
          <${ListItem} key=${z.id} title=${z.label}
            right=${html`<span class="zone-now">
              ${clock.clockOnly(now, z.id)}
              ${value === z.id ? html`<${Icon} name="check" size=${16}/>` : null}
            </span>`}
            onClick=${() => pick(z.id)}/>`)}
        ${items.length ? null : html`<${ListItem} title="没有匹配的地方"/>`}
      <//>
    <//>`;
}
