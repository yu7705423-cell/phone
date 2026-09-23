import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { List, ListItem, Button, EmptyState } from '../../ui/index.js';

const { db } = phone;

// 调用记录：所有会话里角色调过的工具，新的在前。点一条回到那段会话。
// 等你允许的那几条排在最前面 —— 人在别处时角色发起的调用，要在这里找得到。
const PAGE = 50;

const when = t => {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function CallsTab() {
  useStore(db.messages.store);
  useStore(db.characters.store);
  const [shown, setShown] = useState(PAGE);
  const all = phone.mcp.calls();
  const asking = all.filter(m => m.toolState === 'ask');
  const rest = all.filter(m => m.toolState !== 'ask');
  const open = m => phone.intent.open('chat', { route: `/chat/${m.chatId}`, back: true });
  const row = m => {
    const who = db.characters.get(m.authorId)?.name || '已删除的角色';
    const server = phone.ai.services.mcpServer(m.toolServerId)?.name || '';
    // 列表里只放结果的第一行开头一段，全文在会话里那张卡片上
    const line = m.toolState === 'done' ? String(m.toolResult || '').split('\n')[0]
      : m.toolState === 'error' ? String(m.toolError || '') : '';
    const brief = line.length > 60 ? `${line.slice(0, 60)}…` : line;
    return html`
      <${ListItem} key=${m.id} arrow multiline
        title=${`${who} · ${m.toolTitle || m.toolName}`}
        subtitle=${[when(m.createdAt), server, brief].filter(Boolean).join(' · ')}
        right=${phone.mcp.STATE_TEXT[m.toolState] || ''}
        onClick=${() => open(m)}/>`;
  };

  if (!all.length) {
    return html`<${EmptyState} icon="plug" title="暂无调用记录"
      desc="角色在会话中调用 MCP 工具后，记录会出现在这里。"/>`;
  }
  return html`
    ${asking.length ? html`
      <${List} title=${`等待允许 · ${asking.length}`}>${asking.map(row)}<//>` : null}
    <${List} title=${`全部 · ${rest.length}`}>${rest.slice(0, shown).map(row)}<//>
    ${rest.length > shown ? html`
      <div class="pad"><${Button} full variant="ghost" onClick=${() => setShown(shown + PAGE)}>
        显示更多（还有 ${rest.length - shown} 条）<//></div>` : null}`;
}
