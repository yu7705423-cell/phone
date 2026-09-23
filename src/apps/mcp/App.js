import { html, useState } from '../../lib.js';
import { Page } from '../../ui/index.js';
import { ServersTab, ServerPage, ToolPage, addServer } from './ServersPage.js';
import { CallsTab } from './CallsTab.js';

// MCP。两个页签：服务器（连哪几台、每台上哪些工具给角色用）与调用记录。
// 页签状态放在模块级，从详情页返回时不被重置（和音乐、会话同一个做法）。
const tabState = { current: 'servers' };
const TABS = [
  { id: 'servers', label: '服务器', icon: 'plug' },
  { id: 'calls', label: '调用记录', icon: 'clock' },
];

function Tabs() {
  const [tab, setTabLocal] = useState(tabState.current);
  const setTab = id => { tabState.current = id; setTabLocal(id); };
  return html`
    <${Page} title=${tab === 'calls' ? '调用记录' : 'MCP'} tabs=${{ items: TABS, value: tab, onChange: setTab }}
      right=${tab === 'servers' ? html`<button class="nav-text press" onClick=${addServer}>添加</button>` : null}>
      ${tab === 'calls' ? html`<${CallsTab}/>` : html`<${ServersTab}/>`}
    <//>`;
}

export default function McpApp({ route }) {
  const tool = route?.match(/^\/server\/([^/]+)\/tool\/(.+)$/);
  if (tool) return html`<${ToolPage} id=${tool[1]} name=${decodeURIComponent(tool[2])}/>`;
  const one = route?.match(/^\/server\/([^/]+)$/);
  if (one) return html`<${ServerPage} id=${one[1]}/>`;
  return html`<${Tabs}/>`;
}
