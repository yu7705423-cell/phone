import { html } from '../../lib.js';
import { phone, useThumb, useImage } from '../../sdk/index.js';
import { Avatar, Icon, Sheet, Button, Switch } from '../../ui/index.js';

const { db, closet } = phone;
const K = closet.kinds;

// 衣帽间几页共用的小件：色块、单品格子、「我 / 角色」切换、筛选。见 ARCHITECTURE 4.213

/** 一块颜色。颜色值在分类表里（closet-kinds.js 的 COLORS），走 --sw，不写死在样式表 */
export const Swatch = ({ id, size = 'sm' }) => {
  const c = K.COLORS.find(x => x.id === id);
  return c ? html`<span class=${`cl-sw cl-sw-${size}`} style=${`--sw:${c.sw}`} title=${c.label}></span>` : null;
};

/** 没有图的东西画什么：第一种颜色铺满，没有颜色就是一个图标 */
function Blank({ item }) {
  const c = K.COLORS.find(x => x.id === (item.colors || [])[0]);
  return c
    ? html`<div class="cl-blank" style=${`--sw:${c.sw}`}></div>`
    : html`<div class="cl-blank is-empty"><${Icon} name=${item.side === 'beauty' ? 'sparkle' : 'hanger'} size=${22}/></div>`;
}

export function Thumb({ item }) {
  const url = useThumb(item.imageId);
  return url
    ? html`<div class="cl-thumb" style=${`--img:url(${url})`}></div>`
    : html`<${Blank} item=${item}/>`;
}

/** 大图。单品页顶上那一块 */
export function Photo({ item }) {
  const url = useImage(item.imageId);
  return url
    ? html`<div class="cl-photo" style=${`--img:url(${url})`}></div>`
    : html`<div class="cl-photo is-blank"><${Blank} item=${item}/></div>`;
}

/** 单品格子：图、名字，右上角几个小记号（今天穿着、礼物、快用完） */
export function ItemCard({ item, onOpen }) {
  const wearing = item.wornOn === closet.today();
  const f = closet.flagsOf(item);
  const rem = item.side === 'beauty' ? closet.remaining(item) : null;
  const gone = !closet.live(item);
  return html`
    <button class=${`cl-card press${gone ? ' is-gone' : ''}`} onClick=${() => onOpen(item)}>
      <${Thumb} item=${item}/>
      <div class="cl-card-name ellipsis">${item.name}</div>
      <div class="cl-card-marks">
        ${wearing ? html`<span class="cl-mark is-on" title="今天穿着"><${Icon} name="check" size=${10}/></span>` : null}
        ${item.source === 'gift' ? html`<span class="cl-mark" title="礼物"><${Icon} name="gift" size=${10}/></span>` : null}
        ${f ? html`<span class="cl-mark is-warn" title="快用完或快过期"><${Icon} name="clock" size=${10}/></span>` : null}
      </div>
      ${rem ? html`<div class="cl-meter"><i style=${`--pct:${rem.pct}%`}></i></div>` : null}
    </button>`;
}

export const Grid = ({ items, onOpen }) => html`
  <div class="cl-grid">
    ${items.map(it => html`<${ItemCard} key=${it.id} item=${it} onOpen=${onOpen}/>`)}
  </div>`;

/** 现在看的是谁的衣帽间。角色被删了就回到自己 */
export function ownerNow() {
  const o = db.settings.get().closetOwner || closet.ME;
  return o === closet.ME || db.characters.get(o) ? o : closet.ME;
}
export const sideNow = () => (db.settings.get().closetSide === 'beauty' ? 'beauty' : 'wear');
export const ownerName = o => (o === closet.ME
  ? (phone.accounts.current()?.name || '我') : (phone.remark.nameOf(db.characters.get(o)) || '角色'));

function OwnerChip({ id, active }) {
  const c = id === closet.ME ? null : db.characters.get(id);
  const me = id === closet.ME ? phone.accounts.current() : null;
  const src = useImage(c ? c.avatar : me?.avatar);
  return html`
    <button class=${`cl-owner press${active ? ' is-active' : ''}`}
      onClick=${() => db.settings.set({ closetOwner: id })}>
      <${Avatar} src=${src} name=${c ? c.name : (me?.name || '我')} size=${24} radius=${12}/>
      <span>${id === closet.ME ? '我' : phone.remark.nameOf(c)}</span>
    </button>`;
}

/** 「我 / 某个角色」切换。只列主角色，小号不单独列 */
export function OwnerBar() {
  const now = ownerNow();
  const chars = db.characters.all().filter(c => !c.parentId);
  return html`
    <div class="cl-owners">
      <${OwnerChip} id=${closet.ME} active=${now === closet.ME}/>
      ${chars.map(c => html`<${OwnerChip} key=${c.id} id=${c.id} active=${now === c.id}/>`)}
    </div>`;
}

// ---- 筛选 ----

export const emptyFilter = () => ({ colors: [], seasons: [], occasions: [], source: '', showGone: false });
export const filterCount = f => f.colors.length + f.seasons.length + f.occasions.length
  + (f.source ? 1 : 0) + (f.showGone ? 1 : 0);

export function applyFilter(rows, f, q = '') {
  const text = String(q || '').trim().toLowerCase();
  return rows.filter(r => {
    if (!f.showGone && !closet.live(r)) return false;
    if (f.colors.length && !f.colors.some(c => (r.colors || []).includes(c))) return false;
    if (f.seasons.length && !f.seasons.some(c => (r.seasons || []).includes(c))) return false;
    if (f.occasions.length && !f.occasions.some(c => (r.occasions || []).includes(c))) return false;
    if (f.source && r.source !== f.source) return false;
    if (text && !`${r.name} ${r.desc || ''} ${r.sub || ''} ${r.shade || ''} ${r.note || ''}`.toLowerCase().includes(text)) return false;
    return true;
  });
}

/** 一组可多选的小块。swatch 为真时画色块 */
export function ChipSet({ list, value, onChange, multi = true, swatch = false }) {
  const has = id => (multi ? (value || []).includes(id) : value === id);
  const tap = id => {
    if (!multi) { onChange(has(id) ? '' : id); return; }
    const cur = value || [];
    onChange(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  };
  return html`
    <div class="chip-row">
      ${list.map(x => html`
        <button key=${x.id} class=${`chip${has(x.id) ? ' is-active' : ''}`} onClick=${() => tap(x.id)}>
          ${swatch ? html`<${Swatch} id=${x.id}/>` : null}${x.label}
        </button>`)}
    </div>`;
}

export function FilterSheet({ open, side, value, onChange, onClose }) {
  if (!open) return null;
  const set = patch => onChange({ ...value, ...patch });
  return html`
    <${Sheet} open=${true} onClose=${onClose} title="筛选" height="80%">
      <div class="cl-filter-label">颜色</div>
      <${ChipSet} list=${K.COLORS} value=${value.colors} swatch=${true} onChange=${v => set({ colors: v })}/>
      ${side === 'wear' ? html`
        <div class="cl-filter-label">季节</div>
        <${ChipSet} list=${K.SEASONS} value=${value.seasons} onChange=${v => set({ seasons: v })}/>
        <div class="cl-filter-label">场合</div>
        <${ChipSet} list=${K.OCCASIONS} value=${value.occasions} onChange=${v => set({ occasions: v })}/>` : null}
      <div class="cl-filter-label">来源</div>
      <${ChipSet} list=${K.SOURCES} value=${value.source} multi=${false} onChange=${v => set({ source: v })}/>
      <div class="cl-switch-row">
        <span>显示已用完、已送出的</span>
        <${Switch} checked=${value.showGone} onChange=${v => set({ showGone: v })}/>
      </div>
      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${() => onChange(emptyFilter())}>清除<//>
        <${Button} onClick=${onClose}>完成<//>
      </div>
    <//>`;
}
