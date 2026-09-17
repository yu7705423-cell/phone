import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Switch, Icon, toast } from '../../../ui/index.js';

const { db, nav, ai } = phone;

function OrderRow({ id, idx, total, onMove }) {
  const block = ai.blocks[id];
  if (!block) return null;
  return html`
    <div class="order-row">
      <span class="order-idx">${idx + 1}</span>
      <div class="order-body">
        <div class="order-label">${block.meta.label}</div>
        <div class="order-desc">${block.meta.desc}</div>
      </div>
      <button class="order-btn press" disabled=${idx === 0}
        onClick=${() => onMove(idx, -1)} aria-label="上移"><${Icon} name="chevronUp" size=${15}/></button>
      <button class="order-btn press" disabled=${idx === total - 1}
        onClick=${() => onMove(idx, 1)} aria-label="下移"><${Icon} name="chevronDown" size=${15}/></button>
    </div>`;
}

export function ContextPage() {
  const s = useStore(db.settings.store);
  useStore(db.memories.store);
  const vecReady = ai.services.embedReady();
  const total = db.memories.count();
  const indexed = ai.memvec.indexedCount();
  const todo = ai.memvec.pending().length;
  const order = ai.resolveOrder(s.injectOrder);

  const move = (idx, dir) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    db.settings.set({ injectOrder: next });
  };

  return html`
    <${Page} title="上下文与记忆" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="注入顺序"
          desc="身份开场与回复风格收尾固定在首尾，不参与排序。顺序会自动补齐新增的区块，老配置不会失效。">
          <div class="order-list">
            ${order.map((id, i) => html`
              <${OrderRow} key=${id} id=${id} idx=${i} total=${order.length} onMove=${move}/>`)}
          </div>
        <//>
      </div>

      <${List} title="上下文">
        <${ListItem} title="注入时间情境" subtitle="现在几点、距上次聊天多久"
          right=${html`<${Switch} checked=${s.injectTime}
            onChange=${v => db.settings.set({ injectTime: v })}/>`}/>
        <${ListItem} title="历史轮次" subtitle="带入 prompt 的最近消息条数"
          right=${html`<span>${s.historyLimit}</span>`}/>
      <//>
      <div class="pad-x">
        <input type="range" min="4" max="60" step="2" value=${s.historyLimit}
          onInput=${e => db.settings.set({ historyLimit: parseInt(e.target.value, 10) })}/>
      </div>

      <${List}>
        <${ListItem} title="扫描窗口" multiline
          subtitle="世界书与 B 级记忆在最近几条消息里找关键词。太窄会漏：上一句说「下周面试」，这一句说「好紧张」就命中不了。"
          right=${html`<span>${s.scanWindow}</span>`}/>
      <//>
      <div class="pad-x">
        <input type="range" min="1" max="20" step="1" value=${s.scanWindow}
          onInput=${e => db.settings.set({ scanWindow: parseInt(e.target.value, 10) })}/>
      </div>

      <${List}>
        <${ListItem} title="注入预算" subtitle="世界书与记忆合计占用的 token 上限"
          right=${html`<span>${s.contextBudget}</span>`}/>
      <//>
      <div class="pad-x">
        <input type="range" min="1000" max="30000" step="500" value=${s.contextBudget}
          onInput=${e => db.settings.set({ contextBudget: parseInt(e.target.value, 10) })}/>
      </div>

      <${List} title="记忆">
        <${ListItem} title="启用记忆" subtitle="关闭后不注入记忆，也不自动总结"
          right=${html`<${Switch} checked=${s.memoryEnabled}
            onChange=${v => db.settings.set({ memoryEnabled: v })}/>`}/>
        <${ListItem} title="自动总结间隔" subtitle="每 N 轮角色回复后提取一次记忆，0 为关闭"
          right=${html`<span>${s.autoSummarizeInterval || '关'}</span>`}/>
      <//>
      <div class="pad-x pad-b">
        <input type="range" min="0" max="30" step="1" value=${s.autoSummarizeInterval}
          onInput=${e => db.settings.set({ autoSummarizeInterval: parseInt(e.target.value, 10) })}/>
      </div>

      <${List} title="怎么找记忆">
        <${ListItem} title="按意思找" multiline
          subtitle=${vecReady
            ? `已索引 ${indexed} / ${total} 条。关掉就退回原来的关键词匹配`
            : '需要先在「设置 - 向量」里配好接口。没配就一直走关键词匹配'}
          right=${vecReady
            ? html`<${Switch} checked=${s.memoryVector !== false}
                onChange=${v => db.settings.set({ memoryVector: v })}/>`
            : html`<span class="li-hint">未配置</span>`}/>
      <//>
      ${vecReady && s.memoryVector !== false ? html`
        <div class="pad-x">
          <${Field} label=${`最多取 ${s.memoryTopK || 12} 条`}
            desc="S 级记忆永远都在，不占这个名额。剩下的按相似度排，取前几条">
            <input type="range" min="3" max="40" step="1" value=${s.memoryTopK || 12}
              onInput=${e => db.settings.set({ memoryTopK: parseInt(e.target.value, 10) })}/>
          <//>
          <${Field} label=${`相似度门槛 ${(s.memoryThreshold ?? 0.22).toFixed(2)}`}
            desc="低于这个就当没关系。调高更精准但容易漏，调低记得多但会带进噪音">
            <input type="range" min="0" max="0.7" step="0.01" value=${s.memoryThreshold ?? 0.22}
              onInput=${e => db.settings.set({ memoryThreshold: parseFloat(e.target.value) })}/>
          <//>
        </div>
        ${todo ? html`
          <div class="settings-foot">
            还有 ${todo} 条记忆没建索引，暂时只能靠关键词命中。去「设置 - 向量」里补齐。
          </div>` : null}
      ` : null}
    <//>`;
}
