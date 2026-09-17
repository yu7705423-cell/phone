import { html, useRef, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Switch, Segmented,
         Button, Icon, Sheet, toast, confirm, prompt } from '../../ui/index.js';
import { PHOTO_MAX, ICON_MAX } from '../../system/db/images.js';
import { ICON_NAMES } from '../../icons/paths.js';
import { BatchIcons } from './BatchIcons.js';
import { LookPresets } from './LookPresets.js';
import { FontPicker } from './FontPicker.js';

const { db, nav, apps: appsApi } = phone;

const PRESET_COLORS = ['#000000', '#1A1A1A', '#3D3D3D', '#6B6B6B',
                       '#9A9A9A', '#C4C4C4', '#FFFFFF'];

function MiniTile({ app }) {
  const url = useImage(app.imageId);
  return html`
    <div class=${`app-tile app-tile-mini${url ? ' has-image' : ''}`}
      style=${url ? `background-image:url(${url})` : ''}>
      ${url ? null : html`<${Icon} name=${app.icon} size=${18}/>`}
    </div>`;
}

function WallpaperRow({ slot, label, desc }) {
  const lay = useStore(db.layout.store);
  const id = lay.wallpaper?.[slot] || null;
  const url = useImage(id);
  const fileRef = useRef(null);

  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const newId = await db.images.put(file, PHOTO_MAX);
      if (id) db.images.remove(id);
      db.layout.set({ wallpaper: { ...(lay.wallpaper || {}), [slot]: newId } });
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  const clear = () => {
    if (id) db.images.remove(id);
    db.layout.set({ wallpaper: { ...(lay.wallpaper || {}), [slot]: null } });
  };

  return html`
    <div class="wp-row">
      <div class="wp-preview" style=${url ? `background-image:url(${url})` : ''}>
        ${url ? null : html`<${Icon} name="image" size=${18}/>`}
      </div>
      <div class="wp-body">
        <div class="li-title">${label}</div>
        <div class="li-sub">${desc}</div>
        <div class="wp-acts">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => fileRef.current?.click()}>${id ? '更换' : '选择'}<//>
          ${id ? html`<${Button} size="sm" variant="ghost" onClick=${clear}>清除<//>` : null}
        </div>
      </div>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${pick} style="display:none"/>
    </div>`;
}

function IconPicker({ appId, onClose }) {
  // 所有 hook 都要在任何提前返回之前调用，否则关闭和打开时 hook 数量不一致，
  // 顺序一错预览就不跟着刷新了
  const st = useStore(db.settings.store);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const cur = (st.appIcons || {})[appId] || {};
  const preview = useImage(cur.imageId);

  if (!appId) return null;

  const app = appsApi.get(appId);
  const icon = cur.icon || app?.icon;

  const set = patch => db.settings.set({
    appIcons: { ...(st.appIcons || {}), [appId]: { ...cur, ...patch } },
  });

  const reset = () => {
    if (cur.imageId) db.images.remove(cur.imageId);
    const next = { ...(st.appIcons || {}) };
    delete next[appId];
    db.settings.replace({ ...st, appIcons: next });
  };

  const useImageFile = async file => {
    setBusy(true);
    try {
      const id = await db.images.putIcon(file, ICON_MAX);
      if (cur.imageId) db.images.remove(cur.imageId);
      set({ imageId: id });
      toast('已更换为图片');
    } catch (err) { toast('图片处理失败：' + err.message, 'error', 4000); }
    finally { setBusy(false); }
  };

  const pickFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await useImageFile(file);
  };

  // 链接同样落到本地，不做远程引用
  const fromUrl = async () => {
    const url = await prompt({ title: '图片链接', placeholder: 'https://...' });
    if (!url) return;
    setBusy(true);
    try {
      const res = await fetch(url.trim());
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (!/^image\//.test(blob.type)) throw new Error('这个链接不是图片');
      await useImageFile(new File([blob], 'icon', { type: blob.type }));
    } catch (err) {
      toast('获取失败：' + err.message + '。通常为跨域限制，可先保存到相册后再选择。', 'error', 6000);
      setBusy(false);
    }
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${app?.name || appId} height="86%">
      <${Field} label="名称">
        <${Input} value=${app?.name || ''} onInput=${v => set({ name: v })}/>
      <//>

      <${Field} label="更换为图片" desc=${`整图完整缩放至 ${ICON_MAX} x ${ICON_MAX}，保存在本地。`}>
        <div class="icon-upload">
          <div class=${`app-tile app-tile-preview${preview ? ' has-image' : ''}`}
            style=${preview ? `background-image:url(${preview})` : ''}>
            ${preview ? null : html`<${Icon} name=${icon} size=${24}/>`}
          </div>
          <div class="icon-upload-acts">
            <${Button} size="sm" variant="ghost" icon="upload" disabled=${busy}
              onClick=${() => fileRef.current?.click()}>选择图片<//>
            <${Button} size="sm" variant="ghost" icon="layers" disabled=${busy}
              onClick=${fromUrl}>使用链接<//>
            ${cur.imageId ? html`
              <${Button} size="sm" variant="ghost" icon="close"
                onClick=${() => { db.images.remove(cur.imageId); set({ imageId: null }); }}>恢复为图标<//>` : null}
          </div>
        </div>
        <input type="file" accept="image/*" ref=${fileRef} onChange=${pickFile} style="display:none"/>
      <//>

      ${cur.imageId ? html`
        <div class="field-desc">正在用图片。想换回线条图标，点上面的「改回图标」。</div>`
      : html`
        <${Field} label="或者挑一个图标"/>
        <div class="icon-grid">
          ${ICON_NAMES.map(n => html`
            <button key=${n} class=${`icon-pick${icon === n ? ' is-active' : ''}`}
              onClick=${() => set({ icon: n })} aria-label=${n}>
              <${Icon} name=${n} size=${22}/>
            </button>`)}
        </div>`}

      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${reset}>恢复默认<//>
        <${Button} onClick=${onClose}>完成<//>
      </div>
    <//>`;
}

function CSSEditor({ open, onClose }) {
  const s = useStore(db.settings.store);
  const [draft, setDraft] = useState(s.customCSS || '');
  const fileRef = useRef(null);
  if (!open) return null;

  const load = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    setDraft(text);
    toast('已读取，请点击应用生效');
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="自定义 CSS" height="86%">
      <div class="hint-box">
        写进来的样式会覆盖默认外观，立刻生效。改坏了点「清空」就能恢复。
        常用的类名：<span class="mono">.wg</span> 小组件，
        <span class="mono">.wg-player</span> 播放器横条，
        <span class="mono">.pl-cover</span> 封面，
        <span class="mono">.pl-line</span> 文字行，
        <span class="mono">.app-tile</span> 应用图标，
        <span class="mono">.dock</span> 底部栏，
        <span class="mono">.home-grid</span> 主界面网格。
      </div>

      <${Textarea} rows=${14} value=${draft} onInput=${setDraft}
        placeholder=${'.wg-player {\n  background: #000;\n  color: #fff;\n}'}/>

      <div class="sheet-acts">
        <${Button} variant="ghost" icon="upload"
          onClick=${() => fileRef.current?.click()}>导入文件<//>
        <${Button} variant="ghost" onClick=${async () => {
          if (!await confirm({ title: '清空自定义 CSS', danger: true })) return;
          setDraft('');
          db.settings.set({ customCSS: '' });
          toast('已清空');
        }}>清空<//>
        <${Button} onClick=${() => { db.settings.set({ customCSS: draft }); toast('已应用'); onClose(); }}>应用<//>
      </div>
      <input type="file" accept=".css,text/css" ref=${fileRef} onChange=${load} style="display:none"/>
    <//>`;
}

export function AppearancePage() {
  const s = useStore(db.settings.store);
  const [picking, setPicking] = useState(null);
  const [cssOpen, setCssOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  useStore(appsApi.store);
  const apps = appsApi.list();

  return html`
    <${Page} title="主题" onBack=${nav.pop}>
      <${List} title="外观">
        <${ListItem} title="深色模式"
          left=${html`<${Icon} name=${s.theme === 'dark' ? 'moon' : 'sun'} size=${19}/>`}
          right=${html`<${Switch} checked=${s.theme === 'dark'}
            onChange=${v => db.settings.set({ theme: v ? 'dark' : 'light' })}/>`}/>
        <${ListItem} title="模拟状态栏" multiline
          subtitle="移动端浏览器自带状态栏，重复显示会出现两条。自动模式在触摸设备上隐藏。"
          right=${html`<div style="width:150px"><${Segmented}
            value=${s.statusBar} onChange=${v => db.settings.set({ statusBar: v })}
            items=${[{ value: 'auto', label: '自动' }, { value: 'on', label: '显示' }, { value: 'off', label: '隐藏' }]}/></div>`}/>
        <${ListItem} title="启动时显示锁屏"
          left=${html`<${Icon} name="lock" size=${19}/>`}
          right=${html`<${Switch} checked=${s.showLockScreen}
            onChange=${v => db.settings.set({ showLockScreen: v })}/>`}/>
      <//>

      <div class="list-wrap">
        <div class="list-title">壁纸</div>
        <div class="list list-inset">
          <${WallpaperRow} slot="home" label="主界面" desc="位于图标与小组件下层"/>
          <${WallpaperRow} slot="lock" label="锁屏" desc="位于时钟与通知下层"/>
        </div>
      </div>

      <${FontPicker}/>

      <${LookPresets}/>

      <${List} title="底部边距">
        <${ListItem} title="底部整体上移" multiline
          subtitle=${`当前 ${s.bottomLift || 0}px。底部内容被浏览器地址栏遮挡时上调此值。以 PWA 方式添加到主屏幕后通常无需调整。`}/>
      <//>
      <div class="pad-x">
        <${Field} label=${`${s.bottomLift || 0} px`}>
          <input type="range" min="0" max="80" step="2" value=${s.bottomLift || 0}
            onInput=${e => db.settings.set({ bottomLift: parseInt(e.target.value, 10) || 0 })}/>
        <//>
      </div>

      <${List} title="图标">
        <${ListItem} title="图标阴影"
          right=${html`<${Switch} checked=${s.iconShadow !== false}
            onChange=${v => db.settings.set({ iconShadow: v })}/>`}/>
        <${ListItem} title="显示图标名称"
          right=${html`<${Switch} checked=${s.iconLabels !== false}
            onChange=${v => db.settings.set({ iconLabels: v })}/>`}/>
      <//>

      <div class="pad-x">
        <${Field} label="图标颜色" desc="所有 SVG 图标的描边颜色。">
          <div class="color-row">
            ${PRESET_COLORS.map(c => html`
              <button key=${c} class=${`swatch${(s.iconColor || '#000000').toLowerCase() === c.toLowerCase() ? ' is-active' : ''}`}
                style=${`background:${c}`} onClick=${() => db.settings.set({ iconColor: c })}
                aria-label=${c}></button>`)}
            <label class="swatch swatch-custom">
              <${Icon} name="plus" size=${16}/>
              <input type="color" value=${s.iconColor || '#000000'}
                onInput=${e => db.settings.set({ iconColor: e.target.value })}/>
            </label>
          </div>
        <//>
      </div>

      <${List} title="应用图标">
        <${ListItem} title="批量更换" multiline
          subtitle="先勾选若干应用，再一次选择多张图片，按勾选顺序依次对应。" arrow
          left=${html`<${Icon} name="grid" size=${19}/>`}
          onClick=${() => setBatchOpen(true)}/>
        ${apps.map(a => {
          const cur = (s.appIcons || {})[a.id] || {};
          return html`
            <${ListItem} key=${a.id} title=${a.name}
              subtitle=${cur.imageId ? '已使用图片' : cur.icon ? '已更换图标' : '默认'} arrow
              left=${html`<div class="app-tile app-tile-mini"><${Icon} name=${a.icon} size=${18}/></div>`}
              onClick=${() => setPicking(a.id)}/>`;
        })}
      <//>

      <${List} title="高级">
        <${ListItem} title="自定义 CSS"
          subtitle=${s.customCSS ? '已应用，点击继续编辑' : '粘贴或导入 CSS，覆盖默认外观'} arrow multiline
          left=${html`<${Icon} name="layers" size=${19}/>`}
          onClick=${() => setCssOpen(true)}/>
      <//>

      <div class="pad-x pad-b">
        <div class="hint-box">
          主界面上长按进入整理，点任意位置就能放小组件、换应用或移除。
          放好之后点小组件本身可以改它的图和文字。
        </div>
      </div>

      <${IconPicker} appId=${picking} onClose=${() => setPicking(null)}/>
      <${CSSEditor} open=${cssOpen} onClose=${() => setCssOpen(false)}/>
      <${BatchIcons} open=${batchOpen} onClose=${() => setBatchOpen(false)}/>
    <//>`;
}
