import { html, useRef, useState } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { ICON_NAMES } from '../icons/paths.js';
import { Sheet, prompt, toast } from './overlay.js';
import { Button, Field, Input } from './basic.js';

// 改一个 app 的图标与名称。
//
// 和 QrLogin 同一个写法：组件不认识 db，要用的几个动作由调用方传进来 ——
// 改它的地方有三处（设置 - 外观、主界面长按、文件夹里长按），
// 分属 app 层和 shell 层，不能互相 import（规约第 8 条）。
//
// service.override(appId)        当前的覆盖值 { name, icon, imageId }
// service.set(appId, patch)      改名字或换线条图标
// service.reset(appId)           恢复默认
// service.file(appId, File)      换成一张图片
// service.url(appId, string)     从链接换成一张图片
// service.clearImage(appId)      去掉图片，改回线条图标
export function IconPicker({ appId, app, preview, service, maxEdge = 256, onClose }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  if (!appId) return null;

  const cur = service.override(appId);
  const icon = cur.icon || app?.icon;

  const useFile = async file => {
    setBusy(true);
    try { await service.file(appId, file); toast('已更换为图片'); }
    catch (err) { toast('图片处理失败：' + (err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  const pickFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await useFile(file);
  };

  const fromUrl = async () => {
    const url = await prompt({ title: '图片链接', placeholder: 'https://...' });
    if (!url) return;
    setBusy(true);
    try { await service.url(appId, url); toast('已更换为图片'); }
    catch (err) {
      toast('获取失败：' + (err.message || err) + '。通常为跨域限制，可先保存到相册后再选择。',
        'error', 6000);
    } finally { setBusy(false); }
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${app?.name || appId} height="86%">
      <${Field} label="名称">
        <${Input} value=${app?.name || ''} onInput=${v => service.set(appId, { name: v })}/>
      <//>

      <${Field} label="更换为图片" desc=${`整图完整缩放至 ${maxEdge} x ${maxEdge}，保存在本地。`}>
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
                onClick=${() => service.clearImage(appId)}>改回图标<//>` : null}
          </div>
        </div>
        <input type="file" accept="image/*" ref=${fileRef} onChange=${pickFile} style="display:none"/>
      <//>

      ${cur.imageId ? html`
        <div class="field-desc">正在使用图片。点上方的「改回图标」可换回线条图标。</div>`
      : html`
        <${Field} label="或者挑一个图标"/>
        <div class="icon-grid">
          ${ICON_NAMES.map(n => html`
            <button key=${n} class=${`icon-pick${icon === n ? ' is-active' : ''}`}
              onClick=${() => service.set(appId, { icon: n })} aria-label=${n}>
              <${Icon} name=${n} size=${22}/>
            </button>`)}
        </div>`}

      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${() => { service.reset(appId); onClose(); }}>恢复默认<//>
        <${Button} onClick=${onClose}>完成<//>
      </div>
    <//>`;
}
