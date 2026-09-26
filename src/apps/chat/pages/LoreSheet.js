import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Sheet, FullSheet, List, ListItem, Field, Input, Textarea, Switch, Icon, IconButton, Button,
  toast, confirm } from '../../../ui/index.js';

const { db, htmlcard, ai, tone, face } = phone;

// 面板「更多」最上面那一项：世界书与文风（ARCHITECTURE 4.282）。
//
// 用户要求：世界书放在更多的最上面、自己能开关；也能在这一页自己添加文风预设。
//
//   世界书  这个角色挂着的、全局的、内置卡片：开关表示这个角色用不用这本书；展开逐条开关。
//           和悬浮球里那一页（shell/QuickBall.js 的 LorePanel）是同一件事，只是入口不同
//   文风    预设库在这儿看、新建、编辑、删除；勾上的那几份写进这段会话线下时的提示词（chat.faceTones）。
//           线上聊天不写入文风 —— 线上的样子由角色卡与世界书决定（第 16 条）

/** 文风预设的编辑页。线下那张单子（FaceBits）也用它 */
export function ToneEditor({ edit, onClose, onSaved }) {
  const [v, setV] = useState({ id: edit?.id || '', name: edit?.name || '', text: edit?.text || '' });
  const save = () => {
    const name = String(v.name || '').trim() || '未命名';
    const text = String(v.text || '').trim();
    const id = v.id ? (tone.save(v.id, { name, text }), v.id) : tone.create({ name, text });
    toast('已保存', 'ok');
    onSaved && onSaved(id, !v.id);
    onClose();
  };
  return html`
    <${FullSheet} open=${!!edit} onClose=${onClose} title=${v.id ? '编辑文风' : '新建文风'}
      right=${html`<${Button} size="sm" onClick=${save}>保存<//>`}>
      <div class="pad">
        <${Field} label="名称">
          <${Input} value=${v.name} placeholder="例如 克制" onInput=${x => setV(e => ({ ...e, name: x }))}/>
        <//>
        <${Field} label="正文"
          desc="这段话会原样写进提示词。英文写的指令不容易把措辞漏进输出里。可以用 {{charName}} 与 {{userName}} 指代双方。">
          <${Textarea} rows=${12} value=${v.text} onInput=${x => setV(e => ({ ...e, text: x }))}/>
        <//>
      </div>
    <//>`;
}

export function LoreSheet({ open, chat, char, onClose }) {
  useStore(db.lorebooks.store);
  useStore(db.characters.store);
  useStore(db.chats.store);
  useStore(db.settings.store);
  const [expanded, setExpanded] = useState('');
  const [edit, setEdit] = useState(null);
  const live = chat ? db.chats.get(chat.id) : null;
  const me = char ? db.characters.get(char.id) : null;

  const ids = me?.lorebookIds || [];
  const attach = (bid, on) => me && db.characters.update(me.id, { lorebookIds: on ? [...new Set([...ids, bid])] : ids.filter(x => x !== bid) });
  const patchEntry = (bid, eid, on) => db.lorebooks.update(bid, b => ({ entries: (b.entries || []).map(e => (e.id === eid ? { ...e, enabled: on } : e)) }));
  const books = db.lorebooks.all().filter(b => ai.lore.purposeOf(b) === 'chat');
  const bb = htmlcard.builtinBook();
  const bst = htmlcard.builtinState();

  const bookRow = (b, on, onChange, sub, entries, onEntry) => html`
    <div key=${b.id}>
      <${ListItem} title=${b.name} subtitle=${sub} multiline
        left=${html`<${IconButton} name=${expanded === b.id ? 'chevronUp' : 'chevronDown'} label="展开"
          onClick=${e => { e.stopPropagation(); setExpanded(expanded === b.id ? '' : b.id); }}/>`}
        right=${html`<${Switch} checked=${on} onChange=${onChange}/>`}
        onClick=${() => onChange(!on)}/>
      ${expanded === b.id ? html`
        <div class="lore-entries">
          ${entries.length ? entries.map(e => html`
            <${ListItem} key=${e.id} title=${e.comment || String(e.content || '').slice(0, 16) || '未命名条目'}
              subtitle=${e.type === 'card' ? '卡片' : ''}
              right=${html`<${Switch} checked=${e.enabled !== false} onChange=${v => onEntry(e.id, v)}/>`}/>`)
          : html`<div class="settings-foot">这本书还没有条目。</div>`}
        </div>` : null}
    </div>`;

  // 文风：勾上的写进这段会话线下时的提示词
  const picked = live ? face.tonesOf(live) : [];
  const flipTone = id => live && face.setTones(live.id, picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]);
  const dropTone = async row => {
    if (!await confirm({ title: `删除「${row.name}」`, message: row.builtin ? '内置的这一份将不再出现，可以恢复。' : '删除后无法恢复。', okText: '删除', danger: true })) return;
    tone.remove(row.id);
    if (picked.includes(row.id)) flipTone(row.id);
  };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title="世界书与文风" height="88%">
      ${me ? html`
        <${List} title="世界书">
          <div class="settings-foot">开关表示「${me.name}」是否使用该世界书。全局生效的书对所有角色生效，在此关闭后对所有角色停用。展开可逐条开关。</div>
          ${bookRow(bb, bb.global || ids.includes(bb.id),
            v => (bb.global ? htmlcard.setBuiltin({ global: v }) : attach(bb.id, v)),
            bb.global ? '内置 · 全局生效' : '内置',
            bb.entries || [], (eid, on) => htmlcard.setBuiltin({ off: on ? (bst.off || []).filter(x => x !== eid) : [...(bst.off || []), eid] }))}
          ${books.map(b => bookRow(b, b.global || ids.includes(b.id),
            v => (b.global ? db.lorebooks.update(b.id, { global: v }) : attach(b.id, v)),
            `${(b.entries || []).length} 个条目${b.global ? ' · 全局生效' : ''}`,
            b.entries || [], (eid, on) => patchEntry(b.id, eid, on)))}
          ${books.length ? null : html`<${ListItem} title="还没有自己的世界书" subtitle="在「世界书」应用中新建或导入" multiline/>`}
        <//>` : html`<div class="settings-foot">群聊中请在各成员的角色资料中设置世界书。</div>`}

      <${List} title="文风">
        <div class="settings-foot">勾上的写进这段会话线下时的提示词，按勾选顺序写入。线上聊天不写入文风，由角色卡与世界书决定。</div>
        ${tone.list().map(t => html`
          <${ListItem} key=${t.id} title=${t.name} subtitle=${String(t.text || '').split('\n')[0]} multiline
            right=${html`<div class="row-acts">
              <${IconButton} name="edit" label="编辑" onClick=${e => { e.stopPropagation(); setEdit({ ...t }); }}/>
              <${IconButton} name="trash" label="删除" onClick=${e => { e.stopPropagation(); dropTone(t); }}/>
              <${Switch} checked=${picked.includes(t.id)} onChange=${() => flipTone(t.id)}/>
            </div>`}
            onClick=${() => flipTone(t.id)}/>`)}
        <${ListItem} title="新建一份" left=${html`<${Icon} name="plus" size=${18}/>`}
          onClick=${() => setEdit({ id: '', name: '', text: '' })}/>
        <${ListItem} title="恢复出厂的几份" multiline subtitle="改过或删掉的内置预设回到原样。自己新建的不受影响"
          onClick=${() => { tone.resetBuiltin(); toast('已恢复', 'ok'); }}/>
      <//>

      ${edit ? html`<${ToneEditor} edit=${edit} onClose=${() => setEdit(null)}
        onSaved=${(id, fresh) => { if (fresh) flipTone(id); }}/>` : null}
    <//>`;
}
