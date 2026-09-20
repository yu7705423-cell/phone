import { html, useState } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { LockPage } from './pages/LockPage.js';
import { PickPage } from './pages/PickPage.js';
import { HomePage } from './pages/HomePage.js';
import { ShelfPage } from './pages/ShelfPage.js';
import { BodyPage } from './pages/BodyPage.js';
import { DayPage } from './pages/DayPage.js';
import { NotesPage } from './pages/NotesPage.js';
import { BrowserPage } from './pages/BrowserPage.js';
import { MakePage } from './pages/MakePage.js';
import { ChatsPage } from './pages/ChatsPage.js';
import { ChatPage } from './pages/ChatPage.js';
import { AlbumPage } from './pages/AlbumPage.js';
import { LookPage } from './pages/LookPage.js';
import { RealPage } from './pages/RealPage.js';

// 角色手机。**拿起角色那台手机看一眼。**
//
// ---- 它自己有什么 ----
//
// 几乎没有。书架、身体状态、今天这些**数据早就在别处了**，各有各的来源：
// 书架挂在角色卡上、身体状态在 health、今天在 day。这个 app 只是换一个
// 角度把它们摆出来 —— 不是「你替角色设定的那几项」，而是「这台手机上现在
// 显示着什么」。
//
// ---- 为什么不直接跳去那几个 app ----
//
// 因为那几个页面是**设定页**：你在那儿替角色定今天累不累、定书架上有哪几本。
// 这里要的是反过来的那一面，看的时候不改。所以这里一律只读，
// 要改就按页脚那一行跳到真正的设定页去（走 Intent，不重开一套编辑）。
//
// 第 5 条：同一个开关只有一个入口。这里没有开关，只有视图。
//
// ---- 名字 ----
//
// 叫「角色手机」不叫「TA 的手机」：第 7 条，界面文案用书面语，
// 而且角色一律称「角色」。

// 锁着就先过锁屏。**每一页都要挡** —— 只挡主屏的话，从别处直接跳
// /body/xxx 就绕过去了，那道锁等于没有。
//
// 不再问「这台手机设过密码没有」：密码在数据层总是有的（system/theirs.js
// 的 localLock），所以这里只问一件事 —— 这一次打开期间解过没有。
function Guard({ charId, children }) {
  // hook 一律无条件调用。解开之后 open 记在内存里（见 system/theirs.js），
  // 这里只是为了让那一下能触发一次重渲染
  const [, bump] = useState(0);
  if (phone.theirs.isOpen(charId)) return children;
  return html`<${LockPage} charId=${charId} onOpen=${() => bump(n => n + 1)}/>`;
}

export default function TheirsApp({ route }) {
  // 一段会话按它自己的 id 走，不是按角色 id —— 所以单独一条分支。
  // 锁屏由 Guard 挡：那条会话属于哪台手机，问它自己
  const one = String(route || '').match(/^\/chat\/(.+)$/);
  if (one) {
    const row = phone.theirs.chat(one[1]);
    if (!row) return html`<${ChatPage} chatId=${one[1]}/>`;
    return html`<${Guard} charId=${row.charId}><${ChatPage} chatId=${one[1]}/><//>`;
  }

  // 和你的那一段：真数据，但在这台手机上看，不跳回「聊天」。
  // 路由里带上 charId，锁屏照样挡得住
  const rl = String(route || '').match(/^\/real\/([^/]+)\/(.+)$/);
  if (rl) {
    return html`<${Guard} charId=${rl[1]}>
      <${RealPage} charId=${rl[1]} chatId=${rl[2]}/><//>`;
  }

  const m = String(route || '/').match(/^\/(home|shelf|body|day|notes|browser|chats|album|look|make|lock)\/(.+)$/);
  if (m) {
    const [, page, charId] = m;
    // 锁屏本身单独一条路由：主屏上的「锁上」按它回到这儿。
    // 这一条不经过 Guard，所以解开之后自己回主屏
    if (page === 'lock') {
      return html`<${LockPage} charId=${charId}
        onOpen=${() => phone.nav.replace(`/home/${charId}`)}/>`;
    }
    const PAGES = {
      home: HomePage, shelf: ShelfPage, body: BodyPage, day: DayPage,
      notes: NotesPage, browser: BrowserPage, make: MakePage, chats: ChatsPage,
      album: AlbumPage, look: LookPage,
    };
    const Inner = PAGES[page] || HomePage;
    return html`<${Guard} charId=${charId}><${Inner} charId=${charId}/><//>`;
  }
  return html`<${PickPage}/>`;
}
