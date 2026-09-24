import { html, useRef } from '../../lib.js';
import { Sheet, Field, Input, Button, Segmented, Switch, ListItem, List, toast } from '../../ui/index.js';
import { useStore } from '../../system/store.js';
import { layout, images, files, characters } from '../../system/db/index.js';
import { PHOTO_MAX } from '../../system/db/images.js';
import { getWidget } from '../../system/registry.js';
import { setCellConfig } from './layout.js';
import { LINE_SIZES, PLAYER_DEFAULT, NOTE_DEFAULT, LOVE_DEFAULT,
         CUSTOM_DEFAULT, CUSTOM_MAX_BYTES,
         HEALTH_STATS, HEALTH_DEFAULT } from './widgets.js';

const DEFAULTS = {
  player: PLAYER_DEFAULT, note: NOTE_DEFAULT, photo: { line1: '' },
  love: LOVE_DEFAULT, custom: CUSTOM_DEFAULT, health: HEALTH_DEFAULT,
};

const LANGS = [{ value: 'en', label: 'English' }, { value: 'zh', label: '中文' }];

const kb = n => `${Math.max(1, Math.round(n / 1024))} KB`;

export function WidgetEditor({ cell, onClose }) {
  useStore(layout.store);
  const fileRef = useRef(null);
  const htmlRef = useRef(null);
  if (!cell) return null;

  const live = layout.get().pages.flatMap(p => p.cells).find(c => c.id === cell.id) || cell;
  const wg = getWidget(live.ref);
  const c = { ...(DEFAULTS[live.ref] || wg?.defaults || {}), ...(live.config || {}) };
  // 组件自己在 fields 里写了有哪些可调项的，照着生成（insWidgets.js 那一组）
  const fields = Array.isArray(wg?.fields) ? wg.fields : null;
  const set = patch => setCellConfig(cell.id, patch);

  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await images.put(file, PHOTO_MAX);
      if (c.cover) images.remove(c.cover);
      // at：照片放上去的那一天。拍立得右下角的日期取它
      set({ cover: id, at: Date.now() });
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  const pickHtml = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(html?|htm)$/i.test(file.name)) { toast('只接受 .html 文件', 'error'); return; }
    if (file.size > CUSTOM_MAX_BYTES) {
      toast(`文件太大，上限 ${kb(CUSTOM_MAX_BYTES)}`, 'error', 4000);
      return;
    }
    try {
      const id = await files.put(file, { name: file.name, type: 'text/html' });
      if (c.fileId) files.remove(c.fileId);
      set({ fileId: id, name: file.name });
    } catch (err) { toast('读取失败：' + (err.message || err), 'error'); }
  };

  const hasCover = live.ref === 'player' || live.ref === 'photo' || live.ref === 'love'
    || !!fields?.some(f => f.type === 'image' && f.key === 'cover');
  const lines = live.ref === 'player' ? 3 : live.ref === 'note' ? 2 : 1;
  const hasLines = live.ref === 'player' || live.ref === 'note' || live.ref === 'photo';
  const info = c.fileId ? files.info(c.fileId) : null;

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

      ${fields ? fields.filter(f => f.type !== 'image').map(f => html`
        <${Field} key=${f.key} label=${f.label} desc=${f.desc || ''}>
          ${f.type === 'text' ? html`
            <${Input} value=${c[f.key] || ''} placeholder=${f.placeholder || '留空则不显示'}
              onInput=${v => set({ [f.key]: v })}/>`
          : f.type === 'date' ? html`
            <div class="wg-edit-cover">
              <${Input} type="date" value=${c[f.key] || ''} onInput=${v => set({ [f.key]: v })}/>
              ${c[f.key] ? html`<${Button} size="sm" variant="ghost" onClick=${() => set({ [f.key]: '' })}>清空<//>` : null}
            </div>`
          : f.type === 'segmented' ? html`
            <${Segmented} value=${c[f.key] ?? ''} items=${f.items} onChange=${v => set({ [f.key]: v })}/>`
          : f.type === 'switch' ? html`
            <${Switch} checked=${c[f.key] !== false} onChange=${v => set({ [f.key]: v })}/>`
          : f.type === 'char' ? html`
            <div class="chip-row">
              <button class=${`chip${!c[f.key] ? ' is-active' : ''}`} onClick=${() => set({ [f.key]: '' })}>最近聊过的</button>
              ${characters.all().map(ch => html`
                <button key=${ch.id} class=${`chip${c[f.key] === ch.id ? ' is-active' : ''}`}
                  onClick=${() => set({ [f.key]: ch.id })}>${ch.name}</button>`)}
            </div>` : null}
        <//>`) : null}

      ${live.ref === 'health' ? html`
        <${Field} label="显示哪几项"
          desc="点一下加上，再点去掉。主界面是会被旁人一眼看见的地方，默认不含体重。">
          <div class="chip-row">
            ${HEALTH_STATS.map(x => html`
              <button key=${x.id}
                class=${`chip${(c.show || []).includes(x.id) ? ' is-active' : ''}`}
                onClick=${() => {
                  const cur = c.show || [];
                  set({ show: cur.includes(x.id) ? cur.filter(i => i !== x.id) : [...cur, x.id] });
                }}>${x.label}</button>`)}
          </div>
        <//>` : null}

      ${live.ref === 'player' ? html`
        <${Field} label="图片位置">
          <${Segmented} value=${c.align || 'left'} onChange=${v => set({ align: v })}
            items=${[{ value: 'left', label: '在左' }, { value: 'right', label: '在右' }]}/>
        <//>` : null}

      ${hasLines ? Array.from({ length: lines }, (_, i) => i + 1).map(n => html`
        <${Field} key=${n} label=${`第 ${n} 行`}>
          <${Input} value=${c[`line${n}`] || ''} placeholder="留空则不显示"
            onInput=${v => set({ [`line${n}`]: v })}/>
          <div class="pad-t">
            <${Segmented} value=${c[`size${n}`] || 'md'} items=${LINE_SIZES}
              onChange=${v => set({ [`size${n}`]: v })}/>
          </div>
        <//>`) : null}

      ${live.ref === 'love' ? html`
        <${Field} label="文字" desc="显示在头像右边">
          <${Input} value=${c.word ?? ''} placeholder="Love"
            onInput=${v => set({ word: v })}/>
        <//>

        <${Field} label="星期与月份">
          <${Segmented} value=${c.lang || 'en'} items=${LANGS}
            onChange=${v => set({ lang: v })}/>
        <//>

        <${Field} label="颜色"
          desc="默认跟随主题，深色模式下自动变白。指定颜色后固定不变。">
          <div class="wg-edit-color">
            <input type="color" value=${c.color || '#000000'}
              onInput=${e => set({ color: e.target.value })}/>
            <${Button} size="sm" variant="ghost"
              onClick=${() => set({ color: '' })}>恢复默认<//>
          </div>
        <//>` : null}

      ${live.ref === 'custom' ? html`
        <${Field} label="HTML 文件"
          desc=${`上限 ${kb(CUSTOM_MAX_BYTES)}，保存在本设备。组件运行在隔离环境中，`
            + '读不到本应用的数据，也无法访问已保存的接口密钥。'}>
          <div class="wg-edit-cover">
            <${Button} size="sm" variant="ghost" icon="upload"
              onClick=${() => htmlRef.current?.click()}>${c.fileId ? '更换文件' : '选择文件'}<//>
            ${c.fileId ? html`
              <${Button} size="sm" variant="ghost" icon="trash"
                onClick=${() => { files.remove(c.fileId); set({ fileId: null, name: '' }); }}>移除<//>` : null}
          </div>
          <input type="file" accept=".html,.htm,text/html" ref=${htmlRef}
            onChange=${pickHtml} style="display:none"/>
        <//>
        ${c.fileId ? html`
          <${List} inset=${false}>
            <${ListItem} title=${c.name || '自定义组件'}
              subtitle=${info ? kb(info.bytes) : ''}/>
          <//>` : null}` : null}

      <${List} inset=${false}>
        ${live.ref !== 'photo' && live.ref !== 'custom' && !fields ? html`
          <${ListItem} title="用衬线字体" multiline
            subtitle=${live.ref === 'love'
              ? '衬线槽位可在「设置 - 主题」里换成自己的字体，换成手写体后这里会跟着变'
              : '更像唱片封面上的排版'}
            right=${html`<${Switch} checked=${!!c.serif} onChange=${v => set({ serif: v })}/>`}/>` : null}
        <${ListItem} title="隐藏背景" multiline
          subtitle="去掉卡片底色与投影，组件直接显示在壁纸上。浅色壁纸上深色文字可能难以辨认。"
          right=${html`<${Switch} checked=${!!c.bare} onChange=${v => set({ bare: v })}/>`}/>
      <//>

      <div class="pad-t">
        <${Button} full onClick=${onClose}>完成<//>
      </div>
    <//>`;
}
