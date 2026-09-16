import { html, useRef } from '../../lib.js';
import { Sheet, Field, Input, Button, Segmented, Switch, ListItem, List, toast } from '../../ui/index.js';
import { useStore } from '../../system/store.js';
import { layout, images } from '../../system/db/index.js';
import { PHOTO_MAX } from '../../system/db/images.js';
import { getWidget } from '../../system/registry.js';
import { setCellConfig } from './layout.js';
import { LINE_SIZES, PLAYER_DEFAULT, NOTE_DEFAULT } from './widgets.js';

const DEFAULTS = { player: PLAYER_DEFAULT, note: NOTE_DEFAULT, photo: { line1: '' } };

export function WidgetEditor({ cell, onClose }) {
  useStore(layout.store);
  const fileRef = useRef(null);
  if (!cell) return null;

  const live = layout.get().pages.flatMap(p => p.cells).find(c => c.id === cell.id) || cell;
  const wg = getWidget(live.ref);
  const c = { ...(DEFAULTS[live.ref] || {}), ...(live.config || {}) };
  const set = patch => setCellConfig(cell.id, patch);

  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await images.put(file, PHOTO_MAX);
      if (c.cover) images.remove(c.cover);
      set({ cover: id });
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  const hasCover = live.ref === 'player' || live.ref === 'photo';
  const lines = live.ref === 'player' ? 3 : live.ref === 'note' ? 2 : 1;

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${wg?.label || '小组件'} height="82%">
      ${hasCover ? html`
        <${Field} label="图片" desc="本地上传，存在这台设备上">
          <div class="wg-edit-cover">
            <${Button} size="sm" variant="ghost" icon="upload"
              onClick=${() => fileRef.current?.click()}>${c.cover ? '更换' : '选择图片'}<//>
            ${c.cover ? html`
              <${Button} size="sm" variant="ghost" icon="trash"
                onClick=${() => { images.remove(c.cover); set({ cover: null }); }}>移除<//>` : null}
          </div>
          <input type="file" accept="image/*" ref=${fileRef} onChange=${pick} style="display:none"/>
        <//>` : null}

      ${live.ref === 'player' ? html`
        <${Field} label="图片位置">
          <${Segmented} value=${c.align || 'left'} onChange=${v => set({ align: v })}
            items=${[{ value: 'left', label: '在左' }, { value: 'right', label: '在右' }]}/>
        <//>` : null}

      ${Array.from({ length: lines }, (_, i) => i + 1).map(n => html`
        <${Field} key=${n} label=${`第 ${n} 行`}>
          <${Input} value=${c[`line${n}`] || ''} placeholder="留空则不显示"
            onInput=${v => set({ [`line${n}`]: v })}/>
          <div class="pad-t">
            <${Segmented} value=${c[`size${n}`] || 'md'} items=${LINE_SIZES}
              onChange=${v => set({ [`size${n}`]: v })}/>
          </div>
        <//>`)}

      ${live.ref !== 'photo' ? html`
        <${List} inset=${false}>
          <${ListItem} title="用衬线字体" subtitle="更像唱片封面上的排版"
            right=${html`<${Switch} checked=${!!c.serif} onChange=${v => set({ serif: v })}/>`}/>
        <//>` : null}

      <div class="pad-t">
        <${Button} full onClick=${onClose}>完成<//>
      </div>
    <//>`;
}
