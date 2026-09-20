import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, NumberInput, Switch, Segmented, Icon, toast } from '../../../ui/index.js';

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
  useStore(db.lorebooks.store);
  const vecReady = ai.services.embedReady();
  const total = db.memories.count();
  const indexed = ai.memvec.indexedCount();
  const todo = ai.memvec.pending().length;
  const order = ai.resolveOrder(s.injectOrder);
  // 一句话交代世界书现在有多少条、分别落在哪儿，省得进去才看得见
  const entries = db.lorebooks.all().flatMap(b => (b.entries || [])
    .filter(e => e.enabled).map(e => ({ ...e })));
  const deep = entries.filter(e => Math.round(Number(e.depth) || 0) > 0).length;
  const loreLine = entries.length
    ? `共 ${entries.length} 个启用中的条目，其中 ${deep} 个插入对话历史，其余留在设定区`
    : '尚无启用中的条目';
  const rulesCost = ai.estimateTokens(ai.template('skeleton.rules'));

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
    setRemembered(n);
    db.settings.set({ autoSummarizeInterval: n });
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

      <${List} title="世界书">
        <${ListItem} title="注入位置总览" arrow multiline
          subtitle=${loreLine}
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => phone.intent.open('lorebook', { route: '/map' })}/>
      <//>
      <div class="settings-foot">
        条目分为角色卡之前与角色卡之后两部分，各自可再设置注入深度：
        深度为 0 留在设定区，大于 0 则改为插入对话历史中倒数第 N 条消息之前。
        总览页按实际注入顺序列出全部条目。
      </div>

      <${List} title="回复的获取方式">
        <${ListItem} title="流式接收" multiline
          subtitle=${s.streamMode === 'once'
            ? '当前为一次性接收完整回复。部分接口不支持流式返回，此时应保持关闭。'
            : '边生成边接收。消息仍然在整段生成完毕后一次显示，'
              + '此项只影响与接口之间的传输方式，不影响界面。'}
          right=${html`<${Switch} checked=${s.streamMode !== 'once'}
            onChange=${v => db.settings.set({ streamMode: v ? 'stream' : 'once' })}/>`}/>
      <//>
      <div class="settings-foot">
        生成期间，会话标题显示为「正在输入」，不再插入占位气泡。
        两种接收方式发出的请求内容与费用完全相同。
      </div>

      <${List} title="回复风格">
        <${ListItem} title="内置规则" multiline
          subtitle=${`骨架中只保留格式规则，约 ${rulesCost} token。`
            + '当前的规则是：每轮回复分 3 到 5 条发出。'
            + '角色怎么说话由角色卡与世界书决定，内置提示词不作规定。'
            + '规则正文可在「Prompt 模板」中修改。'}/>
      <//>
      <div class="pad-x">
        <${Field} label="兜底分条的长度"
          desc="模型未按规则分条、整轮只回了一整段时，本地按句末标点与逗号断开。
            超过该字数才处理，已经分好条的不作改动。
            填 0 表示不处理，模型回什么就显示什么。">
          <${NumberInput} value=${s.autoSplitAt ?? 40} unit="字" placeholder="不处理"
            onChange=${v => db.settings.set({ autoSplitAt: v })}/>
        <//>
      </div>

      <div class="settings-foot">
        「消息规则」始终注入，不可关闭，它只规定消息如何分条。
        兜底分条在模型未按规则分条时生效，不发起额外请求。
        规则正文可在「Prompt 模板」中改写。
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
          right=${html`<span>${byTurn
            ? (s.historyTurns ? `${s.historyTurns} 轮` : '全部')
            : (s.historyLimit ? `${s.historyLimit} 条` : '全部')}</span>`}/>
      <//>
      <div class="pad-x">
        <${Segmented} value=${byTurn ? 'turn' : 'count'} items=${HISTORY_MODES}
          onChange=${v => db.settings.set({ historyMode: v })}/>
      </div>
      <div class="pad-x pad-b">
        <${Field} desc="填 0 表示不按条数或轮数截断，整段对话全部进入上下文。
          无论填多少，超出「上下文预算」的部分仍会从最早的一条开始舍去。">
          ${byTurn
            ? html`<${NumberInput} value=${s.historyTurns} unit="轮" placeholder="全部"
                onChange=${v => db.settings.set({ historyTurns: v })}/>`
            : html`<${NumberInput} value=${s.historyLimit} unit="条" placeholder="全部"
                onChange=${v => db.settings.set({ historyLimit: v })}/>`}
        <//>
      </div>

      <${List}>
        <${ListItem} title="扫描窗口" multiline
          subtitle="世界书与 B 级记忆在最近若干条消息中匹配关键词。窗口过窄会导致漏检：上一句提到「下周面试」，下一句的「好紧张」将无法命中。"
          right=${html`<span>${s.scanWindow || '全部'}</span>`}/>
      <//>
      <div class="pad-x pad-b">
        <${Field} desc="填 0 表示在整段对话中匹配。窗口越大命中越多，注入的条目也越多。">
          <${NumberInput} value=${s.scanWindow} unit="条" placeholder="全部"
            onChange=${v => db.settings.set({ scanWindow: v })}/>
        <//>
      </div>

      <${List}>
        <${ListItem} title="注入预算" subtitle="世界书与记忆合计占用的 token 上限"
          right=${html`<span>${s.contextBudget || '不限'}</span>`}/>
      <//>
      <div class="pad-x pad-b">
        <${Field} desc="按粗估的 token 数截断。填 0 表示不截断，命中的条目全部注入，
          请求体与费用随之增长。">
          <${NumberInput} value=${s.contextBudget} unit="token" placeholder="不限"
            onChange=${v => db.settings.set({ contextBudget: v })}/>
        <//>
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
            <div class="num-row">
              <${Input} type="number" inputmode="numeric" min="1"
                value=${draft ?? String(interval)}
                onInput=${onRounds}
                onBlur=${() => setDraft(null)}/>
              <span class="num-unit">轮</span>
            </div>
          <//>
        </div>`
      : html`<div class="pad-b"></div>`}

      <${List} title="怎么找记忆">
        <${ListItem} title="按意思找" multiline
          subtitle=${vecReady
            ? s.memoryVector === true
              ? `已索引 ${indexed} / ${total} 条。每轮额外取一次查询向量，关闭后退回关键词匹配`
              : `已配置接口，当前关闭，使用关键词匹配。开启后每轮额外调用一次向量接口`
            : '需先在「设置 - 向量」中配置接口。未配置时始终使用关键词匹配'}
          right=${vecReady
            ? html`<${Switch} checked=${s.memoryVector === true}
                onChange=${v => db.settings.set({ memoryVector: v })}/>`
            : html`<span class="li-hint">未配置</span>`}/>
      <//>
      ${vecReady && s.memoryVector === true ? html`
        <div class="pad-x">
          <${Field} label="最多取几条"
            desc="S 级记忆始终注入，不计入此数。其余记忆按相似度排序后取前若干条。
              填 0 表示凡是超过相似度门槛的全部取用，仍受上面的注入预算约束。">
            <${NumberInput} value=${s.memoryTopK} unit="条" placeholder="全部"
              onChange=${v => db.settings.set({ memoryTopK: v })}/>
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
