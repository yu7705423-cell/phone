import { html, useState } from '../lib.js';
import * as clock from '../system/time.js';
import { Sheet } from './overlay.js';
import { List, ListItem } from './list.js';
import { Icon } from '../icons/Icon.js';

// 选时区。每行右边直接显示那边此刻几点 —— 与其让人回忆时差，不如直接给答案。
//
// 放在 ui/ 而不是某个 app 里：聊天要选（角色在哪儿、本人在哪儿），
// 出行也要选（目的地在哪儿），而 app 之间不许互相 import（第 8 条）。
// 与其抄第二份，不如认下它本来就是个通用控件。
export function ZonePicker({ open, value, onPick, onClose, title = '选择时区', allowSame }) {
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
          <input value=${q} placeholder="搜索城市或国家"
            onInput=${e => setQ(e.target.value)}/>
          ${q ? html`<button class="press" onClick=${() => setQ('')}>
            <${Icon} name="close" size=${15}/></button>` : null}
        </div>
      </div>

      <${List} inset=${false}>
        ${allowSame ? html`
          <${ListItem} title="与本人相同" subtitle="默认选项" multiline
            right=${!value ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => pick('')}/>` : null}
        ${items.map(z => html`
          <${ListItem} key=${z.id} title=${z.label}
            right=${html`<span class="zone-now">
              ${clock.clockOnly(now, z.id)}
              ${value === z.id ? html`<${Icon} name="check" size=${16}/>` : null}
            </span>`}
            onClick=${() => pick(z.id)}/>`)}
        ${items.length ? null : html`<${ListItem} title="无匹配结果"/>`}
      <//>
    <//>`;
}
