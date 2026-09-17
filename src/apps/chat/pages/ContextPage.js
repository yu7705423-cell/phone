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
          desc="身份开场与回复风格收尾固定于首尾，不参与排序。新增区块会自动补入顺序，旧配置不会失效。">
          <div class="order-list">
            ${order.map((id, i) => html`
              <${OrderRow} key=${id} id=${id} idx=${i} total=${order.length} onMove=${move}/>`)}
          </div>
        <//>
      </div>

      <${List} title="上下文">
        <${ListItem} title="时间感知" arrow multiline
          subtitle=${s.injectTime === false
            ? '已关闭。角色不知道当前日期与时间'
            : `当前时间、双方时差、对话间隔${s.timeMode === 'virtual' ? ' · 使用自定义时间' : ''}`}
          onClick=${() => nav.push('/time')}/>
        <${ListItem} title="历史轮次" subtitle="进入 prompt 的最近消息条数"
          right=${html`<span>${s.historyLimit}</span>`}/>
      <//>
      <div class="pad-x">
        <input type="range" min="4" max="60" step="2" value=${s.historyLimit}
          onInput=${e => db.settings.set({ historyLimit: parseInt(e.target.value, 10) })}/>
      </div>

      <${List}>
        <${ListItem} title="扫描窗口" multiline
          subtitle="世界书与 B 级记忆在最近若干条消息中匹配关键词。窗口过窄会导致漏检：上一句提到「下周面试」，下一句的「好紧张」将无法命中。"
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
        <${ListItem} title="启用记忆" subtitle="关闭后不注入记忆，也不执行自动总结"
          right=${html`<${Switch} checked=${s.memoryEnabled}
            onChange=${v => db.settings.set({ memoryEnabled: v })}/>`}/>
        <${ListItem} title="自动总结间隔" subtitle="每 N 轮角色回复后提取一次记忆，0 表示关闭"
          right=${html`<span>${s.autoSummarizeInterval || '关'}</span>`}/>
      <//>
      <div class="pad-x pad-b">
        <input type="range" min="0" max="30" step="1" value=${s.autoSummarizeInterval}
          onInput=${e => db.settings.set({ autoSummarizeInterval: parseInt(e.target.value, 10) })}/>
      </div>

      <${List} title="怎么找记忆">
        <${ListItem} title="按意思找" multiline
          subtitle=${vecReady
            ? `已索引 ${indexed} / ${total} 条。关闭后退回关键词匹配`
            : '需先在「设置 - 向量」中配置接口。未配置时始终使用关键词匹配'}
          right=${vecReady
            ? html`<${Switch} checked=${s.memoryVector !== false}
                onChange=${v => db.settings.set({ memoryVector: v })}/>`
            : html`<span class="li-hint">未配置</span>`}/>
      <//>
      ${vecReady && s.memoryVector !== false ? html`
        <div class="pad-x">
          <${Field} label=${`最多取 ${s.memoryTopK || 12} 条`}
            desc="S 级记忆始终注入，不计入此上限。其余记忆按相似度排序后取前若干条。">
            <input type="range" min="3" max="40" step="1" value=${s.memoryTopK || 12}
              onInput=${e => db.settings.set({ memoryTopK: parseInt(e.target.value, 10) })}/>
          <//>
          <${Field} label=${`相似度门槛 ${(s.memoryThreshold ?? 0.22).toFixed(2)}`}
            desc="相似度低于该值视为无关。调高更精准但易漏检，调低召回更多但会引入噪音。">
            <input type="range" min="0" max="0.7" step="0.01" value=${s.memoryThreshold ?? 0.22}
              onInput=${e => db.settings.set({ memoryThreshold: parseFloat(e.target.value) })}/>
          <//>
        </div>
        ${todo ? html`
          <div class="settings-foot">
            尚有 ${todo} 条记忆未建立索引，暂时仅能通过关键词命中。请在「设置 - 向量」中补齐。
          </div>` : null}
      ` : null}
    <//>`;
}
