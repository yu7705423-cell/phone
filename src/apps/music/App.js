import { html, useState } from '../../lib.js';
import { Page } from '../../ui/index.js';
import { HomeTab } from './HomeTab.js';
import { SearchTab } from './SearchTab.js';
import { MineTab } from './MineTab.js';
import { PlaylistPage } from './PlaylistPage.js';
import { LibraryPage } from './LibraryPage.js';
import { NowBar } from './parts.js';
import { NowPage } from './NowPage.js';

// 音乐。数据全部来自用户自己登录的那个网易云账号，见 system/netease.js。
//
// 三个页签，和网易云同一个分法：首页、搜索、我的。
// 跟 chat 那边一样，页签状态放在模块级 —— 从歌单页返回时 Tabs 会重新挂载，
// 放在组件里会被重置回「首页」。
const tabState = { current: 'home' };

const TABS = [
  { id: 'home', label: '首页', icon: 'music' },
  { id: 'search', label: '搜索', icon: 'search' },
  { id: 'mine', label: '我的', icon: 'user' },
];

function Tabs() {
  const [tab, setTabLocal] = useState(tabState.current);
  const setTab = id => { tabState.current = id; setTabLocal(id); };
  const titles = { home: '音乐', search: '搜索', mine: '我的' };

  return html`
    <${Page} title=${titles[tab]} tabs=${{ items: TABS, value: tab, onChange: setTab }}>
      ${tab === 'home' ? html`<${HomeTab}/>` : null}
      ${tab === 'search' ? html`<${SearchTab}/>` : null}
      ${tab === 'mine' ? html`<${MineTab}/>` : null}
      <${NowBar}/>
    <//>`;
}

export default function MusicApp({ route }) {
  if (route === '/library') return html`<${LibraryPage}/>`;
  if (route === '/now') return html`<${NowPage}/>`;
  const list = route?.match(/^\/list\/(.+)$/);
  if (list) return html`<${PlaylistPage} id=${list[1]}/>`;
  return html`<${Tabs}/>`;
}
