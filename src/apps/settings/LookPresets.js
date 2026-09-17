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
    toast('存好了', 'ok');
  };

  const applyOne = async item => {
    if (!await confirm({
      title: `换成「${item.name}」`,
      message: '壁纸、图标、图标位置、挂件、主题参数都会被换掉。当前这套没存过的话就找不回来了。',
      okText: '换',
    })) return;
    const r = looks.apply(item.id);
    toast(r.missing ? `换好了，有 ${r.missing} 张图已经被删掉了` : '换好了',
      r.missing ? 'plain' : 'ok', r.missing ? 4500 : 2000);
  };

  const overwrite = async item => {
    setHeld(null);
    if (!await confirm({
      title: `覆盖「${item.name}」`,
      message: '用现在这套装修盖掉它。原来存的那一套就没了。',
      okText: '覆盖',
    })) return;
    looks.update(item.id);
    toast('覆盖好了', 'ok');
  };

  const doRename = async item => {
    setHeld(null);
    const name = await prompt({ title: '改名字', value: item.name });
    if (name === null) return;
    looks.rename(item.id, (name || '').trim());
  };

  const doRemove = async item => {
    setHeld(null);
    if (!await confirm({ title: '删掉预设', message: `「${item.name}」会被删掉。壁纸和图标本身不会删。`, okText: '删掉', danger: true })) return;
    looks.remove(item.id);
    toast('删了');
  };

  return html`
    <${List} title="外观预设">
      ${list.length ? null : html`
        <${ListItem} title="还没有预设" multiline
          subtitle="把现在这套装修存下来，以后换了壁纸和图标还能一键切回去"/>`}
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
          <${ListItem} title="用现在的样子覆盖" subtitle="把当前装修存回这个预设" arrow multiline
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
