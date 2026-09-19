import { html } from '../../lib.js';
import { PickPage } from './pages/PickPage.js';
import { HomePage } from './pages/HomePage.js';
import { ShelfPage } from './pages/ShelfPage.js';
import { BodyPage } from './pages/BodyPage.js';
import { DayPage } from './pages/DayPage.js';

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

export default function TheirsApp({ route }) {
  const m = String(route || '/').match(/^\/(home|shelf|body|day)\/(.+)$/);
  if (m) {
    const [, page, charId] = m;
    if (page === 'home') return html`<${HomePage} charId=${charId}/>`;
    if (page === 'shelf') return html`<${ShelfPage} charId=${charId}/>`;
    if (page === 'body') return html`<${BodyPage} charId=${charId}/>`;
    if (page === 'day') return html`<${DayPage} charId=${charId}/>`;
  }
  return html`<${PickPage}/>`;
}
