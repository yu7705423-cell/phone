import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, IconButton, Field, Input, Textarea,
         Segmented, EmptyState, toast, confirm } from '../../ui/index.js';

import { ImportPage } from './ImportPage.js';

const { db, nav, ai } = phone;
const { CATEGORIES, RANKS } = ai.memory;

const RANK_ITEMS = RANKS.map(r => ({ value: r, label: r }));
const CAT_ITEMS = Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }));

// 记忆挂在角色身上。charId 留空的是老版本留下的「全局」记忆，
// 对所有角色都生效，界面上单独列出来提醒你归个位。
const ownerName = m => m.charId
  ? (db.characters.get(m.charId)?.name || '已删除的角色')
  : '没绑定角色';

function MemoryList() {
  useStore(db.memories.store);
  useStore(db.characters.store);
  const [filter, setFilter] = useState('all');
  const [who, setWho] = useState('all');

  let list = db.memories.all();
  if (who !== 'all') list = list.filter(m => (m.charId || '') === (who === 'none' ? '' : who));
  if (filter !== 'all') {
    list = RANKS.includes(filter)
      ? list.filter(m => m.rank === filter)
      : list.filter(m => m.category === filter);
  }
  list = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const chars = db.characters.all();
  const loose = db.memories.where(m => !m.charId).length;
  const owners = [
    { v: 'all', label: '全部' },
    ...chars.map(c => ({ v: c.id, label: c.name })),
    ...(loose ? [{ v: 'none', label: `没绑定角色 ${loose}` }] : []),
  ];
  const stats = RANKS.map(r => ({ r, n: db.memories.where(m => m.rank === r).length }));
  const injected = db.memories.where(m => m.rank === 'S' || m.rank === 'A').length;

  const add = () => {
    const charId = who !== 'all' && who !== 'none' ? who : (chars[0]?.id || null);
    if (!charId) { toast('先去「联系」里建一个角色'); return; }
    const m = db.memories.create({
      charId, personaId: phone.accounts.currentId(),
      content: '', category: 'fact', rank: 'B', keywords: [], source: 'manual',
    });
    nav.push(`/edit/${m.id}`);
  };

  return html`
    <${Page} title="记忆"
      right=${html`
        <${IconButton} name="upload" label="从文字导入"
          onClick=${() => nav.push('/import')}/>
        <button class="nav-text press" onClick=${add}>新建</button>`}>
      <div class="pad-x pad-t">
        <div class="stat-row">
          ${stats.map(s => html`
            <div key=${s.r} class="stat-chip"><b>${s.n}</b><span>${s.r} 级</span></div>`)}
        </div>
        <div class="hint-box">
          S 和 A 级每次都注入（当前 ${injected} 条）；B 级要在最近消息里命中关键词才进；C 级只存档。
        </div>
      </div>

      <div class="pad-x">
        <div class="chip-row">
          ${['all', ...RANKS, ...Object.keys(CATEGORIES)].map(f => html`
            <button key=${f} class=${`chip${filter === f ? ' is-active' : ''}`}
              onClick=${() => setFilter(f)}>${f === 'all' ? '全部' : (CATEGORIES[f] || f)}</button>`)}
        </div>
        <div class="chip-row">
          ${owners.map(o => html`
            <button key=${o.v} class=${`chip${who === o.v ? ' is-active' : ''}`}
              onClick=${() => setWho(o.v)}>${o.label}</button>`)}
        </div>
      </div>

      ${list.length ? html`
        <${List}>
          ${list.map(m => html`
            <${ListItem} key=${m.id} multiline title=${m.content || '（空）'}
              subtitle=${`${ownerName(m)} · ${CATEGORIES[m.category] || m.category}${m.keywords?.length ? ' · ' + m.keywords.join('、') : ''}${m.source === 'auto' ? ' · 自动提取' : ''}`}
              left=${html`<span class=${`rank rank-${m.rank}`}>${m.rank}</span>`}
              arrow onClick=${() => nav.push(`/edit/${m.id}`)}/>`)}
        <//>`
      : html`<${EmptyState} icon="brain" title="还没有记忆"
          desc="在会话里点「立即总结记忆」，手动添加，或者从别处粘一大段文字进来自动拆。"
          action=${html`<${Button} size="sm" icon="upload"
            onClick=${() => nav.push('/import')}>从文字导入<//>`}/>`}
    <//>`;
}

function EditPage({ id }) {
  useStore(db.memories.store);
  const m = db.memories.get(id);
  if (!m) return html`<${Page} title="记忆" onBack=${nav.pop}><${EmptyState} title="这条记忆已被删除"/><//>`;

  const patch = p => db.memories.update(id, p);
  const del = async () => {
    if (!await confirm({ title: '删除这条记忆', danger: true })) return;
    db.memories.remove(id);
    nav.pop();
  };

  const chars = db.characters.all();

  return html`
    <${Page} title="编辑记忆" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="内容" desc="用简洁的第三人称陈述">
          <${Textarea} rows=${4} value=${m.content} onInput=${v => patch({ content: v })}/>
        <//>

        <${Field} label="重要级别"
          desc="S 和 A 每次都注入；B 需要命中关键词；C 只存档不注入">
          <${Segmented} value=${m.rank} items=${RANK_ITEMS} onChange=${v => patch({ rank: v })}/>
        <//>

        <${Field} label="分类">
          <div class="chip-row">
            ${CAT_ITEMS.map(c => html`
              <button key=${c.value} class=${`chip${m.category === c.value ? ' is-active' : ''}`}
                onClick=${() => patch({ category: c.value })}>${c.label}</button>`)}
          </div>
        <//>

        <${Field} label="关键词"
          desc=${m.rank === 'B' ? '逗号分隔。B 级必须有关键词，否则永远不会被注入。' : '逗号分隔。只有 B 级会用到。'}>
          <${Input} value=${(m.keywords || []).join('，')}
            onInput=${v => patch({ keywords: v.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}/>
        <//>

        <${Field} label="属于谁"
          desc=${m.charId ? '只在和这个角色聊天时注入' : '老版本留下的「全局」记忆，对所有角色都生效。挑一个角色就能归位'}>
          <div class="chip-row">
            ${chars.map(c => html`
              <button key=${c.id} class=${`chip${m.charId === c.id ? ' is-active' : ''}`}
                onClick=${() => patch({ charId: c.id })}>${c.name}</button>`)}
          </div>
        <//>

        ${m.rank === 'B' && !(m.keywords || []).length ? html`
          <div class="warn-box">这条是 B 级但没有关键词，永远不会被注入。</div>` : null}

        <${Button} full variant="danger" onClick=${del}>删除<//>
      </div>
    <//>`;
}

export default function MemoryApp({ route }) {
  if (route === '/import') return html`<${ImportPage}/>`;
  const edit = route?.match(/^\/edit\/(.+)$/);
  if (edit) return html`<${EditPage} id=${edit[1]}/>`;
  return html`<${MemoryList}/>`;
}
