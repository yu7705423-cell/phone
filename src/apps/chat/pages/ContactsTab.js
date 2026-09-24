import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Avatar, EmptyState, Button, Icon, Sheet, List, ListItem } from '../../../ui/index.js';

const { db, nav } = phone;
const UNGROUPED = '未分组';

function Row({ char, onHold }) {
  const avatar = useImage(char.avatar);
  let holdTimer = null;
  const start = () => { holdTimer = setTimeout(() => { holdTimer = null; onHold(char); }, 500); };
  const end = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

  return html`
    <div class="msg-row no-callout press"
      onClick=${() => nav.push(`/profile/${char.id}`)}
      onMouseDown=${start} onMouseUp=${end} onMouseLeave=${end}
      onTouchStart=${start} onTouchEnd=${end} onTouchMove=${end}
      onContextMenu=${e => { e.preventDefault(); onHold(char); }}>
      <${Avatar} src=${avatar} name=${char.name} size=${42} radius=${21}/>
      <div class="msg-main">
        <div class="msg-name ellipsis">${phone.remark.nameOf(char)}</div>
        <div class="msg-preview ellipsis">
          ${char.signature || ''}
        </div>
      </div>
      <${Icon} name="chevronRight" size=${16} class="li-arrow"/>
    </div>`;
}

export function ContactsTab() {
  useStore(db.characters.store);
  const [q, setQ] = useState('');
  const [held, setHeld] = useState(null);

  const all = db.characters.all();
  const key = q.trim().toLowerCase();
  const matched = key
    ? all.filter(c => [c.name, c.remark, c.signature, c.persona, c.group, ...(c.tags || [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(key)))
    : all;

  // 按分组归拢，未分组排最后。NPC 不进分组，单独列在最后一栏
  const byName = (a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.name.localeCompare(b.name, 'zh');
  const npcs = matched.filter(c => c.isNpc).sort(byName);
  const groups = new Map();
  for (const c of matched) {
    if (c.isNpc) continue;
    const g = (c.group || '').trim() || UNGROUPED;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const names = [...groups.keys()].sort((a, b) =>
    a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b, 'zh'));
  names.forEach(n => groups.get(n).sort(byName));

  const add = () => {
    const c = db.characters.create({
      name: '新角色', persona: '', scenario: '', firstMessage: '',
      exampleDialogue: '', lorebookIds: [], tags: [], group: '',
    });
    phone.intent.open('contact', { route: `/char/${c.id}` });
  };

  if (!all.length) {
    return html`<${EmptyState} icon="users" title="暂无角色卡"
      desc="角色卡是整套系统的核心数据。聊天、朋友圈与主页共用同一份。"
      action=${html`<${Button} size="sm" icon="plus" onClick=${add}>新建角色卡<//>`}/>`;
  }

  return html`
    <div class="msg-list">
      <div class="search-bar">
        <${Icon} name="search" size=${16}/>
        <input value=${q} placeholder="搜索姓名、签名、人设或分组"
          onInput=${e => setQ(e.target.value)}/>
        ${q ? html`<button class="press" onClick=${() => setQ('')}>
          <${Icon} name="close" size=${15}/></button>` : null}
      </div>

      ${names.length || npcs.length ? html`
        ${names.map(g => html`
          <div key=${g} class="cap-wrap">
            <div class="cap-title">${g} · ${groups.get(g).length}</div>
            <div class="capsule">
              ${groups.get(g).map(c => html`<${Row} key=${c.id} char=${c} onHold=${setHeld}/>`)}
            </div>
          </div>`)}
        ${npcs.length ? html`
          <div class="cap-wrap">
            <div class="cap-title">NPC · ${npcs.length}</div>
            <div class="capsule">
              ${npcs.map(c => html`<${Row} key=${c.id} char=${c} onHold=${setHeld}/>`)}
            </div>
          </div>` : null}`
      : html`<${EmptyState} icon="search" title="无匹配的角色"/>`}

      <div class="pad">
        <${Button} full variant="ghost" icon="plus" onClick=${add}>新建角色卡<//>
      </div>

      <${Sheet} open=${!!held} onClose=${() => setHeld(null)} title=${held?.name || ''}>
        ${held ? html`
          <${List} inset=${false}>
            <${ListItem} title="分组" arrow multiline
              subtitle=${`当前：${(held.group || '').trim() || UNGROUPED}。分组在「联系」中新建与调整，此处只显示`}
              left=${html`<${Icon} name="folder" size=${18}/>`}
              onClick=${() => { setHeld(null); phone.intent.open('contact', { route: '/' }); }}/>
          <//>
          <${List} inset=${false}>
            <${ListItem} title=${held.pinned ? '取消置顶' : '在分组内置顶'} arrow
              left=${html`<${Icon} name=${held.pinned ? 'chevronDown' : 'chevronUp'} size=${18}/>`}
              onClick=${() => { db.characters.update(held.id, { pinned: !held.pinned }); setHeld(null); }}/>
            <${ListItem} title="编辑人设" arrow
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => { const id = held.id; setHeld(null); phone.intent.open('contact', { route: `/char/${id}` }); }}/>
            <${ListItem} title="角色卡" subtitle="语音、图片、主动发起对话、世界书、时区" arrow multiline
              left=${html`<${Icon} name="edit" size=${18}/>`}
              onClick=${() => { const id = held.id; setHeld(null); nav.push(`/edit/${id}`); }}/>
          <//>` : null}
      <//>
    </div>`;
}
