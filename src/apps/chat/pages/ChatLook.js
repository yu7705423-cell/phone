import { html, useRef, useState } from '../../../lib.js';
import { phone, useStore, useImage, useThumb } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Switch, Segmented, Slider, Button, Icon,
         toast, confirm } from '../../../ui/index.js';

const { db, album, chatLook: look } = phone;

// 聊天背景与上下栏。数据与规则在 system/chatlook.js，这里只是那几个旋钮。
//
// 面板只占下半屏、遮罩不压暗：会话就在上面，每拧一下都看得见结果，
// 不必关掉再打开来回对照。

function AlbumPick({ onPick }) {
  useStore(db.photos.store);
  const list = album.allPhotos().filter(p => p.imageId);
  if (!list.length) return html`<div class="settings-foot">相册中暂无图片。</div>`;
  return html`
    <div class="photo-grid">
      ${list.map(p => html`<${Cell} key=${p.id} photo=${p} onPick=${onPick}/>`)}
    </div>`;
}
function Cell({ photo, onPick }) {
  const url = useThumb(photo.imageId);
  if (!url) return null;
  return html`
    <button class="photo-cell press" onClick=${() => onPick(photo.imageId)}>
      <div class="photo-tile" style=${`background-image:url(${url})`}></div>
    </button>`;
}

function Colors({ value, onChange }) {
  const custom = value && !look.COLORS.includes(value);
  return html`
    <div class="look-colors">
      ${look.COLORS.map(c => html`
        <button key=${c || 'theme'} aria-label=${c || '跟随主题'}
          class=${`look-color press${c ? '' : ' is-theme'}${value === c ? ' is-on' : ''}`}
          style=${c ? `--c:${c}` : ''} onClick=${() => onChange(c)}></button>`)}
      <label class=${`look-color press${custom ? ' is-on' : ''}`} aria-label="自选颜色"
        style=${custom ? `--c:${value}` : ''}>
        ${custom ? null : html`<${Icon} name="plus" size=${14}/>`}
        <input type="color" value=${custom ? value : '#888888'}
          onInput=${e => onChange(e.target.value)}/>
      </label>
    </div>`;
}

function Bar({ title, bar, onChange }) {
  return html`
    <${List} title=${title}>
      <${ListItem} title="样式"
        right=${html`<div style="width:190px"><${Segmented} value=${bar.style}
          onChange=${v => onChange({ style: v })}
          items=${look.STYLES.map(s => ({ value: s.id, label: s.label }))}/></div>`}/>
      <div class="list-sub-title">颜色</div>
      <${Colors} value=${bar.color} onChange=${v => onChange({ color: v })}/>
      ${bar.style === 'solid' ? null : html`
        <${ListItem} title="透明度" multiline
          right=${html`<div style="width:170px"><${Slider} value=${100 - bar.alpha} min=${0} max=${100}
            unit="%" onChange=${v => onChange({ alpha: 100 - (v === '' ? 30 : v) })}/></div>`}/>`}
      ${bar.style === 'glass' ? html`
        <${ListItem} title="模糊程度"
          right=${html`<div style="width:170px"><${Slider} value=${bar.blur} min=${0} max=${40}
            unit="px" onChange=${v => onChange({ blur: v === '' ? 20 : v })}/></div>`}/>` : null}
      <${ListItem} title="文字颜色"
        right=${html`<div style="width:190px"><${Segmented} value=${bar.fg}
          onChange=${v => onChange({ fg: v })}
          items=${look.FGS.map(f => ({ value: f.id, label: f.label }))}/></div>`}/>
    <//>`;
}

export function ChatLookSheet({ chatId, onClose }) {
  useStore(db.chats.store);
  const chat = db.chats.get(chatId);
  const l = look.lookOf(chat);
  const bgUrl = useImage(l.bg || null);
  const fileRef = useRef(null);
  const [picking, setPicking] = useState(false);
  if (!chat) return null;

  const pickFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await look.setBgFile(chatId, file); } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };
  const toAll = async () => {
    if (!await confirm({ title: '应用到全部会话',
      message: '其余全部会话（含群聊）的聊天背景与上下栏样式将替换为当前这一套。',
      okText: '应用' })) return;
    const n = look.applyToAll(chatId);
    toast(`已应用到 ${n} 段会话`, 'ok');
  };
  const reset = async () => {
    if (!await confirm({ title: '恢复默认', message: '清除这段会话的背景图，上下栏恢复为应用默认样式。',
      okText: '恢复', danger: true })) return;
    look.reset(chatId);
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="聊天背景" height="60%" cls="is-preview">
      <div class="list-wrap">
        <div class="list-title">背景</div>
        <div class="list list-inset">
          <div class="look-bg">
            <div class="look-bg-thumb" style=${bgUrl ? `--thumb:url(${bgUrl})` : ''}>
              ${bgUrl ? null : html`<${Icon} name="image" size=${18}/>`}
            </div>
            <div class="look-bg-acts">
              <${Button} size="sm" variant="ghost" icon="upload"
                onClick=${() => fileRef.current?.click()}>从文件选择<//>
              <${Button} size="sm" variant="ghost" icon="image"
                onClick=${() => setPicking(!picking)}>从相册选择<//>
              ${l.bg ? html`<${Button} size="sm" variant="ghost"
                onClick=${() => look.clearBg(chatId)}>清除<//>` : null}
            </div>
          </div>
          ${picking ? html`<${AlbumPick} onPick=${id => { look.setBgImage(chatId, id); setPicking(false); }}/>` : null}
          ${l.bg ? html`
            <${ListItem} title="遮罩"
              right=${html`<div style="width:170px"><${Slider} value=${l.veil} min=${0} max=${90}
                unit="%" onChange=${v => look.setLook(chatId, { veil: v === '' ? 0 : v })}/></div>`}/>` : null}
        </div>
      </div>
      <div class="settings-foot">
        背景铺满整个会话页，只对这段会话生效。遮罩使背景朝当前主题的底色变淡，
        数值越大，气泡外的文字越清晰。
      </div>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${pickFile} style="display:none"/>

      <${List}>
        <${ListItem} title="上下栏分开设置" multiline
          subtitle=${l.split ? '顶栏与输入栏各自设置。' : '顶栏与输入栏使用同一套样式。'}
          right=${html`<${Switch} checked=${l.split}
            onChange=${v => look.setLook(chatId, { split: v })}/>`}/>
      <//>
      ${l.split ? html`
        <${Bar} title="顶栏" bar=${l.top} onChange=${p => look.setLook(chatId, { top: p })}/>
        <${Bar} title="输入栏" bar=${l.bottom} onChange=${p => look.setLook(chatId, { bottom: p })}/>`
      : html`
        <${Bar} title="顶栏与输入栏" bar=${l.top} onChange=${p => look.setLook(chatId, { top: p })}/>`}
      <div class="settings-foot">
        实色为应用默认样式。半透明与毛玻璃时，栏浮在消息上方，消息从栏下经过。
        输入栏包括其上方的引用、待办与表情联想，以及展开的面板。
      </div>

      <div class="btn-row pad-x">
        <${Button} variant="ghost" onClick=${toAll}>应用到全部会话<//>
        ${look.isSet(chat) ? html`<${Button} variant="ghost" onClick=${reset}>恢复默认<//>` : null}
      </div>
    <//>`;
}
