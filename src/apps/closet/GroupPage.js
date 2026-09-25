import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Input, Button, IconButton, Segmented, EmptyState } from '../../ui/index.js';
import { Grid, FilterSheet, emptyFilter, filterCount, applyFilter, ownerNow, sideNow } from './parts.js';
import { AddSheet, recognizeAsk } from './AddSheet.js';

const { db, nav, closet } = phone;
const K = closet.kinds;

// 一个大类里的东西（mode 为空），或者全部（all），或者还没分类的（unsorted）。
// 顶上一排小类，右上角筛选，中间搜索。「全部」多一个排序

const SORTS = {
  wear: [
    { value: 'new', label: '最近添加' },
    { value: 'worn', label: '最近穿过' },
    { value: 'most', label: '穿得最多' },
  ],
  beauty: [
    { value: 'new', label: '最近添加' },
    { value: 'low', label: '余量' },
    { value: 'exp', label: '保质期' },
  ],
};

function sortRows(rows, by) {
  const r = rows.slice();
  if (by === 'worn') return r.sort((a, b) => (b.lastWorn || 0) - (a.lastWorn || 0));
  if (by === 'most') return r.sort((a, b) => (b.wornCount || 0) - (a.wornCount || 0));
  if (by === 'low') {
    const pct = x => closet.remaining(x)?.pct ?? 101;
    return r.sort((a, b) => pct(a) - pct(b));
  }
  if (by === 'exp') {
    const at = x => closet.expiry(x)?.at ?? Infinity;
    return r.sort((a, b) => at(a) - at(b));
  }
  return r.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function GroupPage({ groupId = '', mode = '' }) {
  useStore(db.closet.store);
  useStore(db.settings.store);
  const [sub, setSub] = useState('');
  const [q, setQ] = useState('');
  const [f, setF] = useState(emptyFilter);
  const [filtering, setFiltering] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sort, setSort] = useState('new');
  const owner = ownerNow();
  const group = groupId ? K.groupOf(groupId) : null;
  const side = group ? group.side : sideNow();

  let rows = closet.itemsOf(owner).filter(r => r.side === side);
  if (group) rows = rows.filter(r => r.group === group.id);
  if (mode === 'unsorted') rows = rows.filter(r => !r.group && closet.live(r));
  const subs = group ? closet.subsOf(group.id).filter(s => rows.some(r => r.sub === s.label)) : [];
  const shown = sortRows(applyFilter(sub ? rows.filter(r => r.sub === sub) : rows, f, q), sort);
  const n = filterCount(f);
  const title = group ? group.label : mode === 'unsorted' ? '未整理' : `全部${K.sideOf(side).label}`;
  const open = item => nav.push(`/item/${item.id}`);
  const needVision = mode === 'unsorted' ? rows.filter(r => r.imageId) : [];

  return html`
    <${Page} title=${title} onBack=${nav.pop}
      right=${html`
        <${IconButton} name="filter" label=${n ? `筛选（${n}）` : '筛选'} active=${n > 0} onClick=${() => setFiltering(true)}/>
        ${mode === 'unsorted' ? null : html`<${IconButton} name="plus" label="添加" onClick=${() => setAdding(true)}/>`}`}>

      ${subs.length ? html`
        <div class="cl-subs">
          <button class=${`chip${sub ? '' : ' is-active'}`} onClick=${() => setSub('')}>全部 ${rows.length}</button>
          ${subs.map(s => html`
            <button key=${s.label} class=${`chip${sub === s.label ? ' is-active' : ''}`}
              onClick=${() => setSub(s.label)}>${s.label} ${rows.filter(r => r.sub === s.label).length}</button>`)}
        </div>` : null}

      <div class="pad-x cl-search">
        <${Input} value=${q} onInput=${setQ} placeholder="搜索名称、描述、色号、备注"/>
      </div>
      ${mode === 'all' ? html`
        <div class="pad-x"><${Segmented} value=${sort} onChange=${setSort} items=${SORTS[side]}/></div>` : null}

      ${needVision.length ? html`
        <div class="pad-x">
          <${Button} full variant="ghost" icon="sparkle" onClick=${() => recognizeAsk(needVision.map(r => r.id))}>
            ${`识图整理这 ${needVision.length} 件（调用 ${needVision.length} 次识图接口）`}
          <//>
        </div>` : null}

      ${shown.length ? html`<${Grid} items=${shown} onOpen=${open}/>`
      : html`<${EmptyState} icon="hanger" title=${rows.length ? '没有符合条件的' : '这里还是空的'}
          desc=${rows.length ? '可调整筛选条件或搜索词。' : '点右上角的加号添加。'}/>`}

      <${FilterSheet} open=${filtering} side=${side} value=${f} onChange=${setF} onClose=${() => setFiltering(false)}/>
      <${AddSheet} open=${adding} owner=${owner} side=${side} group=${groupId} onClose=${() => setAdding(false)}/>
    <//>`;
}
