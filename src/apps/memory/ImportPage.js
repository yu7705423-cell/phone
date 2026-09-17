import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Textarea, Button, Icon, Spinner,
         Segmented, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const { CATEGORIES } = ai.memory;
const imp = ai.memory.import;

// 粘一大段文字进来，拆成一条条记忆。拆分靠聊天模型，
// 存进去之后向量是自动补的（配了向量接口的话）。
export function ImportPage() {
  useStore(db.characters.store);
  useStore(db.settings.store);
  const [raw, setRaw] = useState('');
  const [charId, setCharId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const [items, setItems] = useState(null);
  const [off, setOff] = useState(new Set());

  const chars = db.characters.all();
  const owners = chars.map(c => ({ value: c.id, label: c.name }));


  const run = async () => {
    if (!raw.trim()) { toast('先粘点东西进来'); return; }
    if (!ai.isConfigured()) { toast('还没配聊天接口，拆不了', 'error', 4000); return; }
    setBusy(true); setItems(null); setOff(new Set());
    try {
      const r = await imp.parse(raw, {
        charId: charId || chars[0]?.id || null,
        onProgress: (i, n) => setProg(`${i} / ${n} 段`),
      });
      setItems(r.items);
      toast(r.items.length ? `拆出 ${r.items.length} 条` : '没拆出新东西，可能都已经有了',
        r.items.length ? 'ok' : 'plain', 4000);
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); setProg(null); }
  };

  const toggle = i => setOff(s => {
    const next = new Set(s);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const save = () => {
    const keep = items.filter((_, i) => !off.has(i));
    if (!keep.length) { toast('一条都没勾'); return; }
    const n = imp.commit(keep, charId || chars[0]?.id || null);
    toast(ai.services.embedReady()
      ? `存了 ${n} 条，正在后台补向量`
      : `存了 ${n} 条`, 'ok', 4000);
    nav.pop();
  };

  const vecHint = ai.services.embedReady()
    ? '存进去之后会自动补向量，之后就能按意思检索'
    : '还没配向量接口，存进去先按关键词用。以后配好了去「设置 - 向量」补齐';

  return html`
    <${Page} title="从文字导入" onBack=${nav.pop}>
      ${items ? html`
        <div class="hint-box">
          拆出 ${items.length} 条，勾掉不要的再存。${vecHint}
        </div>
        <${List}>
          ${items.map((it, i) => html`
            <${ListItem} key=${i} multiline
              title=${it.content}
              subtitle=${`${CATEGORIES[it.category] || it.category}${it.keywords.length ? ' · ' + it.keywords.join('、') : ''}`}
              left=${html`<span class=${`rank rank-${it.rank}`}>${it.rank}</span>`}
              right=${html`<${Icon} name=${off.has(i) ? 'close' : 'check'} size=${17}/>`}
              onClick=${() => toggle(i)}
              class=${off.has(i) ? 'is-off' : ''}/>`)}
        <//>
        <div class="pad batch-acts">
          <${Button} onClick=${save}>存入 ${items.length - off.size} 条<//>
          <${Button} variant="ghost" onClick=${() => setItems(null)}>重来<//>
        </div>
      ` : html`
        <div class="pad-x pad-t">
          <${Field} label="存给谁" desc="记忆只在和这个角色聊天时注入">
            ${owners.length ? html`
              <div class="chip-row">
                ${owners.map(o => html`
                  <button key=${o.value}
                    class=${`chip${(charId || chars[0]?.id) === o.value ? ' is-active' : ''}`}
                    onClick=${() => setCharId(o.value)}>${o.label}</button>`)}
              </div>` : html`<div class="li-hint">还没有角色，先去「联系」里建一个</div>`}
          <//>
          <${Field} label="粘贴内容"
            desc="从别处复制来的设定、经历、笔记都行。长文会自动分段处理">
            <${Textarea} rows=${12} value=${raw} onInput=${setRaw}
              placeholder="把一大段文字粘在这里…"/>
          <//>
        </div>
        <div class="pad">
          <${Button} full disabled=${busy || !raw.trim()} onClick=${run}>
            ${busy ? html`<${Spinner} size=${15}/> 正在拆 ${prog || ''}` : '开始整理'}
          <//>
        </div>
        <div class="settings-foot">
          拆分用的是聊天接口那个模型，不是向量接口 —— 向量接口只负责把文字变成向量。<br/>
          ${vecHint}
        </div>
      `}
    <//>`;
}
