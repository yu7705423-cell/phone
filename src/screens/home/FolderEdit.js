import { html, useState, useEffect } from '../../lib.js';
import { Sheet, List, ListItem, Icon, Button, Input, Field, toast } from '../../ui/index.js';
import { listAppLooks } from '../../system/look.js';
import { newFolder, newFolderAuto, setFolder } from './layout.js';

// 新建与修改文件夹共用这一个。改名和「里面装哪几个」是同一件事，
// 拆成两处只会让人来回找。
//
// cell 传进来就是改它；不传就是新建，位置由 at 决定，没有 at 就自己找空位。
export function FolderEdit({ open, cell, at, preset = [], onClose }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);

  const mine = open ? (cell ? cell.id : `new:${preset.join(',')}`) : '';
  useEffect(() => {
    if (!open) return;
    setName(cell?.name || '');
    setPicked(cell ? [...(cell.apps || [])] : [...preset]);
  }, [mine]);

  if (!open) return null;

  const apps = listAppLooks();
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const commit = () => {
    const r = cell ? setFolder(cell.id, { name: name || cell.name || '文件夹', apps: picked })
      : at ? newFolder(at.pageIdx, at.x, at.y, picked, name || '文件夹')
        : newFolderAuto(at?.pageIdx || 0, picked, name || '文件夹');
    if (!r.ok) { toast(r.reason, 'error'); return; }
    onClose();
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${cell ? '编辑文件夹' : '新建文件夹'} height="86%">
      <div class="pad-x">
        <${Field} label="名称">
          <${Input} value=${name} placeholder="文件夹" onInput=${v => setName(v)}/>
        <//>
        <${Field} label=${`装进来的应用 · 已选 ${picked.length}`}
          desc="选中的应用将从当前位置移入该文件夹。全部取消选择即删除该文件夹。"/>
      </div>
      <${List} inset=${false}>
        ${apps.map(a => html`
          <${ListItem} key=${a.id} title=${a.name}
            left=${html`<div class="icon-chip"><${Icon} name=${a.icon} size=${17}/></div>`}
            right=${picked.includes(a.id) ? html`<${Icon} name="check" size=${17}/>` : null}
            onClick=${() => toggle(a.id)}/>`)}
      <//>
      <div class="pad">
        <${Button} full onClick=${commit}>${cell ? '保存' : '创建'}<//>
      </div>
    <//>`;
}
