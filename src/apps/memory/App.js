import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, IconButton, Field, Input, Textarea,
         Segmented, EmptyState, toast, confirm } from '../../ui/index.js';

import { ImportPage } from './ImportPage.js';
import { LastPage } from './LastPage.js';
import { CheckPage } from './CheckPage.js';

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
  const injected = db.memories.where(m => (m.rank === 'A' || m.rank === 'B') && !m.supersededBy).length;
  const dup = phone.memcheck.pairs('', '', 20).length;

  const add = () => {
    const charId = who !== 'all' && who !== 'none' ? who : (chars[0]?.id || null);
    if (!charId) { toast('请先在「联系」中创建角色'); return; }
    const m = db.memories.create({
      charId, personaId: phone.accounts.currentId(),
      content: '', category: 'fact', rank: 'B', keywords: [], source: 'manual',
    });
    nav.push(`/edit/${m.id}`);
  };

  return html`
    <${Page} title="记忆"
      right=${html`
        <${IconButton} name="search" label="上一轮召回"
          onClick=${() => nav.push('/last')}/>
        <${IconButton} name="upload" label="从文字导入"
          onClick=${() => nav.push('/import')}/>
        <button class="nav-text press" onClick=${add}>新建</button>`}>
      <div class="pad-x pad-t">
        <div class="stat-row">
          ${stats.map(s => html`
            <div key=${s.r} class="stat-chip"><b>${s.n}</b><span>${s.r} 级</span></div>`)}
        </div>
        <div class="hint-box">
          S 级压缩进「关系底色」常驻，不再逐条注入；A 与 B 级参与每轮召回
          （当前 ${injected} 条可被召回）；C 级仅存档。
          召回按线索、新近、分量等多项加权挑选，可在「上一轮召回」中查看当轮的选取过程。
        </div>
        ${dup ? html`
          <${ListItem} title=${`发现 ${dup} 组可能重复的记忆`} arrow multiline
            subtitle="同一件事留两条时，召回可能把两个版本一起送进去。点击逐组处理。"
            onClick=${() => nav.push('/check')}/>` : null}
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
      : html`<${EmptyState} icon="brain" title="暂无记忆"
          desc="可在会话中点击「立即总结记忆」，手动添加，或粘贴整段文本自动拆分。"
          action=${html`<${Button} size="sm" icon="upload"
            onClick=${() => nav.push('/import')}>从文字导入<//>`}/>`}
    <//>`;
}

function EditPage({ id }) {
  useStore(db.memories.store);
  const m = db.memories.get(id);
  if (!m) return html`<${Page} title="记忆" onBack=${nav.pop}><${EmptyState} title="该条记忆已被删除"/><//>`;

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
        <${Field} label="内容" desc="使用简洁的第三人称陈述。">
          <${Textarea} rows=${4} value=${m.content} onInput=${v => patch({ content: v })}/>
        <//>

        <${Field} label="重要级别"
          desc=${'S 级用于关系的重大转折，会被压缩进「关系底色」常驻，不再逐条注入；'
            + 'A 级为长期稳定的事实，命中相关话题时召回；'
            + 'B 级为具体细节，须填写关键词才会被召回；C 级仅存档，不注入。'}>
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
          desc=${m.rank === 'B' ? '以逗号分隔。B 级必须填写关键词，否则不会被注入。' : '以逗号分隔，仅 B 级记忆使用。'}>
          <${Input} value=${(m.keywords || []).join('，')}
            onInput=${v => patch({ keywords: v.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}/>
        <//>

        <${Field} label="属于谁"
          desc=${m.charId ? '仅在与该角色对话时注入' : '旧版本遗留的「全局」记忆，对所有角色生效。指定一个角色即可归位'}>
          <div class="chip-row">
            ${chars.map(c => html`
              <button key=${c.id} class=${`chip${m.charId === c.id ? ' is-active' : ''}`}
                onClick=${() => patch({ charId: c.id })}>${c.name}</button>`)}
          </div>
        <//>

        ${m.rank === 'B' && !(m.keywords || []).length ? html`
          <div class="warn-box">该条为 B 级但未填写关键词，将不会被注入。</div>` : null}

        <${Button} full variant="danger" onClick=${del}>删除<//>
      </div>
    <//>`;
}

export default function MemoryApp({ route }) {
  if (route === '/import') return html`<${ImportPage}/>`;
  if (route === '/last') return html`<${LastPage}/>`;
  if (route === '/check') return html`<${CheckPage}/>`;
  const edit = route?.match(/^\/edit\/(.+)$/);
  if (edit) return html`<${EditPage} id=${edit[1]}/>`;
  return html`<${MemoryList}/>`;
}
