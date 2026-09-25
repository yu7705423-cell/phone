import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Field, Input, Textarea, NumberInput, Segmented, Button, Icon, EmptyState,
         toast, confirm, prompt } from '../../ui/index.js';
import { Photo, ChipSet } from './parts.js';
import { LoanPart, MemoryPart, UseSheet } from './ItemExtras.js';

const { db, nav, closet, intent } = phone;
const K = closet.kinds;

// 一件东西的全部。每一栏改了就存，没有「保存」按钮。
// 妆台多一段：容量与用量算余量，三种日期算保质期（算法在 system/closet.js）

const pad = n => String(n).padStart(2, '0');
const dayOf = ms => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const msOf = key => {
  if (!key) return 0;
  const [y, m, d] = key.split('-').map(Number);
  return y ? new Date(y, (m || 1) - 1, d || 1).getTime() : 0;
};

const BASIS = { set: '按填写的保质日期', opened: '按开封日期加开封后可用月数', bought: '按购入日期加未开封保质期' };

function BeautyPart({ item, set }) {
  const rem = closet.remaining(item);
  const exp = closet.expiry(item);
  const meta = closet.subMeta(item.group, item.sub);
  const recal = async () => {
    const v = await prompt({ title: '现在大约还剩百分之几', value: String(rem ? rem.pct : 100), placeholder: '0 至 100' });
    if (v == null || v === '') return;
    closet.calibrate(item.id, v);
    toast('已按实际剩余校准');
  };
  return html`
    <div class="cl-section">妆台</div>
    ${meta.shade || item.shade ? html`
      <${Field} label="色号">
        <${Input} value=${item.shade} onInput=${v => set({ shade: v })} placeholder="例如 01 奶茶色"/>
      <//>` : null}

    <${Field} label="容量" desc="整瓶或整盒的量。面膜这类按片计。">
      <div class="cl-inline">
        <${NumberInput} value=${item.capacity || ''} step=${0.1} placeholder="未填" onChange=${v => set({ capacity: v })}/>
        <${Segmented} value=${item.capUnit || '毫升'} onChange=${v => set({ capUnit: v })}
          items=${K.CAP_UNITS.map(u => ({ value: u, label: u }))}/>
      </div>
    <//>
    <${Field} label="每次用量" desc="例如粉底 2 泵、香水 2 喷。单位换算为毫升的比例可在下方修改。">
      <div class="cl-inline">
        <${NumberInput} value=${item.dose || ''} step=${0.1} placeholder="未填" onChange=${v => set({ dose: v })}/>
      </div>
      <div class="chip-row">
        ${K.DOSE_UNITS.map(u => html`
          <button key=${u} class=${`chip${item.doseUnit === u ? ' is-active' : ''}`}
            onClick=${() => set({ doseUnit: u })}>${u}</button>`)}
      </div>
    <//>
    <${Field} label="每天用几次">
      <${NumberInput} value=${item.perDay || ''} step=${0.5} placeholder="未填" unit="次" onChange=${v => set({ perDay: v })}/>
    <//>
    ${item.doseUnit && !['毫升', '克', '片', '次'].includes(item.doseUnit) ? html`
      <${Field} label=${`每 1 ${item.doseUnit}约多少毫升`}
        desc=${`留空按默认 ${K.DOSE[item.doseUnit]} 毫升计。不同产品差别较大，可按实际填写。`}>
        <${NumberInput} value=${item.mlPer || ''} step=${0.05} placeholder=${String(K.DOSE[item.doseUnit])} unit="毫升"
          onChange=${v => set({ mlPer: v })}/>
      <//>` : null}

    <div class="cl-readout">
      ${rem ? html`
        <div class="cl-meter is-big"><i style=${`--pct:${rem.pct}%`}></i></div>
        <div>约剩 ${rem.pct}%，按当前用量约 ${rem.daysLeft} 天用完。</div>
        <button class="nav-text press" onClick=${recal}>按实际剩余校准</button>`
      : html`<div class="field-desc">填写容量、每次用量与每天次数后，自动估算余量。</div>`}
    </div>

    <${Field} label="购入日期"><${Input} type="date" value=${item.buyAt} onInput=${v => set({ buyAt: v })}/><//>
    <${Field} label="开封日期"><${Input} type="date" value=${item.openedAt} onInput=${v => set({ openedAt: v })}/><//>
    <${Field} label="开封后可用" desc="包装上开盖图标里的数字，例如 12M。按小类预先填好，可以修改。">
      <${NumberInput} value=${item.pao || ''} placeholder="未填" unit="个月" onChange=${v => set({ pao: v })}/>
    <//>
    <${Field} label="保质期至" desc="填写后以此为准。">
      <${Input} type="date" value=${item.expireAt} onInput=${v => set({ expireAt: v })}/>
    <//>
    ${item.buyAt && !item.openedAt && !item.expireAt ? html`
      <${Field} label="未开封保质期" desc=${`留空按 ${K.SHELF_MONTHS} 个月计。`}>
        <${NumberInput} value=${item.shelf || ''} placeholder=${String(K.SHELF_MONTHS)} unit="个月" onChange=${v => set({ shelf: v })}/>
      <//>` : null}
    <div class="cl-readout">
      ${exp ? html`<div>${exp.daysLeft < 0 ? `已于 ${dayOf(exp.at)} 过期` : `${dayOf(exp.at)} 过期，还有 ${exp.daysLeft} 天`}（${BASIS[exp.basis]}）。</div>`
      : html`<div class="field-desc">填写保质日期、开封日期或购入日期中的任意一项后，自动估算保质期。</div>`}
    </div>`;
}

function SourcePart({ item, set }) {
  const chars = db.characters.all().filter(c => !c.parentId);
  const whoList = item.owner === closet.ME
    ? chars.map(c => ({ id: c.id, label: phone.remark.nameOf(c) }))
    : [{ id: closet.ME, label: '我' }, ...chars.filter(c => c.id !== item.owner).map(c => ({ id: c.id, label: phone.remark.nameOf(c) }))];
  return html`
    <${Field} label="来源">
      <${Segmented} value=${item.source || 'self'} onChange=${v => set({ source: v })}
        items=${K.SOURCES.map(s => ({ value: s.id, label: s.label }))}/>
    <//>
    ${item.source === 'gift' ? html`
      <${Field} label="谁送的">
        <${ChipSet} list=${whoList} value=${item.giver} multi=${false} onChange=${v => set({ giver: v })}/>
      <//>
      <${Field} label="收到的日期">
        <${Input} type="date" value=${dayOf(item.giftAt)} onInput=${v => set({ giftAt: msOf(v) })}/>
      <//>
      ${item.giftChatId ? html`
        <div class="cl-row-btn"><${Button} size="sm" variant="ghost" icon="gift"
          onClick=${() => intent.open('chat', { route: `/chat/${item.giftChatId}`, back: true })}>查看送礼物的那段对话<//></div>` : null}` : null}
    ${item.source === 'made' ? html`
      <${Field} label="和谁一起做的">
        <${ChipSet} list=${whoList} value=${item.with} multi=${false} onChange=${v => set({ with: v })}/>
      <//>` : null}`;
}

export function ItemPage({ id }) {
  useStore(db.closet.store);
  useStore(db.characters.store);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [using, setUsing] = useState(false);
  const item = db.closet.get(id);
  if (!item) {
    return html`<${Page} title="衣帽间" onBack=${nav.pop}><${EmptyState} title="这件东西已不在了"/><//>`;
  }
  const set = patch => closet.update(id, patch);
  const wearing = item.wornOn === closet.today();
  const side = item.side;

  const run = async (what, fn, done) => {
    setBusy(what);
    try { await fn(); toast(done, 'ok'); }
    catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(''); }
  };
  const pickFile = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) await run('img', () => closet.setImage(id, f), '已更换图片');
  };
  const del = async () => {
    if (!await confirm({ title: `删除「${item.name}」`, message: '删除后不可恢复。已用完或已送出的东西，可以改状态而不删除。', danger: true, okText: '删除' })) return;
    closet.remove(id);
    nav.pop();
  };

  return html`
    <${Page} title=${item.name || '未命名'} onBack=${nav.pop}>
      <${Photo} item=${item}/>
      <div class="cl-acts">
        <${Button} size="sm" variant="ghost" icon="camera" disabled=${!!busy}
          onClick=${() => fileRef.current?.click()}>${item.imageId ? '更换图片' : '添加图片'}<//>
        ${item.imageId ? html`
          <${Button} size="sm" variant="ghost" icon="sparkle" disabled=${!!busy}
            onClick=${() => run('vision', () => closet.ai.recognize(id), '已识别，已填写空着的几项')}>
            ${busy === 'vision' ? '识图中' : '识图（1 次）'}<//>` : null}
        <${Button} size="sm" variant="ghost" icon="image" disabled=${!!busy}
          onClick=${() => run('draw', () => closet.ai.draw(id), '已生成图片')}>
          ${busy === 'draw' ? '生成中' : '按描述生成图片（1 次）'}<//>
        ${side === 'wear' ? html`
          <${Button} size="sm" variant=${wearing ? 'primary' : 'ghost'} icon="check"
            onClick=${() => closet.wear(id, !wearing)}>${wearing ? (closet.isCarry(item) ? '今天带着' : '今天穿着') : (closet.isCarry(item) ? '今天带' : '今天穿')}<//>` : null}
        <${Button} size="sm" variant="ghost" icon="message" onClick=${() => setUsing(true)}>在会话中使用<//>
      </div>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${pickFile} style="display:none"/>

      <div class="cl-form">
      <${Field} label="名称"><${Input} value=${item.name} onInput=${v => set({ name: v })}/><//>
      <${Field} label="描述" desc="材质、版型、颜色与细节。识图会填写这一栏；角色读到的是名称与分类，今天穿着的还会读到描述。">
        <${Textarea} rows=${3} value=${item.desc} onInput=${v => set({ desc: v })}/>
      <//>

      <div class="cl-section">分类</div>
      <${Field} label="放在">
        <${Segmented} value=${side} onChange=${v => set({ side: v, group: '', sub: '' })}
          items=${K.SIDES.map(s => ({ value: s.id, label: s.label }))}/>
        <div class="chip-row">
          ${closet.groupsOf(side).map(g => html`
            <button key=${g.id} class=${`chip${item.group === g.id ? ' is-active' : ''}`}
              onClick=${() => set({ group: g.id, sub: '' })}>${g.label}</button>`)}
        </div>
      <//>
      ${item.group ? html`
        <${Field} label="小类">
          <div class="chip-row">
            ${closet.subsOf(item.group).map(s => html`
              <button key=${s.label} class=${`chip${item.sub === s.label ? ' is-active' : ''}`}
                onClick=${() => set({ sub: item.sub === s.label ? '' : s.label })}>${s.label}</button>`)}
          </div>
        <//>` : null}

      <${Field} label="颜色"><${ChipSet} list=${K.COLORS} value=${item.colors} swatch=${true} onChange=${v => set({ colors: v })}/><//>
      ${side === 'wear' ? html`
        <${Field} label="季节"><${ChipSet} list=${K.SEASONS} value=${item.seasons} onChange=${v => set({ seasons: v })}/><//>
        <${Field} label="场合"><${ChipSet} list=${K.OCCASIONS} value=${item.occasions} onChange=${v => set({ occasions: v })}/><//>` : null}
      <${Field} label="状态" desc="已用完、已送出的东西默认不显示，也不会告诉角色，但仍然保留。">
        <${ChipSet} list=${K.STATES} value=${item.state || ''} multi=${false} onChange=${v => set({ state: v })}/>
      <//>

      ${side === 'beauty' ? html`<${BeautyPart} item=${item} set=${set}/>` : null}

      <${LoanPart} item=${item}/>
      <${MemoryPart} item=${item}/>

      <div class="cl-section">来历</div>
      <${SourcePart} item=${item} set=${set}/>
      <${Field} label="备注" desc="仅自己可见。例如在哪里买的、哪一天第一次穿。">
        <${Textarea} rows=${2} value=${item.note} onInput=${v => set({ note: v })}/>
      <//>

      ${side === 'wear' && item.wornCount ? html`
        <div class="settings-foot">穿过 ${item.wornCount} 次，最近一次是 ${dayOf(item.lastWorn)}。</div>` : null}

      </div>
      <div class="pad">
        <${Button} full variant="ghost" icon="trash" onClick=${del}>删除<//>
      </div>
      <${UseSheet} item=${item} open=${using} onClose=${() => setUsing(false)}/>
    <//>`;
}
