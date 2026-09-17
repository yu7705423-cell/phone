import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Field, NumberInput, Segmented,
         Icon, Spinner, EmptyState, toast } from '../../ui/index.js';

const { db, nav, events, ai } = phone;
const batch = ai.eventBatch;

const RARITY_ITEMS = events.RARITIES.map(r => ({ value: r.id, label: r.label }));

const cellLabel = key => {
  const [d, t] = String(key).split(':');
  return `${events.domainOf(d)?.label || d} · ${events.toneOf(t)?.label || t}`;
};

// 批量生成。
//
// 一格一次调用，格子就是 领域 × 色彩。分格生成比一次要一大堆强得多：
// 同一次调用里混着好事和坏事，模型会不自觉地凑成对，
// 写出来的东西全是「虽然……但是……」。
//
// 生成结果先摆出来看一眼再决定存不存 —— 这是 CLAUDE.md 第 6 条里那个例外。
export function BatchPage() {
  useStore(db.events.store);
  const [plan, setPlan] = useState({});
  const [rarity, setRarity] = useState('common');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(null);
  const [rows, setRows] = useState(null);
  const [off, setOff] = useState(new Set());
  const [failed, setFailed] = useState([]);

  const counts = events.counts();
  const want = Object.values(plan).reduce((a, b) => a + (b || 0), 0);
  const cells = Object.values(plan).filter(v => v > 0).length;

  const set = (key, v) => setPlan(p => ({ ...p, [key]: v }));

  const run = async () => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    if (!want) { toast('请先填写要生成的条数'); return; }
    setBusy(true); setRows(null); setOff(new Set()); setFailed([]); setStep(null);
    try {
      const r = await batch.generatePlan(plan, { rarity, onStep: setStep });
      setRows(r.rows);
      setFailed(r.failed);
      toast(r.rows.length ? `已生成 ${r.rows.length} 条` : '没有新的词条，可能与库中已有内容重复',
        r.rows.length ? 'ok' : 'plain', 4000);
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setBusy(false); setStep(null); }
  };

  const save = () => {
    const keep = rows.filter((_, i) => !off.has(i));
    if (!keep.length) { toast('尚未勾选任何词条'); return; }
    const made = events.addMany(keep);
    toast(`已入库 ${made.length} 条`, 'ok');
    setRows(null); setOff(new Set()); setPlan({});
  };

  const toggle = i => setOff(s => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  // ---- 结果确认 ----
  if (rows) {
    const kept = rows.length - off.size;
    return html`
      <${Page} title="确认入库" onBack=${() => setRows(null)}
        right=${html`<button class="nav-text press" onClick=${save}>保存 ${kept}</button>`}>
        ${rows.length ? html`
          <div class="pad-x pad-t">
            <div class="hint-box">
              已自动排除与库中重复的内容。取消勾选的词条不会入库。
            </div>
          </div>
          <${List}>
            ${rows.map((r, i) => html`
              <${ListItem} key=${i} title=${r.text} multiline
                subtitle=${`${cellLabel(`${r.domain}:${r.tone}`)} · ${events.rarityOf(r.rarity).label}`}
                left=${html`
                  <span class=${`pick-dot${off.has(i) ? '' : ' is-on'}`}>
                    ${off.has(i) ? null : html`<${Icon} name="check" size=${11}/>`}
                  </span>`}
                onClick=${() => toggle(i)}/>`)}
          <//>
          <div class="pad">
            <${Button} full onClick=${save}>保存勾选的 ${kept} 条<//>
          </div>`
        : html`<${EmptyState} icon="sparkle" title="没有新的词条"
            desc="模型给出的内容与库中已有的重复，已全部排除。可再生成一次，或换一个格子。"/>`}
      <//>`;
  }

  // ---- 填表 ----
  return html`
    <${Page} title="批量生成" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          按领域与色彩分格生成。每个填了数的格子都是一次单独的接口调用，
          与聊天互不相干，不占对话的上下文。生成结果会先列出来，确认后再入库。
        </div>

        <div class="ev-grid">
          <div class="ev-head"></div>
          ${events.TONES.map(t => html`<div key=${t.id} class="ev-head">${t.label}</div>`)}
          ${events.DOMAINS.map(d => html`
            <div key=${d.id} class="ev-head is-row">${d.label}</div>
            ${events.TONES.map(t => {
              const key = events.cellKey(d.id, t.id);
              return html`
                <div key=${t.id} class="ev-input">
                  <${NumberInput} value=${plan[key] || 0} placeholder="0"
                    onChange=${v => set(key, v)}/>
                  <span class="ev-have">已有 ${counts[key] || 0}</span>
                </div>`;
            })}`)}
        </div>
      </div>

      <div class="pad-x pad-b">
        <${Field} label="这一批的分量"
          desc=${events.RARITIES.map(r => `${r.label}：${r.hint}`).join('；')
            + '。两种分量分开生成，不要混在同一批里。'}>
          <${Segmented} value=${rarity} items=${RARITY_ITEMS} onChange=${setRarity}/>
        <//>
      </div>

      ${failed.length ? html`
        <${List} title="这几格没成">
          ${failed.map(f => html`
            <${ListItem} key=${f.cell} title=${cellLabel(f.cell)} subtitle=${f.message} multiline
              left=${html`<${Icon} name="close" size=${18}/>`}/>`)}
        <//>` : null}

      <div class="pad">
        <${Button} full disabled=${busy || !want} onClick=${run}>
          ${busy ? html`<${Spinner} size=${15}/>` : null}
          ${busy
            ? (step ? `第 ${Math.min(step.done + 1, step.total)} / ${step.total} 格` : '正在生成')
            : want ? `生成 ${cells} 格，共 ${want} 条` : '请填写条数'}
        <//>
      </div>

      <div class="settings-foot">
        条数没有上限，填多少生成多少。生成前会把该格已有的词条一并发给模型以避免重复，
        入库时再比对一次。这两步都会增加请求长度，可在「设置 - 用量与上限」中调整。
      </div>
    <//>`;
}
