import { html, useRef } from '../../lib.js';
import { Sheet, Field, Input, Button, Segmented, Icon, toast } from '../../ui/index.js';
import { useStore } from '../../system/store.js';
import { layout, images } from '../../system/db/index.js';
import { PHOTO_MAX } from '../../system/db/images.js';
import { setCellConfig } from './layout.js';
import { PLAYER_DEFAULT } from './widgets.js';

export function WidgetEditor({ cell, onClose }) {
  useStore(layout.store);
  const fileRef = useRef(null);
  if (!cell) return null;

  const live = layout.get().pages.flatMap(p => p.cells).find(c => c.id === cell.id) || cell;
  const c = { ...PLAYER_DEFAULT, ...(live.config || {}) };
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

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="顶部横条">
      <${Field} label="封面" desc="本地上传，和朋友圈图片一样存在这台设备上">
        <div class="wg-edit-cover">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => fileRef.current?.click()}>${c.cover ? '更换' : '选择图片'}<//>
          ${c.cover ? html`
            <${Button} size="sm" variant="ghost" icon="trash"
              onClick=${() => { images.remove(c.cover); set({ cover: null }); }}>移除<//>` : null}
        </div>
        <input type="file" accept="image/*" ref=${fileRef} onChange=${pick} style="display:none"/>
      <//>

      <${Field} label="封面位置">
        <${Segmented} value=${c.align} onChange=${v => set({ align: v })}
          items=${[{ value: 'left', label: '在左' }, { value: 'right', label: '在右' }]}/>
      <//>

      <${Field} label="第一行" desc="最大，像标题">
        <${Input} value=${c.line1} onInput=${v => set({ line1: v })}/>
      <//>
      <${Field} label="第二行" desc="中等，像作者名">
        <${Input} value=${c.line2} onInput=${v => set({ line2: v })}/>
      <//>
      <${Field} label="第三行" desc="最小，像正在播放的那句">
        <${Input} value=${c.line3} onInput=${v => set({ line3: v })}/>
      <//>

      <${Button} full onClick=${onClose}>完成<//>
    <//>`;
}
