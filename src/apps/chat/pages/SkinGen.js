import { html, useState, useRef } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { List, ListItem, Field, Segmented, Switch, Slider, ColorInput,
         Button, Icon, toast, confirm } from '../../../ui/index.js';

const { skin } = phone;
const gen = skin.gen;

// 美化生成器的界面。见 ARCHITECTURE 4.137
//
// **这一页不自己列旋钮。** 全部照着 `system/skin-gen.js` 的 `GROUPS` 画 ——
// 加一项旋钮只改那一个文件，这儿不必跟着改。两处各列一份的话，迟早对不上。
//
// 改一下就当场重算 CSS 并写回那一份美化，上面那个样板间是真的气泡组件，
// 所以看到的就是真效果，不是近似。

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

function Control({ item, value, onChange }) {
  if (item.type === 'switch') {
    return html`
      <${ListItem} title=${item.label} multiline subtitle=${item.desc || ''}
        right=${html`<${Switch} checked=${value === true} onChange=${onChange}/>`}/>`;
  }
  const body = item.type === 'color'
    ? html`<${ColorInput} value=${value} onChange=${onChange}/>`
    : item.type === 'num'
      ? html`<${Slider} value=${value} onChange=${onChange}
          min=${item.min ?? 0} max=${item.max ?? 100} unit=${item.unit || ''}/>`
      : item.type === 'pick'
        ? html`<${Segmented} value=${value} onChange=${onChange}
            items=${item.options.map(o => ({ value: o.id, label: o.label }))}/>`
        : html`<${PickImage} value=${value} onChange=${onChange}/>`;
  return html`
    <div class="gen-group">
      <${Field} label=${item.label} desc=${item.desc || ''}>${body}<//>
    </div>`;
}

export function SkinGen({ row, onChange }) {
  const [open, setOpen] = useState('bubble');
  const [showCss, setShowCss] = useState(false);
  const cur = row.gen || {};

  const set = (groupId, itemId, v) => {
    const next = { ...cur, [groupId]: { ...gen.groupValues(cur, groupId), [itemId]: v } };
    onChange({ gen: next });
  };

  const made = gen.emit(cur);
  const { n: pics, bytes } = gen.weigh(cur);
  const dirty = gen.touched(cur);

  const clear = async () => {
    if (!await confirm({
      title: '清空生成的样式', okText: '清空', danger: true,
      message: '所有旋钮恢复默认，自动生成的那一段随之消失。手写的自定义 CSS 不受影响。',
    })) return;
    onChange({ gen: {} });
    toast('已清空', 'ok');
  };

  const copy = () => {
    navigator.clipboard?.writeText(made);
    toast('已复制生成的 CSS', 'ok');
  };

  return html`
    <div class="settings-foot">
      改动即时反映在上方的样板间。生成的样式带 !important，
      手写的自定义 CSS 若要覆盖它，同样需要写 !important。
    </div>

    ${gen.GROUPS.map(g => {
    const values = gen.groupValues(cur, g.id);
    const on = open === g.id;
    const changed = g.items.filter(it => String(values[it.id] ?? '') !== String(it.def ?? '')).length;
    return html`
      <${List} key=${g.id}>
        <${ListItem} title=${g.label} multiline
          subtitle=${changed ? `已修改 ${changed} 项` : '保持默认'}
          left=${html`<${Icon} name=${g.icon} size=${18}/>`}
          right=${html`<${Icon} name=${on ? 'chevronUp' : 'chevronDown'} size=${16}/>`}
          onClick=${() => setOpen(on ? '' : g.id)}/>
      <//>
      ${on ? g.items.filter(it => gen.showItem(it, values)).map(it => html`
        <${Control} key=${it.id} item=${it} value=${values[it.id]}
          onChange=${v => set(g.id, it.id, v)}/>`) : null}`;
  })}

    <${List} title="生成的样式">
      <${ListItem} title=${made ? `共 ${made.split('\n').length} 行` : '还没有生成任何样式'}
        multiline
        subtitle=${pics
    ? `其中内嵌 ${pics} 张图片，约 ${Math.round(bytes / 1024)} KB。导出时一并带走`
    : '调整上面的旋钮即可生成'}
        right=${html`<${Icon} name=${showCss ? 'chevronUp' : 'chevronDown'} size=${16}/>`}
        onClick=${() => setShowCss(v => !v)}/>
      ${made ? html`
        <${ListItem} title="复制这段 CSS" multiline
          subtitle="可以直接交给别人。对方不装本应用也用得上，类名是公开的"
          left=${html`<${Icon} name="copy" size=${18}/>`}
          onClick=${copy}/>` : null}
      ${dirty ? html`
        <${ListItem} title="清空生成的样式" danger multiline
          subtitle="旋钮全部恢复默认。手写的自定义 CSS 不受影响"
          onClick=${clear}/>` : null}
    <//>

    ${showCss && made ? html`<div class="gen-out">${made}</div>` : null}`;
}
