import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, IconPicker, EmptyState,
         confirm, toast } from '../../../ui/index.js';

const { db, nav, theirs } = phone;

// 这台手机的外观：壁纸与各个应用的图标、名称。
//
// 图标那一套**直接复用 ui/IconPicker** —— 它本来就收一个 service 对象，
// 就是为了「改它的地方不止一处」。这里只是把那几个动作接到这台手机自己那一行上。
//
// 壁纸没设过就回落到角色卡的封面：那张本来就是这个角色的画面，
// 不必逼着人先选一张才好看。

// 这台手机上会出现的那几个应用。和主屏那一份对着，改了要一起改
const APPS = [
  { id: 'chats', name: '聊天', icon: 'message' },
  { id: 'album', name: '相册', icon: 'camera' },
  { id: 'shelf', name: '书架', icon: 'book' },
  { id: 'body', name: '身体状态', icon: 'pulse' },
  { id: 'day', name: '今天', icon: 'calendar' },
  { id: 'notes', name: '备忘录', icon: 'notes' },
  { id: 'browser', name: '浏览器', icon: 'search' },
];

function Tile({ charId, app, onPick }) {
  const cur = theirs.iconOf(charId, app.id);
  const url = useImage(cur.imageId);
  return html`
    <${ListItem} title=${cur.name || app.name} multiline
      subtitle=${[cur.name && cur.name !== app.name ? `原名 ${app.name}` : '',
        cur.imageId ? '使用图片' : cur.icon && cur.icon !== app.icon ? '已更换图标' : '默认'].filter(Boolean).join(' · ')}
      left=${url
        ? html`<span class="tp-ico-img" style=${`background-image:url(${url})`}></span>`
        : html`<${Icon} name=${cur.icon || app.icon} size=${18}/>`}
      arrow onClick=${onPick}/>`;
}

export function LookPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.phones.store);
  const char = db.characters.get(charId);
  const [picking, setPicking] = useState('');
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const own = theirs.wallpaperOf(charId);
  const wall = useImage(own || char?.cover);

  if (!char) {
    return html`<${Page} title="外观" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const pickWall = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { await theirs.setWallpaper(charId, file); toast('已更换壁纸', 'ok'); }
    catch (err) { toast('图片处理失败：' + (err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  const clearWall = async () => {
    if (!await confirm({ title: '恢复默认壁纸',
      message: '将改回使用该角色卡的封面图片。已更换的壁纸会被删除。', okText: '恢复' })) return;
    theirs.clearWallpaper(charId);
    toast('已恢复');
  };

  // IconPicker 要的那一套动作，接到这台手机自己那一行上
  const service = {
    override: appId => theirs.iconOf(charId, appId),
    set: (appId, patch) => theirs.setIcon(charId, appId, patch),
    reset: appId => theirs.resetIcon(charId, appId),
    file: (appId, f) => theirs.setIconFile(charId, appId, f),
    url: (appId, u) => theirs.setIconUrl(charId, appId, u),
    clearImage: appId => theirs.clearIconImage(charId, appId),
  };

  return html`
    <${Page} title="外观" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class=${`tp-wallpick${wall ? ' has-img' : ''}`}
          style=${wall ? `background-image:url(${wall})` : ''}>
          ${wall ? null : html`<span>还没有图片</span>`}
        </div>
        <div class="pad-t batch-acts">
          <${Button} size="sm" disabled=${busy}
            onClick=${() => fileRef.current?.click()}>更换壁纸<//>
          <${Button} size="sm" variant="ghost" disabled=${!own}
            onClick=${clearWall}>恢复默认<//>
        </div>
        <div class="settings-foot">
          ${own ? '正在使用自行更换的壁纸。'
            : char.cover ? '未更换，当前使用该角色卡的封面图片。'
            : '未更换，该角色卡也没有封面图片，主屏使用纯色底。'}
        </div>
      </div>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${pickWall} style="display:none"/>

      <${List} title="应用图标与名称">
        ${APPS.map(a => html`
          <${Tile} key=${a.id} charId=${charId} app=${a} onPick=${() => setPicking(a.id)}/>`)}
      <//>
      <div class="settings-foot">
        这里改的只是这台手机上的显示，不影响本机的应用。
        没有内容的应用不会出现在主屏上，改了名称也一样。
      </div>

      <${IconPicker} appId=${picking} app=${APPS.find(a => a.id === picking)}
        service=${service} onClose=${() => setPicking('')}/>
    <//>`;
}
