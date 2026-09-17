import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Button, Icon, Spinner,
         Sheet, EmptyState, toast, prompt } from '../../ui/index.js';

const { db, nav, ai } = phone;
const card = ai.card;

const COUNTS = [2, 4, 6, 8].map(v => ({ value: v, label: `${v} 个` }));

// 关联角色：手动挑一个连上，或者让模型一次生成一批。
export function NpcPage({ id }) {
  useStore(db.characters.store);
  const char = db.characters.get(id);
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(null);
  const [off, setOff] = useState(new Set());
  const [picking, setPicking] = useState(false);

  if (!char) {
    return html`<${Page} title="关联角色" onBack=${nav.pop}>
      <${EmptyState} title="该角色已被删除"/><//>`;
  }

  const linked = new Set(card.relationsOf(id).map(r => r.charId));
  const others = db.characters.all().filter(c => c.id !== id && !linked.has(c.id));

  const gen = async () => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    setBusy(true); setRows(null); setOff(new Set());
    try {
      const r = await card.generateNpcs(id, count);
      setRows(r);
      toast(`已生成 ${r.length} 个`, 'ok');
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  const save = () => {
    const keep = rows.filter((_, i) => !off.has(i));
    if (!keep.length) { toast('尚未勾选任何角色'); return; }
    const made = card.commitNpcs(id, keep);
    toast(`已添加 ${made.length} 个`, 'ok');
    nav.pop();
  };

  const manual = async other => {
    setPicking(false);
    const label = await prompt({
      title: `在 ${char.name} 看来，${other.name} 是什么关系`,
      placeholder: '例如 妈妈 / 室友 / 前男友',
    });
    if (label === null) return;
    const back = await prompt({
      title: `反过来，在 ${other.name} 看来，${char.name} 是什么关系`,
      placeholder: '例如 女儿 / 室友 / 前女友',
      value: '',
    });
    if (back === null) return;
    card.link(id, other.id, (label || '').trim(), (back || '').trim() || (label || '').trim());
    toast('已建立关联', 'ok');
  };

  const cut = r => {
    card.unlink(id, r.charId);
    toast('已解除关联');
  };

  const rels = card.relationsOf(id);

  return html`
    <${Page} title="关联角色" onBack=${nav.pop}>
      ${rows ? html`
        <div class="hint-box">
          写出 ${rows.length} 个，勾掉不要的再存。存进去之后它们就是独立的角色，
          也能单独聊天。
        </div>
        <${List}>
          ${rows.map((n, i) => html`
            <${ListItem} key=${i} multiline
              title=${`${n.name}　${n.relation}`}
              subtitle=${`${[n.age, n.gender, n.birthday].filter(Boolean).join(' · ')}${n.signature ? '\n' + n.signature : ''}\n${n.persona}`}
              right=${html`<${Icon} name=${off.has(i) ? 'close' : 'check'} size=${17}/>`}
              class=${off.has(i) ? 'is-off' : ''}
              onClick=${() => setOff(s => {
                const next = new Set(s);
                next.has(i) ? next.delete(i) : next.add(i);
                return next;
              })}/>`)}
        <//>
        <div class="pad batch-acts">
          <${Button} onClick=${save}>存入 ${rows.length - off.size} 个<//>
          <${Button} variant="ghost" onClick=${() => setRows(null)}>重来<//>
        </div>
      ` : html`
        <${List} title=${`已经连上 · ${rels.length}`}>
          ${rels.map(r => {
            const other = db.characters.get(r.charId);
            return html`
              <${ListItem} key=${r.charId} title=${other?.name || '已删除'} subtitle=${r.label} multiline
                left=${html`<${Icon} name="user" size=${18}/>`}
                right=${html`<button class="press li-cut" onClick=${e => { e.stopPropagation(); cut(r); }}>
                  <${Icon} name="close" size=${15}/></button>`}/>`;
          })}
          <${ListItem} title="手动添加关联" subtitle=${`从已有的 ${others.length} 个角色中选择`} arrow multiline
            left=${html`<${Icon} name="plus" size=${18}/>`}
            onClick=${() => others.length ? setPicking(true) : toast('没有可关联的其他角色')}/>
        <//>

        <${List} title="批量生成">
          <${ListItem} title="围绕该角色批量生成" multiline
            subtitle="可能包含家人、同学、旧识、对手等。生成结果先行展示，取消勾选后再保存"/>
        <//>
        <div class="pad">
          <${Segmented} value=${count} items=${COUNTS} onChange=${setCount}/>
        </div>
        <div class="pad">
          <${Button} full disabled=${busy} onClick=${gen}>
            ${busy ? html`<${Spinner} size=${15}/> 正在写` : `生成 ${count} 个`}
          <//>
        </div>
      `}

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="选择要关联的角色" height="70%">
        <${List} inset=${false}>
          ${others.map(c => html`
            <${ListItem} key=${c.id} title=${c.name} subtitle=${c.signature || ''} multiline arrow
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => manual(c)}/>`)}
        <//>
      <//>
    <//>`;
}
