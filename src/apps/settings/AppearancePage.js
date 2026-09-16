import { html, useRef, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Switch, Segmented, Button, Icon,
         Sheet, toast, confirm } from '../../ui/index.js';
import { PHOTO_MAX } from '../../system/db/images.js';
import { ICON_NAMES } from '../../icons/paths.js';

const { db, nav, apps: appsApi } = phone;

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
  const tile = cur.tile || null;

  const set = patch => db.settings.set({
    appIcons: { ...(s.appIcons || {}), [appId]: { ...cur, ...patch } },
  });
  const reset = () => {
    const next = { ...(s.appIcons || {}) };
    delete next[appId];
    db.settings.replace({ ...s, appIcons: next });
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${app?.name || appId} height="78%">
      <${Field} label="底色">
        <div class="shade-row">
          ${appsApi.shades.map(t => html`
            <button key=${t} class=${`shade${tile === t ? ' is-active' : ''}`}
              style=${`background:var(--${t})`} onClick=${() => set({ tile: t })}
              aria-label=${t}></button>`)}
        </div>
      <//>

      <${Field} label="图标">
        <div class="icon-grid">
          ${ICON_NAMES.map(n => html`
            <button key=${n} class=${`icon-pick${icon === n ? ' is-active' : ''}`}
              onClick=${() => set({ icon: n })} aria-label=${n}>
              <${Icon} name=${n} size=${20}/>
            </button>`)}
        </div>
      <//>

      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${reset}>恢复默认<//>
        <${Button} onClick=${onClose}>完成<//>
      </div>
    <//>`;
}

export function AppearancePage() {
  const s = useStore(db.settings.store);
  const [picking, setPicking] = useState(null);
  useStore(appsApi.store);
  const apps = appsApi.list();

  return html`
    <${Page} title="外观" onBack=${nav.pop}>
      <${List} title="主题">
        <${ListItem} title="深色模式"
          left=${html`<${Icon} name=${s.theme === 'dark' ? 'moon' : 'sun'} size=${18}/>`}
          right=${html`<${Switch} checked=${s.theme === 'dark'}
            onChange=${v => db.settings.set({ theme: v ? 'dark' : 'light' })}/>`}/>
        <${ListItem} title="模拟状态栏" multiline
          subtitle="手机浏览器本身已有状态栏，再显示一条会是双份。自动模式在触摸设备上隐藏。"
          right=${html`<div style="width:150px"><${Segmented}
            value=${s.statusBar} onChange=${v => db.settings.set({ statusBar: v })}
            items=${[{ value: 'auto', label: '自动' }, { value: 'on', label: '显示' }, { value: 'off', label: '隐藏' }]}/></div>`}/>
        <${ListItem} title="启动时显示锁屏"
          left=${html`<${Icon} name="lock" size=${18}/>`}
          right=${html`<${Switch} checked=${s.showLockScreen}
            onChange=${v => db.settings.set({ showLockScreen: v })}/>`}/>
      <//>

      <div class="list-wrap">
        <div class="list-title">壁纸</div>
        <div class="list list-inset">
          <${WallpaperRow} slot="home" label="主界面" desc="铺在图标和挂件下面"/>
          <${WallpaperRow} slot="lock" label="锁屏" desc="时钟与通知下面"/>
        </div>
      </div>

      <${List} title="应用图标">
        ${apps.map(a => {
          const cur = (s.appIcons || {})[a.id] || {};
          const icon = cur.icon || a.icon;
          const accent = cur.tile ? `var(--${cur.tile})` : a.accent;
          return html`
            <${ListItem} key=${a.id} title=${a.name}
              subtitle=${cur.icon || cur.tile ? '已自定义' : '默认'} arrow
              left=${html`<div class="icon-chip" style=${`background:${accent}`}>
                <${Icon} name=${icon} size=${17} style="color:var(--on-tile)"/>
              </div>`}
              onClick=${() => setPicking(a.id)}/>`;
        })}
      <//>

      <div class="pad-x pad-b">
        <div class="hint-box">
          顶部那条横幅的封面与文字，在主界面上直接点它就能改。
        </div>
      </div>

      <${IconPicker} appId=${picking} onClose=${() => setPicking(null)}/>
    <//>`;
}
