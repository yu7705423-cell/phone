import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, Field, Input, Textarea, Switch,
         Segmented, EmptyState, toast, confirm, prompt } from '../../ui/index.js';

const { db, nav, ai } = phone;

const POSITIONS = [
  { value: 'system', label: '设定区' },
  { value: 'beforeChat', label: '对话前' },
  { value: 'afterChat', label: '对话后' },
];

function BookList() {
  useStore(db.lorebooks.store);
  const books = db.lorebooks.all().sort((a, b) => b.updatedAt - a.updatedAt);

  const add = async () => {
    const name = await prompt({ title: '新建世界书', placeholder: '例如：校园设定' });
    if (!name) return;
    const b = db.lorebooks.create({ name, description: '', global: false, entries: [] });
    nav.push(`/book/${b.id}`);
  };

  return html`
    <${Page} title="世界书"
      right=${html`<button class="nav-text press" onClick=${add}>新建</button>`}>
      ${books.length ? html`
        <${List}>
          ${books.map(b => html`
            <${ListItem} key=${b.id} title=${b.name}
              subtitle=${`${(b.entries || []).length} 个条目${b.global ? ' · 全局生效' : ''}`}
              arrow left=${html`<${Icon} name="book" size=${18}/>`}
              onClick=${() => nav.push(`/book/${b.id}`)}/>`)}
        <//>`
      : html`<${EmptyState} icon="book" title="暂无世界书"
          desc="世界书用于存放不属于特定角色的设定。条目可设为常驻，也可在对话涉及相关内容时才注入。"
          action=${html`<${Button} size="sm" onClick=${add} icon="plus">新建世界书<//>`}/>`}

      <div class="pad-x pad-b">
        <${Button} full variant="ghost" icon="eye"
          onClick=${() => nav.push('/preview')}>激活预览<//>
      </div>
    <//>`;
}

function BookPage({ id }) {
  useStore(db.lorebooks.store);
  const book = db.lorebooks.get(id);
  if (!book) return html`<${Page} title="世界书" onBack=${nav.pop}><${EmptyState} title="该世界书已被删除"/><//>`;

  const patchEntry = (eid, patch) => db.lorebooks.update(id, b => ({
    entries: b.entries.map(e => e.id === eid ? { ...e, ...patch } : e),
  }));

  const addEntry = () => {
    const e = {
      id: phone.uid('e'), comment: '', keys: [], secondaryKeys: [], content: '',
      enabled: true, constant: false, priority: 100, order: 0,
      position: 'system', caseSensitive: false, probability: 100,
    };
    db.lorebooks.update(id, b => ({ entries: [...b.entries, e] }));
    nav.push(`/entry/${id}/${e.id}`);
  };

  const del = async () => {
    if (!await confirm({ title: '删除世界书', message: `将删除「${book.name}」及其全部条目。`, danger: true })) return;
    db.lorebooks.remove(id);
    nav.pop();
  };

  return html`
    <${Page} title=${book.name} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${addEntry}>加条目</button>`}>
      <div class="pad">
        <${Field} label="名称">
          <${Input} value=${book.name} onInput=${v => db.lorebooks.update(id, { name: v })}/>
        <//>
      </div>
      <${List}>
        <${ListItem} title="全局生效" subtitle="开启后对所有角色注入，无需单独关联"
          right=${html`<${Switch} checked=${book.global}
            onChange=${v => db.lorebooks.update(id, { global: v })}/>`}/>
      <//>

      <${List} title=${`条目 ${(book.entries || []).length}`}>
        ${(book.entries || []).map(e => html`
          <${ListItem} key=${e.id}
            title=${e.comment || e.content.slice(0, 18) || '未命名条目'}
            subtitle=${e.constant ? '常驻' : (e.keys.length ? `关键词：${e.keys.join('、')}` : '未填写关键词，不会触发')}
            arrow
            left=${html`<${Switch} checked=${e.enabled}
              onChange=${v => patchEntry(e.id, { enabled: v })}/>`}
            onClick=${() => nav.push(`/entry/${id}/${e.id}`)}/>`)}
      <//>
      ${!(book.entries || []).length ? html`
        <${EmptyState} icon="book" title="暂无条目"
          action=${html`<${Button} size="sm" icon="plus" onClick=${addEntry}>新建条目<//>`}/>` : null}

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>删除这本世界书<//>
      </div>
    <//>`;
}

function EntryPage({ bookId, entryId }) {
  useStore(db.lorebooks.store);
  const book = db.lorebooks.get(bookId);
  const entry = book?.entries.find(e => e.id === entryId);
  if (!entry) return html`<${Page} title="条目" onBack=${nav.pop}><${EmptyState} title="该条目不存在"/><//>`;

  const patch = p => db.lorebooks.update(bookId, b => ({
    entries: b.entries.map(e => e.id === entryId ? { ...e, ...p } : e),
  }));

  const del = async () => {
    if (!await confirm({ title: '删除条目', danger: true })) return;
    db.lorebooks.update(bookId, b => ({ entries: b.entries.filter(e => e.id !== entryId) }));
    nav.pop();
  };

  return html`
    <${Page} title="条目" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="备注" desc="仅供本地识别，不进入 prompt。">
          <${Input} value=${entry.comment} onInput=${v => patch({ comment: v })}
            placeholder="该条目的用途"/>
        <//>

        <${Field} label="内容" desc="命中后原样注入 prompt。">
          <${Textarea} rows=${6} value=${entry.content} onInput=${v => patch({ content: v })}/>
        <//>

        <${Field} label="关键词" desc="以逗号分隔。扫描窗口内出现任意一个即命中。">
          <${Input} value=${(entry.keys || []).join('，')}
            placeholder="社团，学生会"
            onInput=${v => patch({ keys: v.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}/>
        <//>

        <${Field} label="二级关键词" desc="填写后须同时命中其中一个，用于收窄触发范围。">
          <${Input} value=${(entry.secondaryKeys || []).join('，')}
            onInput=${v => patch({ secondaryKeys: v.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}/>
        <//>

        <${Field} label="插入位置">
          <${Segmented} value=${entry.position} items=${POSITIONS}
            onChange=${v => patch({ position: v })}/>
        <//>

        <${Field} label=${`优先级　${entry.priority}`} desc="注入预算不足时，从低优先级开始丢弃。">
          <input type="range" min="0" max="400" step="10" value=${entry.priority}
            onInput=${e => patch({ priority: parseInt(e.target.value, 10) })}/>
        <//>

        <${Field} label=${`触发概率　${entry.probability}%`}>
          <input type="range" min="10" max="100" step="5" value=${entry.probability}
            onInput=${e => patch({ probability: parseInt(e.target.value, 10) })}/>
        <//>
      </div>

      <${List}>
        <${ListItem} title="常驻" subtitle="无需关键词，每次均注入"
          right=${html`<${Switch} checked=${entry.constant} onChange=${v => patch({ constant: v })}/>`}/>
        <${ListItem} title="区分大小写"
          right=${html`<${Switch} checked=${entry.caseSensitive} onChange=${v => patch({ caseSensitive: v })}/>`}/>
        <${ListItem} title="启用"
          right=${html`<${Switch} checked=${entry.enabled} onChange=${v => patch({ enabled: v })}/>`}/>
      <//>

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>删除条目<//>
      </div>
    <//>`;
}

// 没有这个页面,后期排查 prompt 问题就只能盲猜
function PreviewPage() {
  useStore(db.lorebooks.store);
  useStore(db.characters.store);
  const chars = db.characters.all();
  const [charId, setCharId] = useState(chars[0]?.id || '');
  const [text, setText] = useState('');

  const char = db.characters.get(charId);
  const budget = db.settings.get().contextBudget;
  const result = char ? ai.lore.activate(char, text, Math.round(budget * 0.4)) : { items: [], used: 0 };

  return html`
    <${Page} title="激活预览" onBack=${nav.pop}>
      <div class="pad">
        <div class="hint-box">输入一段对话，看看会激活哪些条目、占多少 token。</div>

        <${Field} label="以哪个角色的视角">
          ${chars.length ? html`
            <div class="chip-row">
              ${chars.map(c => html`
                <button key=${c.id} class=${`chip${charId === c.id ? ' is-active' : ''}`}
                  onClick=${() => setCharId(c.id)}>${c.name}</button>`)}
            </div>`
          : html`<div class="field-desc">还没有角色卡，先去聊天里建一个。</div>`}
        <//>

        <${Field} label="模拟对话内容">
          <${Textarea} rows=${5} value=${text} onInput=${setText}
            placeholder="粘贴最近几条消息"/>
        <//>
      </div>

      <${List} title=${`命中 ${result.items.length} 条 · 约 ${result.used} tokens`}>
        ${result.items.map(e => html`
          <${ListItem} key=${e.id} multiline
            title=${e.comment || e.content.slice(0, 20)}
            subtitle=${e.content}
            right=${html`<span>${e.constant ? '常驻' : '命中'}</span>`}/>`)}
      <//>
      ${!result.items.length ? html`<${EmptyState} icon="eye" title="无条目被激活"/>` : null}
    <//>`;
}

export default function LorebookApp({ route }) {
  const book = route?.match(/^\/book\/(.+)$/);
  if (book) return html`<${BookPage} id=${book[1]}/>`;
  const entry = route?.match(/^\/entry\/([^/]+)\/(.+)$/);
  if (entry) return html`<${EntryPage} bookId=${entry[1]} entryId=${entry[2]}/>`;
  if (route === '/preview') return html`<${PreviewPage}/>`;
  return html`<${BookList}/>`;
}
