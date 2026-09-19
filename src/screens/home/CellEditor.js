import { html, useState } from '../../lib.js';
import { Sheet, List, ListItem, Icon, Button, Input, Field, toast } from '../../ui/index.js';
import { listWidgets } from '../../system/registry.js';
import { listAppLooks } from '../../system/look.js';
import { layout } from '../../system/db/index.js';
import { placeAt, placeAtXY, clearCell, newFolder, newFolderAuto, setFolder, putInFolder, takeOut } from './layout.js';
import { IconSheet } from './IconSheet.js';

const sizeLabel = (w, h) => `${w} x ${h}`;

// 这一页上现有的文件夹，供「装进文件夹」挑
function foldersNow() {
  const out = [];
  for (const page of (layout.get().pages || [])) {
    for (const c of (page.cells || [])) if (c.kind === 'folder') out.push(c);
  }
  return out;
}

// 多选一串 app。新建文件夹和改文件夹用的是同一个
function AppPicker({ apps, picked, onToggle }) {
  return html`
    <${List} inset=${false}>
      ${apps.map(a => html`
        <${ListItem} key=${a.id} title=${a.name}
          left=${html`<div class="icon-chip"><${Icon} name=${a.icon} size=${17}/></div>`}
          right=${picked.includes(a.id)
            ? html`<${Icon} name="check" size=${17}/>` : null}
          onClick=${() => onToggle(a.id)}/>`)}
    <//>`;
}

// 整理模式下点任意位置：换内容、交换、移除
export function CellEditor({ cell, pageIdx, onClose, onSwapFrom }) {
  const [tab, setTab] = useState('root');
  const [picked, setPickedApps] = useState([]);
  const [name, setName] = useState('');
  const [editingIcon, setEditingIcon] = useState(null);
  if (!cell) return null;

  const widgets = listWidgets();
  const apps = listAppLooks();
  const isSlot = !!cell.slot;
  const isFolder = cell.kind === 'folder';

  const close = () => { setTab('root'); setPickedApps([]); setName(''); onClose(); };

  const put = next => {
    const r = isSlot ? placeAtXY(pageIdx, cell.x, cell.y, next)
                     : placeAt(pageIdx, cell.id, next);
    if (!r.ok) { toast(r.reason, 'error'); return; }
    close();
  };

  const toggle = id => setPickedApps(p =>
    p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const makeFolder = () => {
    const r = newFolder(pageIdx, cell.x, cell.y, picked, name || '文件夹');
    if (!r.ok) { toast(r.reason, 'error'); return; }
    close();
  };

  const saveFolder = () => {
    const r = setFolder(cell.id, { name: name || cell.name, apps: picked });
    if (!r.ok) { toast(r.reason, 'error'); return; }
    close();
  };

  const intoFolder = folderId => {
    const r = putInFolder(folderId, cell.ref);
    if (!r.ok) { toast(r.reason, 'error'); return; }
    close();
  };

  const openFolderEdit = () => {
    setPickedApps([...(cell.apps || [])]);
    setName(cell.name || '');
    setTab('folder-edit');
  };
  // app 格上新建：这个 app 先替你勾上，多半就是为了把它收起来才点的
  const openFolderNew = () => {
    setPickedApps(cell.kind === 'app' && cell.ref ? [cell.ref] : []);
    setName('');
    setTab('folder-new');
  };

  const body =
    tab === 'widget' ? html`
      <${List} inset=${false}>
        ${widgets.flatMap(w => (w.sizes || [[2, 2]]).map(([ww, hh]) => html`
          <${ListItem} key=${`${w.id}-${ww}x${hh}`} title=${w.label}
            subtitle=${sizeLabel(ww, hh)} arrow
            left=${html`<${Icon} name="grid" size=${18}/>`}
            onClick=${() => put({ kind: 'widget', ref: w.id, w: ww, h: hh })}/>`))}
      <//>`
    : tab === 'app' ? html`
      <${List} inset=${false}>
        ${apps.map(a => html`
          <${ListItem} key=${a.id} title=${a.name} arrow
            left=${html`<div class="icon-chip"><${Icon} name=${a.icon} size=${17}/></div>`}
            onClick=${() => put({ kind: 'app', ref: a.id, w: 1, h: 1 })}/>`)}
      <//>`
    : tab === 'folder-new' || tab === 'folder-edit' ? html`
      <div class="pad-x">
        <${Field} label="名称">
          <${Input} value=${name} placeholder="文件夹"
            onInput=${v => setName(v)}/>
        <//>
        <${Field} label=${`装进来的应用 · 已选 ${picked.length}`}
          desc="选中的应用将从当前位置移入该文件夹。全部取消选择即删除该文件夹。"/>
      </div>
      <${AppPicker} apps=${apps} picked=${picked} onToggle=${toggle}/>
      <div class="pad">
        <${Button} full onClick=${tab === 'folder-new' ? makeFolder : saveFolder}>
          ${tab === 'folder-new' ? '创建' : '保存'}<//>
      </div>`
    : tab === 'into' ? html`
      <${List} inset=${false}>
        ${foldersNow().map(f => html`
          <${ListItem} key=${f.id} title=${f.name || '文件夹'} arrow
            subtitle=${`已有 ${(f.apps || []).length} 个应用`}
            left=${html`<${Icon} name="folder" size=${18}/>`}
            onClick=${() => intoFolder(f.id)}/>`)}
      <//>`
    : tab === 'out' ? html`
      <${List} inset=${false}>
        ${(cell.apps || []).map(id => {
          const a = apps.find(x => x.id === id);
          return a ? html`
            <${ListItem} key=${id} title=${a.name} arrow
              left=${html`<div class="icon-chip"><${Icon} name=${a.icon} size=${17}/></div>`}
              onClick=${() => { takeOut(cell.id, id); close(); }}/>` : null;
        })}
      <//>`
    : html`
      <${List} inset=${false}>
        ${isFolder ? html`
          <${ListItem} title="编辑文件夹" subtitle="改名称，或增减里面的应用" arrow multiline
            left=${html`<${Icon} name="folder" size=${18}/>`} onClick=${openFolderEdit}/>
          <${ListItem} title="取出一个应用" subtitle="取出后放回主界面的空位上" arrow multiline
            left=${html`<${Icon} name="layers" size=${18}/>`} onClick=${() => setTab('out')}/>
        ` : html`
          <${ListItem} title="放一个小组件" subtitle="文字块、图片块、播放器横条、Love 日历、自定义组件…" arrow multiline
            left=${html`<${Icon} name="grid" size=${18}/>`} onClick=${() => setTab('widget')}/>
          <${ListItem} title="放一个应用" arrow
            left=${html`<${Icon} name="layers" size=${18}/>`} onClick=${() => setTab('app')}/>
          ${isSlot || cell.kind === 'app' ? html`
            <${ListItem} title="新建文件夹" arrow multiline
              subtitle=${cell.kind === 'app'
                ? `把「${apps.find(a => a.id === cell.ref)?.name || '这个应用'}」和别的应用收进一格`
                : '把多个应用收进一格'}
              left=${html`<${Icon} name="folder" size=${18}/>`} onClick=${openFolderNew}/>` : null}
        `}
        ${!isSlot ? html`
          ${cell.kind === 'app' ? html`
            <${ListItem} title="图标与名称" subtitle="换一个线条图标或一张图片，也可以改名" arrow multiline
              left=${html`<${Icon} name="edit" size=${18}/>`}
              onClick=${() => setEditingIcon(cell.ref)}/>` : null}
          ${cell.kind === 'app' && foldersNow().length ? html`
            <${ListItem} title="装进已有的文件夹" arrow
              left=${html`<${Icon} name="folder" size=${18}/>`} onClick=${() => setTab('into')}/>` : null}
          <${ListItem} title="移动到别处" subtitle="接着点想放到的位置，翻页也可以，占着的会自动让开" arrow multiline
            left=${html`<${Icon} name="drag" size=${18}/>`}
            onClick=${() => { onSwapFrom(cell.id); close(); }}/>
          <${ListItem} title="移除" danger arrow multiline
            subtitle=${cell.kind === 'widget' ? '从主界面移除该小组件'
              : '从主界面移除。之后可在「设置 - 外观」中放回，或在任意空位重新放置'}
            left=${html`<${Icon} name="trash" size=${18}/>`}
            onClick=${() => { clearCell(pageIdx, cell.id); close(); }}/>` : null}
      <//>`;

  const title = tab === 'widget' ? '选一个小组件' : tab === 'app' ? '选一个应用'
    : tab === 'folder-new' ? '新建文件夹' : tab === 'folder-edit' ? '编辑文件夹'
    : tab === 'into' ? '装进哪个文件夹' : tab === 'out' ? '取出一个应用'
    : isFolder ? (cell.name || '文件夹') : (isSlot ? '这个空位' : '这个位置');

  return html`
    <${Sheet} open=${true} onClose=${close} title=${title} height=${tab === 'root' ? null : '72%'}>
      <${IconSheet} appId=${editingIcon} onClose=${() => setEditingIcon(null)}/>
      ${tab !== 'root' ? html`
        <div class="pad-b">
          <${Button} size="sm" variant="ghost" icon="chevronLeft"
            onClick=${() => setTab('root')}>返回<//>
        </div>` : null}
      ${body}
    <//>`;
}
