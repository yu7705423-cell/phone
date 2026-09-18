import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, NumberInput, Switch, Button, Icon,
         EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, ai } = phone;
const trace = ai.trace;

const clockText = t => new Date(t).toLocaleTimeString('zh-CN', { hour12: false });

// 一段可折叠的原文。默认收着，请求正文动辄上万字，全摊开没法看
function Block({ title, text, open, onToggle }) {
  return html`
    <div class="trace-block">
      <button class="trace-head press" onClick=${onToggle}>
        <span>${title}</span>
        <span class="trace-size">${text.length} 字</span>
        <${Icon} name=${open ? 'chevronUp' : 'chevronDown'} size=${15}/>
      </button>
      ${open ? html`<pre class="trace-body">${text}</pre>` : null}
    </div>`;
}

function Detail({ row, onBack }) {
  const [open, setOpen] = useState('system');
  const toggle = k => setOpen(o => (o === k ? '' : k));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(trace.asText(row));
      toast('已复制完整记录', 'ok');
    } catch { toast('复制失败，该浏览器不允许写入剪贴板', 'error'); }
  };

  return html`
    <${Page} title="这一轮发了什么" onBack=${onBack}
      right=${html`<button class="nav-text press" onClick=${copy}>复制</button>`}>
      <${List}>
        <${ListItem} title="任务" right=${html`<span>${row.taskId}</span>`}/>
        <${ListItem} title="接口" right=${html`<span>${row.preset || '未命名'}</span>`}/>
        <${ListItem} title="模型" right=${html`<span>${row.model || '未知'}</span>`}/>
        <${ListItem} title="耗时" right=${html`<span>${row.ms} 毫秒</span>`}/>
        <${ListItem} title="估算长度" right=${html`<span>约 ${row.tokens} tokens</span>`}/>
        ${row.error ? html`<${ListItem} title="错误" subtitle=${row.error} multiline danger/>` : null}
      <//>

      <div class="pad-x">
        <${Block} title="system" text=${row.system}
          open=${open === 'system'} onToggle=${() => toggle('system')}/>
        ${row.messages.map((m, i) => html`
          <${Block} key=${i} title=${`消息 ${i + 1} · ${m.role}${m.image ? ' · 含图片' : ''}`}
            text=${m.content} open=${open === `m${i}`} onToggle=${() => toggle(`m${i}`)}/>`)}
        <${Block} title="模型返回" text=${row.error ? '（失败）' + row.error : row.reply}
          open=${open === 'reply'} onToggle=${() => toggle('reply')}/>
      </div>
    <//>`;
}

// 调试用。默认关着，关着时一条都不记
export function TracePage() {
  const s = useStore(db.settings.store);
  useStore(trace.traceStore);
  const [pick, setPick] = useState(null);

  const rows = trace.list();
  const row = pick && rows.find(r => r.id === pick);
  if (row) return html`<${Detail} row=${row} onBack=${() => setPick(null)}/>`;

  const wipe = async () => {
    if (!await confirm({ title: '清空记录', message: '将清除已记录的全部请求。', danger: true })) return;
    trace.clear();
  };

  return html`
    <${Page} title="请求记录" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="记录每一轮请求" multiline
          subtitle="开启后，每次向模型发出的请求都会被记录，包括完整的 system、消息数组与返回内容。记录仅保存在内存中，刷新页面即清除。该功能用于排查提示词，日常使用无需开启。"
          right=${html`<${Switch} checked=${trace.isOn()}
            onChange=${v => trace.setOn(v)}/>`}/>
      <//>

      ${trace.isOn() ? html`
        <div class="pad-x">
          <${Field} label="保留条数"
            desc="超出后丢弃最早的记录。填 0 表示不限制，长时间开启会持续占用内存。">
            <${NumberInput} value=${trace.maxOf()} min=${0} unit="条"
              onChange=${v => trace.setMax(v)}/>
          <//>
        </div>

        <${List} title=${`已记录 ${rows.length}`}>
          ${rows.map(r => html`
            <${ListItem} key=${r.id} arrow multiline
              title=${`${clockText(r.at)} · ${r.taskId}`}
              subtitle=${[
                r.model || '未知模型',
                `约 ${r.tokens} tokens`,
                `${r.messages.length} 条消息`,
                r.error ? '失败' : `${r.ms} 毫秒`,
              ].join(' · ')}
              left=${html`<${Icon} name=${r.error ? 'close' : 'send'} size=${18}/>`}
              onClick=${() => setPick(r.id)}/>`)}
        <//>
        ${!rows.length ? html`
          <${EmptyState} icon="send" title="尚无记录"
            desc="发送一条消息，或触发任意一项需要调用接口的功能，记录会出现在这里。"/>` : null}

        ${rows.length ? html`
          <div class="pad">
            <${Button} full variant="danger" onClick=${wipe}>清空记录<//>
          </div>` : null}
      ` : null}
    <//>`;
}
