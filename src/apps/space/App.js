import { html } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, Avatar, EmptyState } from '../../ui/index.js';
import { SpacePage } from './SpacePage.js';
import { DaysPage } from './DaysPage.js';
import { PactsPage } from './PactsPage.js';
import { MailPage } from './MailPage.js';
import { LogPage } from './LogPage.js';

const { db, nav, space, accounts } = phone;

// 情侣空间。
//
// 一段单人会话就是一个空间，所以这一页列的就是当前身份名下的那几段关系。
// 换一个人设，列表跟着换 —— 不同人设各有各的空间，这一条是白来的，
// 因为关系本来就长在会话上。
//
// 空间里的内容绝大部分不是这个 app 自己存的：礼物墙、去过的地方、
// 一起听、通话都是聊天记录的另一种看法。见 system/space.js 开头。

function Row({ entry, onClick }) {
  const url = useImage(entry.char.avatar);
  const st = space.stats(entry.chat.id);
  const bits = [];
  if (st.days) bits.push(`在一起第 ${st.days} 天`);
  if (st.gifts) bits.push(`${st.gifts} 件礼物`);
  if (st.pactsOpen) bits.push(`${st.pactsOpen} 个约定未完成`);
  return html`
    <button class="sp-row press" onClick=${onClick}>
      <${Avatar} src=${url} name=${entry.char.name} size=${46}/>
      <div class="sp-row-body">
        <div class="sp-row-name ellipsis">${entry.char.name || '未命名'}</div>
        <div class="sp-row-sub ellipsis">${bits.join(' · ') || '还没有记录'}</div>
      </div>
    </button>`;
}

function Home() {
  useStore(db.chats.store);
  useStore(db.characters.store);
  useStore(db.messages.store);
  useStore(db.spaceItems.store);
  useStore(db.personas.store);

  const me = accounts.current();
  const list = space.spacesOf(accounts.currentId());

  return html`
    <${Page} title="情侣空间">
      ${list.length ? html`
        <div class="pad-x pad-t">
          <div class="hint-box">
            每一段单人对话对应一个空间。切换身份后，看到的是该身份名下的空间。
            当前身份：${me?.name || '我'}。
          </div>
          <div class="capsule">
            ${list.map(e => html`
              <${Row} key=${e.chat.id} entry=${e}
                onClick=${() => nav.push(`/space/${e.chat.id}`)}/>`)}
          </div>
        </div>`
      : html`<${EmptyState} icon="heart" title="还没有空间"
          desc="在「聊天」中与某个角色建立一对一的对话后，这里会出现对应的空间。"/>`}
    <//>`;
}

export default function SpaceApp({ route }) {
  const s = route?.match(/^\/space\/(.+)$/);
  if (s) return html`<${SpacePage} chatId=${s[1]}/>`;
  const d = route?.match(/^\/days\/(.+)$/);
  if (d) return html`<${DaysPage} chatId=${d[1]}/>`;
  const p = route?.match(/^\/pacts\/(.+)$/);
  if (p) return html`<${PactsPage} chatId=${p[1]}/>`;
  const m = route?.match(/^\/mail\/(.+)$/);
  if (m) return html`<${MailPage} chatId=${m[1]}/>`;
  const l = route?.match(/^\/log\/([^/]+)\/([^/]+)$/);
  if (l) return html`<${LogPage} chatId=${l[1]} kind=${l[2]}/>`;
  return html`<${Home}/>`;
}
