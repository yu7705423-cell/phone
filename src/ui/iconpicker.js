import { html, useRef, useState } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { ICON_NAMES } from '../icons/paths.js';
import { Sheet, prompt, toast } from './overlay.js';
import { Button, Field, Input, Slider, Switch } from './basic.js';

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
// service.trim(appId)            可选。已存的那张裁掉四周的透明边
// service.scale(appId, pct)      可选。图片在格子里占多大；scaleRange 给上下限
// service.bare                   可选，true 时给「显示底板」开关（存在 override 的 bare 上）
// service.autoTrim() / setAutoTrim(on)  可选。上传时裁不裁透明边（全局一项）
export function IconPicker({ appId, app, preview, service, maxEdge = 256, onClose }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  if (!appId) return null;

  const cur = service.override(appId);
  const icon = cur.icon || app?.icon;
  const range = service.scaleRange || { min: 50, max: 160, def: 100 };
  const scale = cur.scale || range.def;

  const trim = async () => {
    setBusy(true);
    try { toast(await service.trim(appId) ? '已去掉四周的透明边' : '这张图四周没有透明边'); }
    catch (err) { toast('处理失败：' + (err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

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

      <${Field} label="更换为图片"
        desc=${service.autoTrim && !service.autoTrim()
          ? `整图完整缩放至 ${maxEdge} x ${maxEdge}，四周的透明区域原样保留，保存在本地。`
          : `四周的透明边自动裁掉，其余部分完整缩放至 ${maxEdge} x ${maxEdge}，保存在本地。`}>
        <div class="icon-upload">
          <div class=${`app-tile app-tile-preview${preview ? ' has-image' : ''}${preview && cur.bare ? ' is-bare' : ''}`}
            style=${preview ? `--tile-img:url(${preview});--tile-img-size:${scale}%` : ''}>
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
      ${service.autoTrim ? html`
        <div class="icon-switch">
          <div class="icon-switch-text">
            <div>上传时裁掉四周的透明边</div>
            <div class="field-desc">对所有图标生效。关闭后，图片连同四周的透明区域原样放入，适合本身带留白的图标。已上传的图片不受影响。</div>
          </div>
          <${Switch} checked=${service.autoTrim()} onChange=${v => service.setAutoTrim(v)}/>
        </div>` : null}

      ${cur.imageId ? html`
        ${service.bare ? html`
          <div class="icon-switch">
            <div class="icon-switch-text">
              <div>显示底板</div>
              <div class="field-desc">图片后面那块圆角底板。异形图标关闭此项，只显示图片本身，不画底板、描边与阴影，也不切圆角。</div>
            </div>
            <${Switch} checked=${!cur.bare} onChange=${v => service.set(appId, { bare: !v })}/>
          </div>` : null}
        ${service.scale ? html`
          <${Field} label=${`图片大小　${scale}%`}
            desc="图片在图标格子里占的比例。100% 为铺满格子，调大时超出格子的部分被裁掉。">
            <${Slider} value=${scale} min=${range.min} max=${range.max} step=${5} unit="%"
              onChange=${v => service.scale(appId, v === '' ? range.def : v)}/>
          <//>` : null}
        ${service.trim ? html`
          <div class="btn-row pad-t">
            <${Button} size="sm" variant="ghost" icon="crop" disabled=${busy} onClick=${trim}>去掉四周的透明边<//>
          </div>
          <div class="field-desc">早先上传、四周留有大片透明区域的图片，可用此项裁掉，不必重新上传。</div>` : null}
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
