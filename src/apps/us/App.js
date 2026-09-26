import { html } from '../../lib.js';
import { Home } from './pages/Home.js';
import { WorkPage } from './pages/WorkPage.js';
import { WorkEdit, ChapterEdit } from './pages/WorkEdit.js';
import { ReadPage } from './pages/ReadPage.js';
import { NewSaga } from './pages/NewSaga.js';

// 我们。长篇与番外，正文那一套整个复用线下的。见 ARCHITECTURE 4.117
export default function UsApp({ route }) {
  const we = route?.match(/^\/work\/([^/]+)\/edit$/);
  if (we) return html`<${WorkEdit} workId=${we[1]}/>`;

  const wk = route?.match(/^\/work\/(.+)$/);
  if (wk) return html`<${WorkPage} workId=${wk[1]}/>`;

  const ce = route?.match(/^\/chapter\/(.+)$/);
  if (ce) return html`<${ChapterEdit} chapterId=${ce[1]}/>`;

  const rd = route?.match(/^\/read\/(.+)$/);
  if (rd) return html`<${ReadPage} chapterId=${rd[1]}/>`;

  // 长篇向导（4.263）。/new/<chatId> 是从会话菜单进来、人物已定的那条路
  const nw = route?.match(/^\/new(?:\/(.+))?$/);
  if (nw) return html`<${NewSaga} chatId=${nw[1] || ''}/>`;

  // 别的 app 说「打开这段关系的作品」时走这里
  const ch = route?.match(/^\/chat\/(.+)$/);
  if (ch) return html`<${Home} chatId=${ch[1]}/>`;

  return html`<${Home}/>`;
}
