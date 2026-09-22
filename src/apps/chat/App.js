import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, EmptyState } from '../../ui/index.js';
import { myChats, chatFor } from './helpers.js';
import { MessagesTab } from './pages/MessagesTab.js';
import { ContactsTab } from './pages/ContactsTab.js';
import { MomentsTab } from './pages/MomentsTab.js';
import { Profile } from './pages/Profile.js';
import { MomentPage } from './pages/MomentPage.js';
import { CharacterEdit } from './pages/CharacterEdit.js';
import { Conversation } from './pages/Conversation.js';
import { ContextPage } from './pages/ContextPage.js';
import { TimePage } from './pages/TimePage.js';
import { ExtrasPage } from './pages/ExtrasPage.js';
import { PacePage } from './pages/PacePage.js';
import { BondPage } from './pages/BondPage.js';
import { TranslatePage } from './pages/TranslatePage.js';
import { TemplatesPage } from './pages/TemplatesPage.js';
import { CapsPage } from './pages/CapsPage.js';
import { StickerManager } from './pages/StickerManager.js';
import { ProactivePage } from './pages/ProactivePage.js';
import { SearchPage } from './pages/SearchPage.js';
import { ListenPage } from './pages/ListenPage.js';
import { StageList, SceneEdit } from './pages/StageList.js';
import { StageRead } from './pages/StageRead.js';
import { StageSettings } from './pages/StageSettings.js';
import { SkinPage } from './pages/SkinPage.js';

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

function OpenWith({ charId }) {
  useEffect(() => {
    const c = phone.db.characters.get(charId) ? chatFor(charId) : null;
    if (c) phone.nav.replace(`/chat/${c.id}`);
    else phone.nav.replace('/');
  }, [charId]);
  return null;
}

export default function ChatApp({ route }) {
  // /chat/<id> 或 /chat/<id>@<msgId>。后一种是从搜索结果跳过来的，
  // 进去之后滚到那一条。会话 id 里不会有 @，所以拿它当分隔符是安全的。
  const conv = route?.match(/^\/chat\/([^@]+)(?:@(.+))?$/);
  if (conv) return html`<${Conversation} chatId=${conv[1]} focusId=${conv[2] || ''}/>`;

  const lis = route?.match(/^\/listen\/(.+)$/);
  if (lis) return html`<${ListenPage} chatId=${lis[1]}/>`;

  // 线下。/stage/<chatId> 是场次列表，/scene/<id> 是正文页
  const stg = route?.match(/^\/stage\/settings(?:\/(.+))?$/);
  if (stg) return html`<${StageSettings} sceneId=${stg[1] || ''}/>`;
  const stl = route?.match(/^\/stage\/(.+)$/);
  if (stl) return html`<${StageList} chatId=${stl[1]}/>`;
  const sce = route?.match(/^\/scene\/([^/]+)\/edit$/);
  if (sce) return html`<${SceneEdit} sceneId=${sce[1]}/>`;
  const scr = route?.match(/^\/scene\/(.+)$/);
  if (scr) return html`<${StageRead} sceneId=${scr[1]}/>`;

  const search = route?.match(/^\/search(?:\/(.+))?$/);
  if (search) return html`<${SearchPage} chatId=${search[1] || ''}/>`;

  const prof = route?.match(/^\/profile\/(.+)$/);
  if (prof) return html`<${Profile} subjectId=${prof[1]}/>`;

  const mom = route?.match(/^\/moment\/(.+)$/);
  if (mom) return html`<${MomentPage} id=${mom[1]}/>`;

  // 别的 app 说「去和这个角色聊天」时走这里：找到（或建出）会话再换成它的路由。
  // 从前落在消息列表首页上，新建的角色还没有会话，那一页是空的，人就卡在那儿
  const withc = route?.match(/^\/with\/(.+)$/);
  if (withc) return html`<${OpenWith} charId=${withc[1]}/>`;

  const edit = route?.match(/^\/edit\/(.+)$/);
  if (edit) return html`<${CharacterEdit} id=${edit[1]}/>`;

  const pro = route?.match(/^\/proactive\/(.+)$/);
  if (pro) return html`<${ProactivePage} charId=${pro[1]}/>`;


  if (route === '/stickers') return html`<${StickerManager}/>`;
  if (route === '/context') return html`<${ContextPage}/>`;
  if (route === '/time') return html`<${TimePage}/>`;

  const pc = route?.match(/^\/pace\/(.+)$/);
  if (pc) return html`<${PacePage} chatId=${pc[1]}/>`;
  const bd = route?.match(/^\/bond\/(.+)$/);
  if (bd) return html`<${BondPage} chatId=${bd[1]}/>`;
  const ex = route?.match(/^\/extras\/(.+)$/);
  if (ex) return html`<${ExtrasPage} chatId=${ex[1]}/>`;

  const sk = route?.match(/^\/skin\/(.+)$/);
  if (sk) return html`<${SkinPage} chatId=${sk[1]}/>`;

  const tr = route?.match(/^\/translate\/(.+)$/);
  if (tr) return html`<${TranslatePage} chatId=${tr[1]}/>`;
  if (route === '/templates') return html`<${TemplatesPage}/>`;
  if (route === '/caps') return html`<${CapsPage}/>`;
  if (route === '/moments') return html`<${Tabs} initial="moments"/>`;
  return html`<${Tabs}/>`;
}
