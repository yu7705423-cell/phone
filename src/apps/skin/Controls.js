import { html, useRef } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { ListItem, Field, Input, Segmented, Switch, Slider, ColorInput,
         Button, toast } from '../../ui/index.js';

const { skin } = phone;

// 生成器里那一个个旋钮怎么画。照着 `system/skin-gen.js` 的 `items` 走，
// 这一层不认识任何具体的旋钮名 —— 加一项只改那张表。

function PickImage({ value, onChange }) {
  const ref = useRef(null);
  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { onChange(await skin.toDataUrl(file)); }
    catch (err) { toast(String(err.message || err), 'error', 5000); }
  };
  return html`
    <div class="gen-pic">
      ${value ? html`
        <div class="gen-pic-box" style=${`background-image:url(${value})`}></div>` : null}
      <div class="btn-row">
        <${Button} size="sm" variant="ghost" icon="image"
          onClick=${() => ref.current?.click()}>${value ? '换一张' : '选择图片'}<//>
        ${value ? html`
          <${Button} size="sm" variant="ghost" onClick=${() => onChange('')}>移除<//>` : null}
      </div>
      <input type="file" accept="image/*" ref=${ref} onChange=${pick} style="display:none"/>
    </div>`;
}

export function Control({ item, value, onChange }) {
  if (item.type === 'switch') {
    return html`
      <${ListItem} title=${item.label} multiline subtitle=${item.desc || ''}
        right=${html`<${Switch} checked=${value === true} onChange=${onChange}/>`}/>`;
  }
  const body = item.type === 'color'
    ? html`<${ColorInput} value=${value} onChange=${onChange}/>`
    : item.type === 'num'
      ? html`<${Slider} value=${value} onChange=${onChange}
          min=${item.min ?? 0} max=${item.max ?? 100} unit=${item.unit || ''}
          fallback=${item.def === '' ? null : item.def}/>`
      : item.type === 'pick'
        ? html`<${Segmented} value=${value} onChange=${onChange}
            items=${item.options.map(o => ({ value: o.id, label: o.label }))}/>`
        : item.type === 'text'
          ? html`<${Input} value=${value} onInput=${onChange} placeholder="留空表示不改"/>`
          : html`<${PickImage} value=${value} onChange=${onChange}/>`;
  return html`
    <div class="gen-group">
      <${Field} label=${item.label} desc=${item.desc || ''}>${body}<//>
    </div>`;
}
