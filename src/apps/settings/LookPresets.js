import { html, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { List, ListItem, Button, Icon, Sheet, toast, confirm, prompt } from '../../ui/index.js';

const { db, looks } = phone;

function Row({ item, onApply, onMenu }) {
  const wall = useImage(item.layout?.wallpaper?.home);
  const cells = (item.layout?.pages || []).reduce((n, p) => n + (p.cells || []).length, 0);
  const icons = Object.values(item.look?.appIcons || {}).filter(v => v?.imageId).length;
  const when = new Date(item.updatedAt || item.createdAt);
  const stamp = `${when.getMonth() + 1}月${when.getDate()}日`;

  return html`
    <div class="look-row">
      <button class="look-card press" onClick=${onApply} title="换成这一套">
        <div class=${`look-thumb${wall ? ' has-image' : ''}`}
          style=${wall ? `background-image:url(${wall})` : ''}>
          ${wall ? null : html`<${Icon} name="image" size=${16}/>`}
        </div>
        <div class="look-meta">
          <div class="look-name ellipsis">${item.name}</div>
          <div class="look-sub">${cells} 个位置 · ${icons} 个自定义图标 · ${stamp}</div>
        </div>
      </button>
      <button class="look-more press" onClick=${onMenu} aria-label="更多">
        <${Icon} name="more" size=${18}/>
      </button>
    </div>`;
}

// 外观预设。整套装修拍个快照，随时切回去。
// 放在「主题」页里，因为它存的就是这一页加主界面的东西，见 CLAUDE.md 第 5 条。
export function LookPresets() {
  useStore(db.looks.store);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(null);
  const list = db.looks.all().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const saveNew = async () => {
    const name = await prompt({ title: '存成预设', placeholder: `装修 ${list.length + 1}` });
    if (name === null) return;
    setBusy(true);
    looks.save((name || '').trim() || `装修 ${list.length + 1}`);
    setBusy(false);
    toast('已保存', 'ok');
  };

  const applyOne = async item => {
    if (!await confirm({
      title: `换成「${item.name}」`,
      message: '壁纸、图标、图标位置、小组件与主题参数将全部被替换。当前配置若未保存将无法恢复。',
      okText: '换',
    })) return;
    const r = looks.apply(item.id);
    toast(r.missing ? `已应用，其中 ${r.missing} 张图片已被删除` : '已应用',
      r.missing ? 'plain' : 'ok', r.missing ? 4500 : 2000);
  };

  const overwrite = async item => {
    setHeld(null);
    if (!await confirm({
      title: `覆盖「${item.name}」`,
      message: '以当前外观覆盖该预设，原有内容将被替换。',
      okText: '覆盖',
    })) return;
    looks.update(item.id);
    toast('已覆盖', 'ok');
  };

  const doRename = async item => {
    setHeld(null);
    const name = await prompt({ title: '改名字', value: item.name });
    if (name === null) return;
    looks.rename(item.id, (name || '').trim());
  };

  const doRemove = async item => {
    setHeld(null);
    if (!await confirm({ title: '删除预设', message: `将删除「${item.name}」。壁纸与图标本身不会被删除。`, okText: '删除', danger: true })) return;
    looks.remove(item.id);
    toast('已删除');
  };

  return html`
    <${List} title="外观预设">
      ${list.length ? null : html`
        <${ListItem} title="暂无预设" multiline
          subtitle="保存当前外观配置，更换壁纸与图标后可一键切回。"/>`}
    <//>
    ${list.length ? html`
      <div class="look-list">
        ${list.map(item => html`
          <${Row} key=${item.id} item=${item}
            onApply=${() => applyOne(item)} onMenu=${() => setHeld(item)}/>`)}
      </div>` : null}
    <div class="pad">
      <${Button} full variant="ghost" disabled=${busy} icon="plus"
        onClick=${saveNew}>存成新预设<//>
    </div>

    <${Sheet} open=${!!held} onClose=${() => setHeld(null)} title=${held?.name || ''} height="46%">
      ${held ? html`
        <${List} inset=${false}>
          <${ListItem} title="换成这一套" arrow
            left=${html`<${Icon} name="check" size=${18}/>`}
            onClick=${() => { const it = held; setHeld(null); applyOne(it); }}/>
          <${ListItem} title="以当前外观覆盖" subtitle="将当前配置保存回该预设" arrow multiline
            left=${html`<${Icon} name="refresh" size=${18}/>`}
            onClick=${() => overwrite(held)}/>
          <${ListItem} title="改名字" arrow
            left=${html`<${Icon} name="edit" size=${18}/>`}
            onClick=${() => doRename(held)}/>
          <${ListItem} title="删掉" danger arrow
            left=${html`<${Icon} name="trash" size=${18}/>`}
            onClick=${() => doRemove(held)}/>
        <//>` : null}
    <//>`;
}
