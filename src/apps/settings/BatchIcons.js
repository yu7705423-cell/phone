import { html, useState, useRef } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Sheet, Button, Icon, Field, toast } from '../../ui/index.js';
import { ICON_MAX } from '../../system/db/images.js';

const { db, apps: appsApi } = phone;

function Row({ app, index, onToggle }) {
  const url = useImage(app.imageId);
  return html`
    <button class=${`batch-row press${index >= 0 ? ' is-on' : ''}`} onClick=${onToggle}>
      <span class="batch-num">${index >= 0 ? index + 1 : ''}</span>
      <div class=${`app-tile app-tile-mini${url ? ' has-image' : ''}`}
        style=${url ? `background-image:url(${url})` : ''}>
        ${url ? null : html`<${Icon} name=${app.icon} size=${18}/>`}
      </div>
      <span class="batch-name ellipsis">${app.name}</span>
      ${index >= 0 ? html`<${Icon} name="check" size=${16}/>` : null}
    </button>`;
}

// 勾一批应用，再选一批图，按勾选顺序一一对应
export function BatchIcons({ open, onClose }) {
  const st = useStore(db.settings.store);
  useStore(appsApi.store);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  if (!open) return null;

  const apps = appsApi.list();

  const toggle = id => setPicked(p =>
    p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const apply = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    if (!picked.length) { toast('请先勾选需要更换的应用'); return; }

    setBusy(true);
    const n = Math.min(picked.length, files.length);
    try {
      const next = { ...(st.appIcons || {}) };
      for (let i = 0; i < n; i++) {
        const appId = picked[i];
        const old = next[appId]?.imageId;
        const imageId = await db.images.putIcon(files[i], ICON_MAX);
        if (old) db.images.remove(old);
        next[appId] = { ...(next[appId] || {}), imageId };
      }
      db.settings.set({ appIcons: next });
      const extra = picked.length > files.length
        ? `，还有 ${picked.length - files.length} 个没图可用`
        : files.length > picked.length
          ? `，多出的 ${files.length - picked.length} 张没用上`
          : '';
      toast(`已更换 ${n} 个${extra}`, extra ? 'plain' : 'ok', 4000);
      setPicked([]);
    } catch (err) {
      toast('处理失败：' + err.message, 'error', 4000);
    } finally { setBusy(false); }
  };

  return html`
    <${Sheet} open=${true} onClose=${busy ? () => {} : onClose} title="批量换图标" height="86%">
      <div class="hint-box">
        先按想要的顺序勾选应用，再一次选多张图，第 1 张给第 1 个勾的，依此类推。
        数量不一致时按少的那边算，会告诉你剩下多少。
      </div>

      <${Field} label=${`已勾选 ${picked.length} 个`}>
        <div class="batch-acts">
          <${Button} size="sm" variant="ghost" disabled=${!picked.length}
            onClick=${() => setPicked([])}>取消全选<//>
          <${Button} size="sm" variant="ghost"
            onClick=${() => setPicked(apps.map(a => a.id))}>全选<//>
        </div>
      <//>

      <div class="batch-list">
        ${apps.map(a => html`
          <${Row} key=${a.id} app=${a} index=${picked.indexOf(a.id)}
            onToggle=${() => toggle(a.id)}/>`)}
      </div>

      <div class="sheet-acts">
        <${Button} variant="ghost" disabled=${busy} onClick=${onClose}>关闭<//>
        <${Button} disabled=${busy || !picked.length}
          onClick=${() => fileRef.current?.click()}>
          ${busy ? '处理中' : `选 ${picked.length} 张图`}<//>
      </div>
      <input type="file" accept="image/*" multiple ref=${fileRef}
        onChange=${apply} style="display:none"/>
    <//>`;
}
