import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Sheet, Button, IconButton, Field, Input, NumberInput, Icon, EmptyState,
         toast, confirm, prompt } from '../../ui/index.js';
import { Thumb, Grid, ownerNow, ownerName } from './parts.js';

const { db, nav, closet, intent } = phone;
const K = closet.kinds;

// 套装（ARCHITECTURE 4.214）。几件单品存成一套：自己搭的、角色在会话里替你搭的、
// 你在角色的衣帽间里替它挑的。一套可以「今天穿这套」，角色的那一套可以发到会话里

const byName = by => (by && by !== closet.ME
  ? `${phone.remark.nameOf(db.characters.get(by)) || '角色'}搭配` : '');

/** 一套的格子：前四件拼成一块，下面是名字 */
function OutfitCard({ outfit }) {
  const rows = closet.outfitItems(outfit);
  const shown = rows.slice(0, 4);
  const who = byName(outfit.by);
  return html`
    <button class="cl-group press" onClick=${() => nav.push(`/outfit/${outfit.id}`)}>
      <div class=${`cl-mosaic n${shown.length}`}>
        ${shown.map(r => html`<${Thumb} key=${r.id} item=${r}/>`)}
        ${shown.length ? null : html`<span class="cl-mosaic-empty"><${Icon} name="layers" size=${20}/></span>`}
      </div>
      <div class="cl-group-foot"><b class="ellipsis">${outfit.name}</b><span>${rows.length}</span></div>
      ${who ? html`<div class="cl-fit-by ellipsis">${who}</div>` : null}
    </button>`;
}

/** 从衣橱里挑几件。value 是 id 列表 */
export function PickSheet({ open, owner, title, value, onDone, onClose }) {
  useStore(db.closet.store);
  const [picked, setPicked] = useState(value || []);
  useEffect(() => { if (open) setPicked(value || []); }, [open]);
  if (!open) return null;
  const rows = closet.itemsOf(owner).filter(r => r.side === 'wear' && r.group && closet.live(r));
  const groups = closet.groupsOf('wear').filter(g => rows.some(r => r.group === g.id));
  const has = id => picked.includes(id);
  const tap = id => setPicked(has(id) ? picked.filter(x => x !== id) : [...picked, id]);
  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${title} height="86%">
      ${groups.length ? groups.map(g => html`
        <div key=${g.id} class="cl-today-group">
          <div class="cl-filter-label">${g.label}</div>
          <div class="cl-today-row">
            ${rows.filter(r => r.group === g.id).map(r => html`
              <button key=${r.id} class=${`cl-today-pick press${has(r.id) ? ' is-on' : ''}`} onClick=${() => tap(r.id)}>
                <${Thumb} item=${r}/>
                <span class="ellipsis">${r.name}</span>
                ${has(r.id) ? html`<i class="cl-tick"><${Icon} name="check" size=${12}/></i>` : null}
              </button>`)}
          </div>
        </div>`)
      : html`<div class="settings-foot">衣橱里还没有分好类的衣物。</div>`}
      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${onClose}>取消<//>
        <${Button} disabled=${!picked.length} onClick=${() => onDone(picked)}>${`完成（${picked.length} 件）`}<//>
      </div>
    <//>`;
}

export function OutfitsPage() {
  useStore(db.closet.store);
  useStore(db.settings.store);
  const [picking, setPicking] = useState(false);
  const owner = ownerNow();
  const list = closet.outfitsOf(owner);
  const make = async ids => {
    setPicking(false);
    const name = await prompt({ title: '这一套的名称', placeholder: '例如 周末出门' });
    if (name == null) return;
    const o = closet.createOutfit({ owner, name, items: ids });
    nav.push(`/outfit/${o.id}`);
  };
  return html`
    <${Page} title=${owner === closet.ME ? '套装' : `${ownerName(owner)}的套装`} onBack=${nav.pop}
      right=${html`<${IconButton} name="plus" label="新建" onClick=${() => setPicking(true)}/>`}>
      ${list.length ? html`
        <div class="cl-groups">${list.map(o => html`<${OutfitCard} key=${o.id} outfit=${o}/>`)}</div>`
      : html`<${EmptyState} icon="layers" title="还没有套装"
          desc=${owner === closet.ME
            ? '点右上角的加号从衣橱里挑几件存成一套，或在「今天穿的」中存为套装。角色在会话中搭配的一套也可以存到这里。'
            : '点右上角的加号从该角色的衣橱里挑几件存成一套，存好后可以发送到与该角色的会话。'}/>`}
      <${PickSheet} open=${picking} owner=${owner} title="挑选单品" value=${[]}
        onDone=${make} onClose=${() => setPicking(false)}/>
    <//>`;
}

export function OutfitPage({ id }) {
  useStore(db.closet.store);
  useStore(db.characters.store);
  const [picking, setPicking] = useState(false);
  const o = db.closet.get(id);
  if (!closet.isOutfit(o)) {
    return html`<${Page} title="套装" onBack=${nav.pop}><${EmptyState} title="这一套已不在了"/><//>`;
  }
  const rows = closet.outfitItems(o);
  const gone = (o.items || []).length - rows.length;
  const wearing = o.wornOn === closet.today();
  const who = byName(o.by);

  const rename = async () => {
    const v = await prompt({ title: '这一套的名称', value: o.name });
    if (v != null && v.trim()) closet.update(id, { name: v.trim().slice(0, 40) });
  };
  const send = () => {
    try { closet.sendOutfit(id); toast(`已发送到与${ownerName(o.owner)}的会话`, 'ok'); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };
  const del = async () => {
    if (!await confirm({ title: `删除「${o.name}」`, message: '只删除这一套的组合，里面的单品保留。', danger: true, okText: '删除' })) return;
    closet.remove(id);
    nav.pop();
  };

  return html`
    <${Page} title=${o.name} onBack=${nav.pop}
      right=${html`<${IconButton} name="edit" label="改名" onClick=${rename}/>`}>
      <div class="cl-acts">
        <${Button} size="sm" variant=${wearing ? 'primary' : 'ghost'} icon="check"
          onClick=${() => { closet.wearOutfit(id); toast(`今天穿的已换成「${o.name}」`, 'ok'); }}>
          ${wearing ? '今天穿着这一套' : '今天穿这一套'}<//>
        <${Button} size="sm" variant="ghost" icon="layers" onClick=${() => setPicking(true)}>调整单品<//>
        ${o.owner !== closet.ME ? html`
          <${Button} size="sm" variant="ghost" icon="send" onClick=${send}>发给${ownerName(o.owner)}<//>` : null}
      </div>
      ${rows.length ? html`<${Grid} items=${rows} onOpen=${r => nav.push(`/item/${r.id}`)}/>`
        : html`<${EmptyState} icon="layers" title="这一套里没有单品" desc="点「调整单品」从衣橱里挑选。"/>`}
      <div class="settings-foot">
        ${[
          who ? `${who}。` : '',
          gone > 0 ? `有 ${gone} 件已从衣帽间删除，不再显示。` : '',
          o.wornCount ? `穿过 ${o.wornCount} 次。` : '',
          '「今天穿这一套」会把今天穿的换成这几件。',
        ].join('')}
      </div>
      ${o.fromChatId ? html`
        <div class="cl-row-btn pad-x"><${Button} size="sm" variant="ghost" icon="message"
          onClick=${() => intent.open('chat', { route: `/chat/${o.fromChatId}`, back: true })}>查看搭配时的那段对话<//></div>` : null}
      <div class="pad">
        <${Button} full variant="ghost" icon="trash" onClick=${del}>删除这一套<//>
      </div>
      <${PickSheet} open=${picking} owner=${o.owner} title="调整单品" value=${rows.map(r => r.id)}
        onDone=${ids => { closet.update(id, { items: ids }); setPicking(false); }}
        onClose=${() => setPicking(false)}/>
    <//>`;
}

/** 会话里的搭配卡片点「存为套装」进来：存过就打开那一套，没存过就存一套再打开 */
export function FromCard({ msgId }) {
  useEffect(() => {
    const msg = db.messages.get(msgId);
    const o = closet.keepOutfit(msg);
    if (!o) { toast('这一套里没有能在衣帽间中找到的单品'); nav.replace('/'); return; }
    db.settings.set({ closetOwner: o.owner, closetSide: 'wear' });
    nav.replace(`/outfit/${o.id}`);
  }, [msgId]);
  return html`<${Page} title="衣帽间" onBack=${nav.pop}><div class="settings-foot">正在存为套装。</div><//>`;
}

/**
 * 按角色设定生成一批（一次调用）。结果先列出来，勾选后再放进去 ——
 * 第 6 条那个例外：东西还没入库，不看内容没法判断
 */
export function GeneratePage() {
  useStore(db.settings.store);
  const owner = ownerNow();
  const side = db.settings.get().closetSide === 'beauty' ? 'beauty' : 'wear';
  const [count, setCount] = useState(20);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(null);
  const [off, setOff] = useState(new Set());
  if (owner === closet.ME) {
    return html`<${Page} title="生成" onBack=${nav.pop}><${EmptyState} title="只能为角色生成"/><//>`;
  }
  const run = async () => {
    setBusy(true);
    try {
      const out = await closet.ai.wardrobe(owner, { count, side });
      setRows(out);
      setOff(new Set());
      if (!out.length) toast('没有生成可用的条目，可以再试一次', 'error');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };
  const flip = i => { const n = new Set(off); if (n.has(i)) n.delete(i); else n.add(i); setOff(n); };
  const keep = () => {
    const made = closet.ai.keepWardrobe(owner, rows.filter((_, i) => !off.has(i)));
    toast(`已放入 ${made.length} 件`, 'ok');
    nav.pop();
  };
  const groupLabel = r => [K.groupOf(r.group)?.label, r.sub].filter(Boolean).join(' / ');
  const kept = rows ? rows.length - off.size : 0;

  return html`
    <${Page} title=${`生成${ownerName(owner)}的${K.sideOf(side).label}`} onBack=${nav.pop}>
      <div class="cl-form">
        <${Field} label="生成多少件" desc="按角色卡的设定生成名称、分类、颜色与描述，只有文字。需要图片时，可在单品页逐件生成。">
          <${NumberInput} value=${count} min=${1} unit="件" onChange=${v => setCount(v || 1)}/>
        <//>
        <${Button} full icon="sparkle" disabled=${busy} onClick=${run}>
          ${busy ? '生成中' : rows ? '重新生成（调用 1 次接口）' : '生成（调用 1 次接口）'}<//>
      </div>
      ${rows && rows.length ? html`
        <div class="settings-foot">点一下取消勾选。已存在的同名条目不会重复生成。</div>
        <div class="cl-gen">
          ${rows.map((r, i) => html`
            <button key=${i} class=${`cl-gen-row press${off.has(i) ? '' : ' is-on'}`} onClick=${() => flip(i)}>
              <i class="cl-tick"><${Icon} name=${off.has(i) ? 'plus' : 'check'} size=${12}/></i>
              <div class="cl-gen-body">
                <b>${r.name}</b>
                <span>${groupLabel(r)}</span>
                ${r.desc ? html`<em>${r.desc}</em>` : null}
              </div>
            </button>`)}
        </div>
        <div class="pad">
          <${Button} full disabled=${!kept} onClick=${keep}>${`放进衣帽间（${kept} 件）`}<//>
        </div>` : null}
    <//>`;
}
