import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Sheet, Button, Field, Input, NumberInput, Segmented,
         Switch, Icon, IconButton, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, events } = phone;

const RARITY_ITEMS = events.RARITIES.map(r => ({ value: r.id, label: r.label }));
const BLANK = { id: '', text: '', rarity: 'common', weight: 1, off: false };

function Editor({ open, domain, tone, item, onClose }) {
  const [cur, setCur] = useState(BLANK);
  useEffect(() => { if (open) setCur(item ? { ...BLANK, ...item } : BLANK); }, [open, item]);
  const set = patch => setCur(c => ({ ...c, ...patch }));

  const save = () => {
    try {
      if (cur.id) events.update(cur.id, cur);
      else events.add({ domain, tone, rarity: cur.rarity, text: cur.text, weight: cur.weight });
      onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title=${item ? '编辑词条' : '添加词条'}>
      <div class="pad">
        <${Field} label="事件"
          desc="一句话，写事情本身。不写心情，不写是谁。抽中后它会落到某个角色的那一天。">
          <${Input} value=${cur.text} onInput=${v => set({ text: v })}
            placeholder="例如：地铁误点了二十分钟"/>
        <//>
        <${Field} label="分量"
          desc=${events.RARITIES.map(r => `${r.label}：${r.hint}`).join('；') + '。'
            + '少见的词条与平常的词条待在同一格，只是被抽中的机会小一个量级。'}>
          <${Segmented} value=${cur.rarity} items=${RARITY_ITEMS}
            onChange=${v => set({ rarity: v })}/>
        <//>
        <${Field} label="权重"
          desc="在同分量的词条之间再调一次。数值越大越容易被抽中，填 1 表示不作调整。">
          <${NumberInput} unit="倍" min=${1} value=${cur.weight}
            onChange=${v => set({ weight: v })}/>
        <//>
        <div class="pad-t">
          <${Button} full onClick=${save}>保存<//>
        </div>
      </div>
    <//>`;
}

export function CellPage({ domain, tone }) {
  useStore(db.events.store);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const d = events.domainOf(domain);
  const t = events.toneOf(tone);
  const list = (d && t) ? events.list({ domain, tone }) : [];

  if (!d || !t) {
    return html`
      <${Page} title="词条" onBack=${nav.pop}>
        <${EmptyState} icon="layers" title="没有这一格"/>
      <//>`;
  }

  const del = async e => {
    if (!await confirm({ title: '删除词条', message: `将删除「${e.text}」。`, danger: true })) return;
    events.remove(e.id);
  };

  const sub = e => {
    const bits = [events.rarityOf(e.rarity).label];
    if ((e.weight || 1) !== 1) bits.push(`权重 ${e.weight}`);
    if (e.off) bits.push('已停用');
    return bits.join(' · ');
  };

  return html`
    <${Page} title=${`${d.label} · ${t.label}`} onBack=${nav.pop}
      right=${html`<${IconButton} name="plus" label="添加"
        onClick=${() => { setEditing(null); setOpen(true); }}/>`}>

      ${list.length ? html`
        <div class="pad-x pad-t">
          <div class="hint-box">${d.label}：${d.hint}。${t.label}：${t.hint}。共 ${list.length} 条。</div>
        </div>
        <${List}>
          ${list.map(e => html`
            <${ListItem} key=${e.id} title=${e.text} subtitle=${sub(e)} multiline
              left=${html`<${Icon} name=${e.off ? 'close' : 'sparkle'} size=${18}/>`}
              right=${html`
                <${Switch} checked=${!e.off}
                  onChange=${v => events.update(e.id, { off: !v })}/>
                <${IconButton} name="trash" size=${17} label="删除"
                  onClick=${ev => { ev.stopPropagation(); del(e); }}/>`}
              onClick=${() => { setEditing(e); setOpen(true); }}/>`)}
        <//>
        <div class="settings-foot">
          关掉的词条留在库里但不参与抽取。删除后无法恢复。
        </div>`
      : html`<${EmptyState} icon="sparkle" title="这一格还是空的"
          desc=${`${d.label}：${d.hint}。${t.label}：${t.hint}。`}
          action=${html`<${Button} size="sm"
            onClick=${() => { setEditing(null); setOpen(true); }}>添加词条<//>`}/>`}

      <${Editor} open=${open} domain=${domain} tone=${tone} item=${editing}
        onClose=${() => { setOpen(false); setEditing(null); }}/>
    <//>`;
}
