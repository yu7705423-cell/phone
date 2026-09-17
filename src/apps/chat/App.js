import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, EmptyState } from '../../ui/index.js';
import { myChats } from './helpers.js';
import { MessagesTab } from './pages/MessagesTab.js';
import { ContactsTab } from './pages/ContactsTab.js';
import { MomentsTab } from './pages/MomentsTab.js';
import { Profile } from './pages/Profile.js';
import { CharacterEdit } from './pages/CharacterEdit.js';
import { Conversation } from './pages/Conversation.js';
import { ContextPage } from './pages/ContextPage.js';
import { TimePage } from './pages/TimePage.js';
import { TemplatesPage } from './pages/TemplatesPage.js';
import { StickerManager } from './pages/StickerManager.js';
import { ProactivePage } from './pages/ProactivePage.js';

const { db, nav } = phone;

// tab 状态存在模块级。从会话、角色主页等子页返回时,
// Tabs 会重新挂载,状态放在组件里会被重置回「消息」。
const tabState = { current: 'messages' };

const TABS = [
  { id: 'messages', label: '消息', icon: 'message' },
  { id: 'contacts', label: '联系人', icon: 'users' },
  { id: 'moments', label: '朋友圈', icon: 'moments' },
  { id: 'me', label: '主页', icon: 'user' },
];

function Tabs({ initial }) {
  if (initial) tabState.current = initial;
  const [tab, setTabLocal] = useState(tabState.current);
  const setTab = id => { tabState.current = id; setTabLocal(id); };
  useStore(db.chats.store);
  const unread = myChats().reduce((n, c) => n + (c.unread || 0), 0);

  const items = TABS.map(t => t.id === 'messages' ? { ...t, badge: unread } : t);
  const titles = { messages: '消息', contacts: '联系人', moments: '朋友圈', me: '主页' };

  return html`
    <${Page} title=${titles[tab]} tabs=${{ items, value: tab, onChange: setTab }}>
      ${tab === 'messages' ? html`<${MessagesTab}/>` : null}
      ${tab === 'contacts' ? html`<${ContactsTab}/>` : null}
      ${tab === 'moments' ? html`<${MomentsTab}/>` : null}
      ${tab === 'me' ? html`<${Profile} subjectId="me" embedded/>` : null}
    <//>`;
}

export default function ChatApp({ route }) {
  const conv = route?.match(/^\/chat\/(.+)$/);
  if (conv) return html`<${Conversation} chatId=${conv[1]}/>`;

  const prof = route?.match(/^\/profile\/(.+)$/);
  if (prof) return html`<${Profile} subjectId=${prof[1]}/>`;

  const edit = route?.match(/^\/edit\/(.+)$/);
  if (edit) return html`<${CharacterEdit} id=${edit[1]}/>`;

  const pro = route?.match(/^\/proactive\/(.+)$/);
  if (pro) return html`<${ProactivePage} charId=${pro[1]}/>`;

  if (route === '/stickers') return html`<${StickerManager}/>`;
  if (route === '/context') return html`<${ContextPage}/>`;
  if (route === '/time') return html`<${TimePage}/>`;
  if (route === '/templates') return html`<${TemplatesPage}/>`;
  if (route === '/moments') return html`<${Tabs} initial="moments"/>`;
  return html`<${Tabs}/>`;
}
