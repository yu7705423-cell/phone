import { html, useState } from '../../lib.js';
import { Sheet, List, ListItem, Icon, Button, toast } from '../../ui/index.js';
import { listWidgets } from '../../system/registry.js';
import { listAppLooks } from '../../system/look.js';
import { placeAt, placeAtXY, clearCell } from './layout.js';

const sizeLabel = (w, h) => `${w} x ${h}`;

// 整理模式下点任意位置：换内容、交换、移除
export function CellEditor({ cell, pageIdx, onClose, onSwapFrom }) {
  const [tab, setTab] = useState('root');
  if (!cell) return null;

  const widgets = listWidgets();
  const apps = listAppLooks();

  const isSlot = !!cell.slot;
  const put = next => {
    const r = isSlot ? placeAtXY(pageIdx, cell.x, cell.y, next)
                     : placeAt(pageIdx, cell.id, next);
    if (!r.ok) { toast(r.reason, 'error'); return; }
    onClose();
  };

  const body = tab === 'widget' ? html`
    <${List} inset=${false}>
      ${widgets.flatMap(w => (w.sizes || [[2, 2]]).map(([ww, hh]) => html`
        <${ListItem} key=${`${w.id}-${ww}x${hh}`} title=${w.label}
          subtitle=${sizeLabel(ww, hh)} arrow
          left=${html`<${Icon} name="grid" size=${18}/>`}
          onClick=${() => put({ kind: 'widget', ref: w.id, w: ww, h: hh })}/>`))}
    <//>`
  : tab === 'app' ? html`
    <${List} inset=${false}>
      ${apps.map(a => html`
        <${ListItem} key=${a.id} title=${a.name} arrow
          left=${html`<div class="icon-chip"><${Icon} name=${a.icon} size=${17}/></div>`}
          onClick=${() => put({ kind: 'app', ref: a.id, w: 1, h: 1 })}/>`)}
    <//>`
  : html`
    <${List} inset=${false}>
      <${ListItem} title="放一个小组件" subtitle="文字块、图片块、播放器横条、最近会话…" arrow multiline
        left=${html`<${Icon} name="grid" size=${18}/>`} onClick=${() => setTab('widget')}/>
      <${ListItem} title="放一个应用" arrow
        left=${html`<${Icon} name="layers" size=${18}/>`} onClick=${() => setTab('app')}/>
      ${!isSlot ? html`
        <${ListItem} title="移动到别处" subtitle="接着点想放到的位置，占着的会自动让开" arrow multiline
          left=${html`<${Icon} name="drag" size=${18}/>`}
          onClick=${() => { onSwapFrom(cell.id); onClose(); }}/>
        <${ListItem} title="移除" danger arrow
          left=${html`<${Icon} name="trash" size=${18}/>`}
          onClick=${() => { clearCell(pageIdx, cell.id); onClose(); }}/>` : null}
    <//>`;

  const title = tab === 'widget' ? '选一个小组件' : tab === 'app' ? '选一个应用'
    : (isSlot ? '这个空位' : '这个位置');

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${title} height=${tab === 'root' ? null : '72%'}>
      ${tab !== 'root' ? html`
        <div class="pad-b">
          <${Button} size="sm" variant="ghost" icon="chevronLeft"
            onClick=${() => setTab('root')}>返回<//>
        </div>` : null}
      ${body}
    <//>`;
}
