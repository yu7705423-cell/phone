import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Switch, Segmented, Icon, toast } from '../../../ui/index.js';

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

const HISTORY_MODES = [
  { value: 'count', label: '按条数' },
  { value: 'turn', label: '按轮次' },
];

export function ContextPage() {
  const s = useStore(db.settings.store);
  const byTurn = s.historyMode === 'turn';
  useStore(db.memories.store);
  const vecReady = ai.services.embedReady();
  const total = db.memories.count();
  const indexed = ai.memvec.indexedCount();
  const todo = ai.memvec.pending().length;
  const order = ai.resolveOrder(s.injectOrder);
  const styleCost = ai.estimateTokens(ai.template('skeleton.style'));

  // 轮数是自己填的。输入过程中会经过「空」和「0」这些中间状态，
  // 直接写进设置会把自动总结顺手关掉，所以编辑期间先放在 draft 里，
  // 只有解析出合法数字才落盘，失焦再回到真实值。
  const interval = s.autoSummarizeInterval || 0;
  const autoOn = interval > 0;
  const [draft, setDraft] = useState(null);
  const [remembered, setRemembered] = useState(interval || 6);

  const onRounds = v => {
    setDraft(v);
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const next = Math.min(n, 999);
    setRemembered(next);
    db.settings.set({ autoSummarizeInterval: next });
  };

  const toggleAuto = on => {
    setDraft(null);
    if (on) db.settings.set({ autoSummarizeInterval: remembered || 6 });
    else {
      if (interval > 0) setRemembered(interval);
      db.settings.set({ autoSummarizeInterval: 0 });
    }
  };

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

      <${List} title="回复风格">
        <${ListItem} title="自然表达协议" multiline
          subtitle=${`一份写在提示词里的行文约束：句式去重、句长打散、禁止固定回应模板、`
            + `允许情绪错位与漏听、留白不升华。每轮注入，约 ${styleCost} token。`
            + `${s.styleProtocol === false ? '当前已关闭。' : ''}正文可在「Prompt 模板」中修改。`}
          right=${html`<${Switch} checked=${s.styleProtocol !== false}
            onChange=${v => db.settings.set({ styleProtocol: v })}/>`}/>
      <//>
      <div class="settings-foot">
        分工：「回复风格收尾」管消息怎么分条，本协议管句子怎么写。
        关闭后，句式、情绪与信息取舍方面的约束不再注入，收尾那段仍然生效。
        两段都可以在「Prompt 模板」中分别改写。
      </div>

      <${List} title="功能说明">
        <${ListItem} title="按需注入" multiline
          subtitle=${s.promptLean === false
            ? '已关闭。所有开启的功能每轮都注入完整说明，约多占 1000 token，也会分散模型对聊天本身的注意力'
            : '平时只给角色一份功能清单，某项功能最近用到时才注入该项的完整说明'}
          right=${html`<${Switch} checked=${s.promptLean !== false}
            onChange=${v => db.settings.set({ promptLean: v })}/>`}/>
      <//>
      <div class="settings-foot">
        清单中已写明每项功能的触发写法，因此首次使用也不会出错。
        时间与译文不受此项影响，它们是每条消息都要遵守的格式，始终完整注入。
      </div>

      <${List} title="上下文">
        <${ListItem} title="时间感知" arrow multiline
          subtitle=${s.injectTime === false
            ? '已关闭。角色不知道当前日期与时间'
            : `当前时间、双方时差、对话间隔${s.timeMode === 'virtual' ? ' · 使用自定义时间' : ''}`}
          onClick=${() => nav.push('/time')}/>
        <${ListItem} title="历史范围" multiline
          subtitle=${byTurn
            ? '按轮次截取。一轮为用户的连续发言与角色随后的连续回复，整轮进入或整轮不进入。'
            : '按条数截取。可能只取到一轮的后半段，角色看不到你这一轮开头说了什么。'}
          right=${html`<span>${byTurn ? `${s.historyTurns} 轮` : `${s.historyLimit} 条`}</span>`}/>
      <//>
      <div class="pad-x">
        <${Segmented} value=${byTurn ? 'turn' : 'count'} items=${HISTORY_MODES}
          onChange=${v => db.settings.set({ historyMode: v })}/>
      </div>
      <div class="pad-x">
        ${byTurn
          ? html`<input type="range" min="1" max="40" step="1" value=${s.historyTurns}
              onInput=${e => db.settings.set({ historyTurns: parseInt(e.target.value, 10) })}/>`
          : html`<input type="range" min="4" max="60" step="2" value=${s.historyLimit}
              onInput=${e => db.settings.set({ historyLimit: parseInt(e.target.value, 10) })}/>`}
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
        <${ListItem} title="自动总结" multiline
          subtitle=${!s.memoryEnabled
            ? '记忆已关闭，自动总结不会执行。手动的「立即总结记忆」不受影响'
            : autoOn
              ? `角色每回复 ${interval} 轮，自动提取一次记忆`
              : '已关闭。记忆只在会话菜单里点「立即总结记忆」时才提取'}
          right=${html`<${Switch} checked=${autoOn} onChange=${toggleAuto}/>`}/>
      <//>

      ${autoOn ? html`
        <div class="pad-x pad-b">
          <${Field} label="间隔轮数"
            desc="填角色回复的轮数。数值越小记得越勤，接口调用也越频繁；
              不确定就先用 6，一段完整的来回大概就是这个量。">
            <div class="round-row">
              <${Input} type="number" inputmode="numeric" min="1" max="999"
                value=${draft ?? String(interval)}
                onInput=${onRounds}
                onBlur=${() => setDraft(null)}/>
              <span class="round-unit">轮</span>
            </div>
          <//>
        </div>`
      : html`<div class="pad-b"></div>`}

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
