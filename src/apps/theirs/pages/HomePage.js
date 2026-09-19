import { html } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Icon, Avatar, EmptyState } from '../../../ui/index.js';

const { db, nav, shelf, health, day, clock } = phone;

// 那一块主屏。图标网格，和真的主界面一个意思：进来先看见有什么，再点进去。
//
// **没有内容的那一格不画。** 角色卡上没开「今天」，这台手机上就没有「今天」
// 这个 app —— 画一个点进去空着的格子，等于让人白点一次。

function Wall({ char, children }) {
  // 角色卡的封面当壁纸。没有就留底色，不去凑一张
  const url = useImage(char.cover);
  return html`
    <div class=${`tp-wall${url ? ' has-img' : ''}`}
      style=${url ? `background-image:url(${url})` : ''}>
      ${children}
    </div>`;
}

export function HomePage({ charId }) {
  useStore(db.characters.store);
  useStore(db.health.store);
  useStore(db.days.store);

  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="角色手机" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const books = shelf.listOf(charId);
  const d = day.today(charId);
  const body = health.dayOf(charId);
  const bodyOn = health.charOn(charId);

  // 每一格：有内容才画。副标题写此刻这一格里是什么，不写人设（第 6 条）
  const tiles = [
    books.length && {
      id: 'shelf', icon: 'book', label: '书架',
      sub: `${books.length} 本`, to: `/shelf/${charId}`,
    },
    bodyOn && {
      id: 'body', icon: 'pulse', label: '身体状态',
      sub: health.energyOf(body.energy)?.label || '今天还没有设定',
      to: `/body/${charId}`,
    },
    day.isOn(char) && {
      id: 'day', icon: 'calendar', label: '今天',
      sub: d ? `${(d.items || []).length} 项安排` : '今天还没有安排',
      to: `/day/${charId}`,
    },
  ].filter(Boolean);

  // 角色那边此刻几点。跟着它自己的时区走，和「今天」用的是同一套
  const hhmm = clock.clockOnly(clock.now(), clock.charZone(char));
  const weekday = day.weekdayOf(char);

  return html`
    <${Page} title=${char.name} onBack=${nav.pop} noScroll>
      <${Wall} char=${char}>
        <div class="tp-top">
          <${Avatar} src=${char.avatar} name=${char.name} size=${56}/>
          <b>${char.name}</b>
          <span>${hhmm}　${weekday}</span>
        </div>

        ${tiles.length ? html`
          <div class="tp-grid">
            ${tiles.map(t => html`
              <button key=${t.id} class="tp-tile press" onClick=${() => nav.push(t.to)}>
                <span class="tp-ico"><${Icon} name=${t.icon} size=${22}/></span>
                <b>${t.label}</b>
                <span class="tp-sub ellipsis">${t.sub}</span>
              </button>`)}
          </div>`
        : html`
          <div class="tp-empty">
            这台手机上还没有内容。在角色卡中开启「今天」或「身体状态」，
            或者为该角色添加书架，之后会出现在这里。
          </div>`}
      <//>
    <//>`;
}
