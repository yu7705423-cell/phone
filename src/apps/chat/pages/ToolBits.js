import { html, useState } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Sheet, Icon, Spinner, Button } from '../../../ui/index.js';

const { ai } = phone;

// 角色调用 MCP 工具的那一条。卡片上是调了什么、参数、现在走到哪一步；
// 要确认的在这里点允许或拒绝，结果回来了显示前几行，点开看全文。

const argsLine = args => {
  const keys = Object.keys(args || {});
  if (!keys.length) return '无参数';
  return keys.map(k => `${k}: ${typeof args[k] === 'string' ? args[k] : JSON.stringify(args[k])}`).join('，');
};

export function ToolBubble({ msg }) {
  const [open, setOpen] = useState(false);
  const server = ai.services.mcpServer(msg.toolServerId);
  const st = msg.toolState;
  // 状态是 running 却不在跑：页面重开时正在调的那一次。不自动重调（工具可能有副作用）
  const lost = st === 'running' && !phone.mcp.isRunning(msg.id);
  const stop = fn => e => { e.stopPropagation(); fn(); };

  const body = st === 'ask' ? html`
      <div class="tool-state">等待你允许后执行</div>
      <div class="tool-acts">
        <${Button} size="sm" variant="ghost" onClick=${stop(() => phone.mcp.deny(msg.id))}>拒绝<//>
        <${Button} size="sm" onClick=${stop(() => phone.mcp.approve(msg.id))}>允许<//>
      </div>`
    : lost ? html`
      <div class="tool-state">调用在应用重新打开时中断，结果未知</div>
      <div class="tool-acts"><${Button} size="sm" variant="ghost" icon="refresh"
        onClick=${stop(() => phone.mcp.run(msg.id))}>重试<//></div>`
    : st === 'running' ? html`
      <div class="tool-state"><${Spinner} size=${13}/><span>正在调用</span></div>`
    : st === 'denied' ? html`<div class="tool-state">已拒绝</div>`
    : st === 'error' ? html`
      <div class="tool-state is-error">调用失败：${msg.toolError || '未知原因'}</div>
      ${msg.toolServerId && server ? html`<div class="tool-acts"><${Button} size="sm" variant="ghost" icon="refresh"
        onClick=${stop(() => phone.mcp.run(msg.id))}>重试<//></div>` : null}`
    : html`<div class="tool-result">${msg.toolResult || '工具没有返回内容'}</div>`;

  return html`
    <div class="bubble tool-card press" onClick=${() => setOpen(true)}>
      <div class="tool-head">
        <${Icon} name="grid" size=${14}/>
        <span class="tool-name ellipsis">${msg.toolTitle || msg.toolName}</span>
        ${server ? html`<span class="tool-server ellipsis">${server.name}</span>` : null}
      </div>
      <div class="tool-args ellipsis">${argsLine(msg.toolArgs)}</div>
      ${body}
      <${Sheet} open=${open} onClose=${() => setOpen(false)} title=${msg.toolTitle || msg.toolName}>
        <div class="pad tool-detail" onClick=${e => e.stopPropagation()}>
          <div class="tool-detail-k">服务器</div>
          <div>${server ? `${server.name}（${server.url}）` : '已删除'}</div>
          <div class="tool-detail-k">工具</div>
          <div>${msg.toolName}</div>
          <div class="tool-detail-k">参数</div>
          <pre>${JSON.stringify(msg.toolArgs || {}, null, 2)}</pre>
          ${msg.toolResult ? html`
            <div class="tool-detail-k">结果</div>
            <pre>${msg.toolResult}</pre>` : null}
          ${msg.toolError && msg.toolError !== msg.toolResult ? html`
            <div class="tool-detail-k">错误</div>
            <pre>${msg.toolError}</pre>` : null}
        </div>
      <//>
    </div>`;
}
