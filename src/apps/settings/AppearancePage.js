import { html, useRef, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Switch, Segmented,
         Button, Icon, Sheet, toast, confirm } from '../../ui/index.js';
import { PHOTO_MAX } from '../../system/db/images.js';
import { ICON_NAMES } from '../../icons/paths.js';

const { db, nav, apps: appsApi } = phone;

const PRESET_COLORS = ['#000000', '#1A1A1A', '#3D3D3D', '#6B6B6B',
                       '#9A9A9A', '#C4C4C4', '#FFFFFF'];

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
  const s = useStore(db.settings.store);
  if (!appId) return null;
  const app = appsApi.get(appId);
  const cur = (s.appIcons || {})[appId] || {};
  const icon = cur.icon || app?.icon;

  const set = patch => db.settings.set({
    appIcons: { ...(s.appIcons || {}), [appId]: { ...cur, ...patch } },
  });
  const reset = () => {
    const next = { ...(s.appIcons || {}) };
    delete next[appId];
    db.settings.replace({ ...s, appIcons: next });
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${app?.name || appId} height="80%">
      <${Field} label="名称">
        <${Input} value=${app?.name || ''} onInput=${v => set({ name: v })}/>
      <//>
      <${Field} label="图标"/>
      <div class="icon-grid">
        ${ICON_NAMES.map(n => html`
          <button key=${n} class=${`icon-pick${icon === n ? ' is-active' : ''}`}
            onClick=${() => set({ icon: n })} aria-label=${n}>
            <${Icon} name=${n} size=${22}/>
          </button>`)}
      </div>
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
    toast('已读入，记得点应用');
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
          subtitle="手机浏览器本身已有状态栏，再显示一条会是双份。自动模式在触摸设备上隐藏。"
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
          <${WallpaperRow} slot="home" label="主界面" desc="铺在图标和小组件下面"/>
          <${WallpaperRow} slot="lock" label="锁屏" desc="时钟与通知下面"/>
        </div>
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
        <${Field} label="图标颜色" desc="所有 SVG 的描边颜色">
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

      <${List} title="换图标">
        ${apps.map(a => {
          const cur = (s.appIcons || {})[a.id] || {};
          return html`
            <${ListItem} key=${a.id} title=${a.name}
              subtitle=${cur.icon ? '已自定义' : '默认'} arrow
              left=${html`<div class="app-tile app-tile-mini"><${Icon} name=${a.icon} size=${18}/></div>`}
              onClick=${() => setPicking(a.id)}/>`;
        })}
      <//>

      <${List} title="进阶">
        <${ListItem} title="自定义 CSS"
          subtitle=${s.customCSS ? '已应用，点这里继续编辑' : '粘贴或导入一份 CSS，覆盖默认外观'} arrow multiline
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
    <//>`;
}
