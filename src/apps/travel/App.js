import { html } from '../../lib.js';
import { ListPage } from './pages/ListPage.js';
import { NewPage } from './pages/NewPage.js';
import { TripPage } from './pages/TripPage.js';
import { TicketsPage } from './pages/TicketsPage.js';
import { GrabPage } from './pages/GrabPage.js';

// 出行。**一次旅行、一场演出、一场比赛，是同一个东西。**
//
// ---- 为什么不叫「旅游」 ----
//
// 看一场演唱会不一定要去外地。把它们分成两个 app，日期、预算、票、
// 攒钱这几样就要各写一遍，而它们本来一模一样。
//
// ---- 这个 app 管什么 ----
//
// 管**一次出行这件事本身**：去哪儿、什么时候、定了没、到哪一步了。
//
// 不管钱。钱在账本里，这里只显示那几笔和这次出行有关的流水（靠 tripId 认），
// 以及共同账户够不够。**在这儿再记一个「已攒多少」是不行的** ——
// 同一笔钱两处记，迟早对不上，而且不会报错。
//
// ---- 和会话的关系 ----
//
// 一次出行挂在一段会话上。角色在聊天里写 [旅行：…] 提议，你点同行就建一行；
// 你在这里新建，也落一条消息进那段会话 —— 它下一轮就看见了。
// 两个方向走的是同一套（system/trip.js 里那一段 propose/settle）。

export default function TravelApp({ route }) {
  const gb = String(route || '').match(/^\/grab\/([^/]+)\/(.+)$/);
  if (gb) return html`<${GrabPage} tripId=${gb[1]} ticketId=${gb[2]}/>`;
  const tk = String(route || '').match(/^\/tickets\/(.+)$/);
  if (tk) return html`<${TicketsPage} tripId=${tk[1]}/>`;
  const one = String(route || '').match(/^\/trip\/(.+)$/);
  if (one) return html`<${TripPage} tripId=${one[1]}/>`;
  if (route === '/new') return html`<${NewPage}/>`;
  return html`<${ListPage}/>`;
}
