import { html, useState, useMemo } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Switch, EmptyState } from '../../../ui/index.js';
import { splitBubbles } from '../helpers.js';

// 那年今天。见 ARCHITECTURE 4.166
//
// 往年的这一天这段对话里说过什么。默认看今天，左右翻到别的日期。
// 每一年先露几条，展开看全部 —— 露几条是默认值，不是上限（CLAUDE.md 第 13 条）。

const { db, nav } = phone;
const DAY = 86400000;
const PEEK = 6;

// 非文字消息写成一个方括号标签，和消息列表那一行同一个写法
const KIND = {
  sticker: '[表情]', image: '[图片]', voice: '[语音]', transfer: '[转账]', location: '[位置]',
  gift: '[礼物]', trip: '[旅行]', takeout: '[外卖]', dice: '[骰子]', award: '[标识]', outfit: '[搭配]', groom: '[动作]', dresscode: '[穿搭盲盒]', slip: '[包里的东西]', narration: '[旁白]',
  listen: '[一起听]', watch: '[一起看]', read: '[一起读]', call: '[通话]', letter: '[信]',
  pact: '[约定]', request: '[申请]', excerpt: '[摘录]', video: '[视频]',
};
const textOf = m => {
  if (!m.kind || m.kind === 'text') return splitBubbles(m.content || '').join(' ') || m.content || '';
  return KIND[m.kind] || '[消息]';
};
const hm = t => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function OnThisDayPage({ chatId }) {
  useStore(db.chats.store);
  useStore(db.characters.store);
  const [at, setAt] = useState(Date.now());
  const [open, setOpen] = useState({});
  const chat = db.chats.get(chatId);
  const years = useMemo(() => (chat ? phone.onThisDay.ofChat(chatId, at) : []), [chatId, at, !!chat]);

  if (!chat) {
    return html`<${Page} title="那年今天" onBack=${nav.pop}><${EmptyState} title="该会话已不存在"/><//>`;
  }
  const nameOf = m => (m.role === 'user'
    ? (phone.accounts.current()?.name || '我')
    : db.characters.get(m.authorId)?.name || '角色');
  const day = new Date(at);
  const isToday = day.toDateString() === new Date().toDateString();
  const step = n => { setAt(t => t + n * DAY); setOpen({}); };

  return html`
    <${Page} title="那年今天" onBack=${nav.pop}>
      <div class="yr-head">
        <button class="nav-text press" onClick=${() => step(-1)}>前一天</button>
        <b>${day.getMonth() + 1} 月 ${day.getDate()} 日${isToday ? ' · 今天' : ''}</b>
        <button class="nav-text press" onClick=${() => step(1)}>后一天</button>
      </div>
      ${isToday ? null : html`
        <div class="otd-back"><button class="nav-text press" onClick=${() => { setAt(Date.now()); setOpen({}); }}>回到今天</button></div>`}

      ${years.length ? years.map(y => {
        const all = !!open[y.year];
        const shown = all ? y.msgs : y.msgs.slice(0, PEEK);
        return html`
          <${List} key=${y.year} title=${`${y.ago} 年前 · ${y.year} 年 · 共 ${y.msgs.length} 条`}>
            <div class="otd-day">
              ${shown.map(m => html`
                <div key=${m.id} class=${`otd-line${m.role === 'user' ? ' is-mine' : ''}`}>
                  <span class="otd-who">${nameOf(m)}</span>
                  <span class="otd-time">${hm(m.createdAt)}</span>
                  <div class="otd-text">${textOf(m)}</div>
                </div>`)}
            </div>
            ${y.msgs.length > PEEK ? html`
              <${ListItem} title=${all ? '收起' : `展开全部 ${y.msgs.length} 条`}
                onClick=${() => setOpen(o => ({ ...o, [y.year]: !all }))}/>` : null}
            <${ListItem} title="在聊天中查看" arrow
              subtitle="跳到这一天的第一条消息"
              onClick=${() => nav.push(`/chat/${chatId}@${y.msgs[0].id}`)}/>
          <//>`;
      }) : html`<${EmptyState} title="往年的这一天没有对话记录"
          desc="只列出你与角色都发过消息的日子。可以翻看前后的日期。"/>`}

      <${List} title="提醒">
        <${ListItem} title="每天提醒" multiline
          subtitle=${phone.onThisDay.remindOn(chat)
            ? '已开启。往年的今天有对话时，每天 9 点之后提醒一次。本地通知，不调用接口。'
            : '已关闭。'}
          right=${html`<${Switch} checked=${phone.onThisDay.remindOn(chat)}
            onChange=${v => phone.onThisDay.setRemind(chatId, v)}/>`}/>
      <//>
    <//>`;
}
