import { html, useRef, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Switch, Segmented, Slider,
         Button, Icon, Sheet, IconPicker, toast, confirm, prompt } from '../../ui/index.js';
import { PHOTO_MAX, ICON_MAX } from '../../system/db/images.js';
import { BatchIcons } from './BatchIcons.js';
import { LookPresets } from './LookPresets.js';
import { FontPicker } from './FontPicker.js';

const { db, nav, apps: appsApi, look } = phone;

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

// 图标与名称的界面在 ui/IconPicker，动作在 system/look。
// 主界面长按图标、文件夹里长按图标用的是同一套。
function IconSheet({ appId, onClose }) {
  useStore(db.settings.store);
  const preview = useImage(appId ? appsApi.icon.override(appId).imageId : null);
  if (!appId) return null;
  return html`<${IconPicker} appId=${appId} app=${appsApi.get(appId)} preview=${preview}
    service=${appsApi.icon} maxEdge=${ICON_MAX} onClose=${onClose}/>`;
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
  useStore(db.layout.store);
  const apps = appsApi.list();
  const gone = appsApi.removed();

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
        <${ListItem} title="全屏显示" multiline
          subtitle=${'开启时界面铺满整块屏幕。关闭后，手机上内容从系统状态栏下方开始，'
            + '安卓浏览器不再自动进入全屏，安卓安装包显示系统状态栏；电脑与平板上以手机宽度居中显示。'
            + '安卓「添加到主屏幕」的版本由系统在添加时决定，不受此开关影响。'}
          right=${html`<${Switch} checked=${phone.fullscreen.wantFull()}
            onChange=${v => phone.fullscreen.setFull(v)}/>`}/>
        <${ListItem} title="返回方式" multiline
          subtitle=${s.navStyle === 'back'
            ? '左上角一个返回键。点一下退回上一级，双击回到主界面，长按打开多任务。主界面上不显示。'
              + '没有导航栏的页面（全屏读书、全屏看片）同样有它。底部横条已隐藏。'
            : '底部一条横条。点一下回到主界面，双击打开多任务，返回上一级用页面左上角的箭头。'}
          right=${html`<div style="width:150px"><${Segmented}
            value=${s.navStyle === 'back' ? 'back' : 'bar'}
            onChange=${v => db.settings.set({ navStyle: v })}
            items=${[{ value: 'bar', label: '底部横条' }, { value: 'back', label: '返回键' }]}/></div>`}/>
        <${ListItem} title="启动时显示锁屏"
          left=${html`<${Icon} name="lock" size=${19}/>`}
          right=${html`<${Switch} checked=${s.showLockScreen}
            onChange=${v => db.settings.set({ showLockScreen: v })}/>`}/>
        <${ListItem} title="锁屏密码" arrow multiline
          subtitle=${phone.pinlock.hasPin()
    ? `已设置 ${phone.pinlock.pinLength()} 位密码，每次打开应用时需要输入`
    : '未设置。设置后每次打开应用时需要输入'}
          left=${html`<${Icon} name="lock" size=${19}/>`}
          onClick=${() => nav.push('/lockpin')}/>
      <//>
      ${phone.fullscreen.wantFull() ? null : html`
        <div class="pad-x pad-t">
          <${Field} label="窗口宽度"
            desc="全屏显示关闭时，屏幕中间那一块的宽度。超出屏幕时按屏幕宽度显示。「不改」为默认：手机上铺满，电脑与平板上 430 像素。">
            <${Slider} value=${s.winW ?? ''} min=${280} max=${1200} step=${10} unit="px" fallback=${430}
              onChange=${v => phone.fullscreen.setWindowSize({ w: v })}/>
          <//>
          <${Field} label="窗口高度"
            desc="超出屏幕时按屏幕高度显示。「不改」为默认：铺满屏幕高度。">
            <${Slider} value=${s.winH ?? ''} min=${400} max=${1600} step=${10} unit="px" fallback=${844}
              onChange=${v => phone.fullscreen.setWindowSize({ h: v })}/>
          <//>
        </div>`}

      <div class="list-wrap">
        <div class="list-title">壁纸</div>
        <div class="list list-inset">
          <${WallpaperRow} slot="home" label="主界面" desc="位于图标与小组件下层"/>
          <${WallpaperRow} slot="lock" label="锁屏" desc="位于时钟与通知下层"/>
        </div>
      </div>

      <${FontPicker}/>

      <${List} title="字号">
        <div class="pad">
          <${Field} label=${`整体字号　${Math.round(look.fontScaleOf(s.fontScale) * 100)}%`}
            desc="按比例改变全部界面文字的大小。100% 为默认；气泡、小组件、线下页面一并变化。">
            <input type="range" min=${Math.round(look.FONT_SCALE_MIN * 100)} max=${Math.round(look.FONT_SCALE_MAX * 100)} step="5"
              value=${Math.round(look.fontScaleOf(s.fontScale) * 100)}
              onInput=${e => db.settings.set({ fontScale: parseInt(e.target.value, 10) / 100 })}/>
          <//>
          ${look.fontScaleOf(s.fontScale) !== 1 ? html`<${Button} full variant="ghost" onClick=${() => db.settings.set({ fontScale: 1 })}>恢复默认字号<//>` : null}
        </div>
      <//>

      <${LookPresets}/>

      <${List} title="底部边距">
        <${ListItem} title="底部整体上移" multiline
          subtitle=${`当前 ${s.bottomLift || 0}px。底部内容被浏览器地址栏遮挡时上调此值。`
    + `填负数则向下移，可用于遮挡不存在时收回多余的留白。`
    + `以 PWA 方式添加到主屏幕后通常无需调整。`}/>
      <//>
      <div class="pad-x">
        <${Field} label=${`${s.bottomLift || 0} px`}>
          <${Slider} value=${s.bottomLift || 0} min=${-40} max=${80} step=${2} unit="px"
            onChange=${v => db.settings.set({ bottomLift: Number(v) || 0 })}/>
        <//>
      </div>

      <${List} title="图标">
        <${ListItem} title="图标阴影"
          right=${html`<${Switch} checked=${s.iconShadow !== false}
            onChange=${v => db.settings.set({ iconShadow: v })}/>`}/>
        <${ListItem} title="显示图标名称"
          right=${html`<${Switch} checked=${s.iconLabels !== false}
            onChange=${v => db.settings.set({ iconLabels: v })}/>`}/>
        <${ListItem} title="毛玻璃" multiline
          subtitle="图标底板、小组件、底栏与横幅对其下方的壁纸做模糊。此效果持续占用图形处理器，设备容易发热、耗电更快。关闭后改用更不透明的底色。"
          right=${html`<${Switch} checked=${s.glass === true}
            onChange=${v => db.settings.set({ glass: v })}/>`}/>
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
        <${Field} label="图标名称颜色"
          desc="主界面与底栏图标下方文字的颜色。选择「自动」时，有壁纸为白色带投影，无壁纸跟随主题。">
          <div class="color-row">
            <button class=${`chip${s.iconLabelColor ? '' : ' is-active'}`}
              onClick=${() => db.settings.set({ iconLabelColor: '' })}>自动</button>
            ${PRESET_COLORS.map(c => html`
              <button key=${c} class=${`swatch${(s.iconLabelColor || '').toLowerCase() === c.toLowerCase() ? ' is-active' : ''}`}
                style=${`background:${c}`} onClick=${() => db.settings.set({ iconLabelColor: c })}
                aria-label=${`名称颜色 ${c}`}></button>`)}
            <label class="swatch swatch-custom">
              <${Icon} name="plus" size=${16}/>
              <input type="color" value=${s.iconLabelColor || '#ffffff'} aria-label="自定义名称颜色"
                onInput=${e => db.settings.set({ iconLabelColor: e.target.value })}/>
            </label>
          </div>
        <//>
      </div>

      <${List} title="应用图标">
        <${ListItem} title="批量更换" multiline
          subtitle="先勾选若干应用，再一次选择多张图片，按勾选顺序依次对应。" arrow
          left=${html`<${Icon} name="grid" size=${19}/>`}
          onClick=${() => setBatchOpen(true)}/>
        ${apps.some(a => (s.appIcons || {})[a.id]?.imageId) ? html`
          <${ListItem} title="去掉所有图片四周的透明边" multiline
            subtitle="新上传的图片会自动裁掉透明边。早先上传、图标四周空出一大块的，可在此一次处理。单个图标的大小在点开该图标后调节。"
            left=${html`<${Icon} name="crop" size=${19}/>`}
            onClick=${async () => {
              let n = 0;
              for (const a of apps) {
                if (!(db.settings.get().appIcons || {})[a.id]?.imageId) continue;
                try { if (await appsApi.icon.trim(a.id)) n++; } catch { /* 读不到的那张跳过 */ }
              }
              toast(n ? `已处理 ${n} 个图标` : '没有需要处理的图标');
            }}/>` : null}
        ${apps.map(a => {
          const cur = (s.appIcons || {})[a.id] || {};
          return html`
            <${ListItem} key=${a.id} title=${a.name}
              subtitle=${cur.imageId ? '已使用图片' : cur.icon ? '已更换图标' : '默认'} arrow
              left=${html`<div class="app-tile app-tile-mini"><${Icon} name=${a.icon} size=${18}/></div>`}
              onClick=${() => setPicking(a.id)}/>`;
        })}
      <//>

      ${gone.length ? html`
        <${List} title="已从主界面移除">
          ${gone.map(id => {
            const a = appsApi.get(id);
            return a ? html`
              <${ListItem} key=${id} title=${a.name} subtitle="点击放回主界面" arrow multiline
                left=${html`<div class="app-tile app-tile-mini"><${Icon} name=${a.icon} size=${18}/></div>`}
                onClick=${() => { appsApi.restore(id); toast(`已将${a.name}放回主界面`, 'ok'); }}/>` : null;
          })}
        <//>` : null}

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

      <${IconSheet} appId=${picking} onClose=${() => setPicking(null)}/>
      <${CSSEditor} open=${cssOpen} onClose=${() => setCssOpen(false)}/>
      <${BatchIcons} open=${batchOpen} onClose=${() => setBatchOpen(false)}/>
    <//>`;
}
