import { html } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Icon, Avatar, EmptyState } from '../../../ui/index.js';

const { db, nav, shelf, health, day, clock, theirs } = phone;

// 那一块主屏。图标网格，和真的主界面一个意思：进来先看见有什么，再点进去。
//
// **没有内容的那一格不画。** 角色卡上没开「今天」，这台手机上就没有「今天」
// 这个 app —— 画一个点进去空着的格子，等于让人白点一次。

function Wall({ char, own, children }) {
  // 自己换过的优先；没换过就用角色卡的封面 —— 那张本来就是这个角色的画面。
  // 两样都没有就留底色，不去凑一张
  const url = useImage(own || char.cover);
  return html`
    <div class=${`tp-wall${url ? ' has-img' : ''}`}
      style=${url ? `background-image:url(${url})` : ''}>
      ${children}
    </div>`;
}

// 一格。图标与名称可以在「外观」里换掉，所以这里每一格都过一道覆盖
function Cell({ charId, tile }) {
  const over = theirs.iconOf(charId, tile.id);
  const url = useImage(over.imageId);
  return html`
    <button class="tp-tile press" onClick=${() => nav.push(tile.to)}>
      <span class=${`tp-ico${url ? ' has-img' : ''}`}
        style=${url ? `background-image:url(${url})` : ''}>
        ${url ? null : html`<${Icon} name=${over.icon || tile.icon} size=${22}/>`}
      </span>
      <b>${over.name || tile.label}</b>
      <span class="tp-sub ellipsis">${tile.sub}</span>
    </button>`;
}

export function HomePage({ charId }) {
  useStore(db.characters.store);
  useStore(db.health.store);
  useStore(db.days.store);
  useStore(db.phones.store);
  useStore(db.phoneChats.store);
  useStore(db.chats.store);

  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="角色手机" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const books = shelf.listOf(charId);
  const notes = theirs.notesOf(charId);
  const visits = theirs.visitsOf(charId);
  const talks = theirs.chatsOf(charId);
  const shots = theirs.photosOf(charId);
  // 和用户的那几段是真的，它们也该出现在这台手机的聊天里
  const withYou = db.chats.all().filter(c => (c.characterIds || []).includes(charId)).length;
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
    (talks.length || withYou) && {
      id: 'chats', icon: 'message', label: '聊天',
      sub: `${talks.length + withYou} 条会话`, to: `/chats/${charId}`,
    },
    shots.length && {
      id: 'album', icon: 'camera', label: '相册',
      sub: `${shots.length} 张`, to: `/album/${charId}`,
    },
    notes.length && {
      id: 'notes', icon: 'notes', label: '备忘录',
      sub: `${notes.length} 条`, to: `/notes/${charId}`,
    },
    visits.length && {
      id: 'browser', icon: 'search', label: '浏览器',
      sub: `${visits.length} 条记录`, to: `/browser/${charId}`,
    },
  ].filter(Boolean);

  // 角色那边此刻几点。跟着它自己的时区走，和「今天」用的是同一套
  const hhmm = clock.clockOnly(clock.now(), clock.charZone(char));
  const weekday = day.weekdayOf(char);

  return html`
    <${Page} title=${char.name} onBack=${nav.pop} noScroll
      right=${html`<button class="nav-text press"
        onClick=${() => { theirs.relock(charId); nav.replace(`/lock/${charId}`); }}>
        ${theirs.locked(charId) ? '锁上' : '设定密码'}
      </button>`}>
      <${Wall} char=${char} own=${theirs.wallpaperOf(charId)}>
        <div class="tp-top">
          <${Avatar} src=${char.avatar} name=${char.name} size=${56}/>
          <b>${char.name}</b>
          <span>${hhmm}　${weekday}</span>
        </div>

        ${tiles.length ? html`
          <div class="tp-grid">
            ${tiles.map(t => html`<${Cell} key=${t.id} charId=${charId} tile=${t}/>`)}
          </div>`
        : html`
          <div class="tp-empty">
            这台手机上还没有内容。可以依据该角色的设定生成，
            也可以在角色卡中开启「今天」与「身体状态」，或为该角色添加书架。
          </div>`}

        <div class="tp-make">
          <button class="press" onClick=${() => nav.push(`/make/${charId}`)}>
            <${Icon} name="sparkle" size=${15}/>
            <span>${tiles.length ? '生成更多内容' : '生成这台手机里的内容'}</span>
          </button>
          <button class="press" onClick=${() => nav.push(`/look/${charId}`)}>
            <${Icon} name="image" size=${15}/>
            <span>外观</span>
          </button>
        </div>
      <//>
    <//>`;
}
