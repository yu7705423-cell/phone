import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, EmptyState } from '../../ui/index.js';
import { MessagesTab } from './pages/MessagesTab.js';
import { ContactsTab } from './pages/ContactsTab.js';
import { MomentsTab } from './pages/MomentsTab.js';
import { Profile } from './pages/Profile.js';
import { CharacterEdit } from './pages/CharacterEdit.js';
import { Conversation } from './pages/Conversation.js';

const { db, nav } = phone;

// tab 状态存在模块级。从会话、角色主页等子页返回时,
// Tabs 会重新挂载,状态放在组件里会被重置回「消息」。
const tabState = { current: 'messages' };

const TABS = [
  { id: 'messages', label: '消息', icon: 'message' },
  { id: 'contacts', label: '联系人', icon: 'users' },
  { id: 'moments', label: '朋友圈', icon: 'compass' },
  { id: 'me', label: '主页', icon: 'user' },
];

function Tabs({ initial }) {
  if (initial) tabState.current = initial;
  const [tab, setTabLocal] = useState(tabState.current);
  const setTab = id => { tabState.current = id; setTabLocal(id); };
  useStore(db.chats.store);
  const unread = db.chats.all().reduce((n, c) => n + (c.unread || 0), 0);

  const items = TABS.map(t => t.id === 'messages' ? { ...t, badge: unread } : t);
  const titles = { messages: '消息', contacts: '联系人', moments: '朋友圈', me: '主页' };

  return html`
    <${Page} title=${titles[tab]} tabs=${{ items, value: tab, onChange: setTab }}>
      ${tab === 'messages' ? html`<${MessagesTab}/>` : null}
      ${tab === 'contacts' ? html`<${ContactsTab}/>` : null}
      ${tab === 'moments' ? html`<${MomentsTab}/>` : null}
      ${tab === 'me' ? html`<${Profile} subjectId="me"/>` : null}
    <//>`;
}

export default function ChatApp({ route }) {
  const conv = route?.match(/^\/chat\/(.+)$/);
  if (conv) return html`<${Conversation} chatId=${conv[1]}/>`;

  const prof = route?.match(/^\/profile\/(.+)$/);
  if (prof) return html`<${Profile} subjectId=${prof[1]}/>`;

  const edit = route?.match(/^\/edit\/(.+)$/);
  if (edit) return html`<${CharacterEdit} id=${edit[1]}/>`;

  if (route === '/moments') return html`<${Tabs} initial="moments"/>`;
  return html`<${Tabs}/>`;
}
