import { html } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Icon, EmptyState } from '../../../ui/index.js';

const { db, nav, shelf, health, day, clock, theirs } = phone;

// 那一块主屏。**做成一块真的桌面**：壁纸铺满、顶上一行时间、底下一排图标，
// 没有导航栏，没有副标题，没有一格一张卡片。
//
// 从前这里是两列带副标题的卡片，看着像一页设置。可它是「拿起别人的手机」
// 这件事的第一眼 —— 第一眼看见一页设置，后面几页做得再像也回不来了。
//
// ---- 哪几格画出来 ----
//
// 聊天、相册、备忘录、浏览器是这台手机自带的，**空着也画** ——
// 真的手机上备忘录一条没有也还在桌面上，点进去是一页空的，不是没有这个应用。
// 那四页的空状态里各有一个「去生成」。
//
// 书架、身体状态、今天不一样：那三样的数据在别的系统里，那边关着的时候
// 这一格点进去什么也读不到。所以那三格跟着各自那个开关走 ——
// 相当于「这台手机上没装这个应用」。
//
// ---- 底下那一排 ----
//
// 生成、外观、锁上、退出是**你的**工具，不是这台手机上的应用，所以摆在
// 底部那一条里，和上面的图标分开。原先它们在导航栏右上角，那条栏现在没有了。
//
// 退出也摆在这一条里，不另画一道 Home Indicator ——
// 外壳底下已经有一道了，再画一道就是两道。边缘往里一划是同一件事
// （Page 的 onBack 照常传，只是藏了导航栏）。

function Wall({ char, own, children }) {
  // 自己换过的优先；没换过就用角色卡的封面 —— 那张本来就是这个角色的画面。
  // 两样都没有就留底色，不去凑一张
  const url = useImage(own || char.cover);
  return html`
    <div class=${`tp-desk${url ? ' has-img' : ''}`}
      style=${url ? `background-image:url(${url})` : ''}>
      ${children}
    </div>`;
}

// 一格。图标与名称可以在「外观」里换掉，所以这里每一格都过一道覆盖
function Cell({ charId, tile }) {
  const over = theirs.iconOf(charId, tile.id);
  const url = useImage(over.imageId);
  return html`
    <button class="tp-cell press" onClick=${() => nav.push(tile.to)}>
      <span class=${`tp-tile${url ? ' has-image' : ''}`}
        style=${url ? `background-image:url(${url})` : ''}>
        ${url ? null : html`<${Icon} name=${over.icon || tile.icon} size=${26}/>`}
      </span>
      <b class="tp-name ellipsis">${over.name || tile.label}</b>
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

  // 自带的四个照常画，空着也画。后面三个跟着各自那个开关走
  const tiles = [
    { id: 'chats', icon: 'message', label: '聊天', to: `/chats/${charId}` },
    { id: 'album', icon: 'camera', label: '相册', to: `/album/${charId}` },
    { id: 'notes', icon: 'notes', label: '备忘录', to: `/notes/${charId}` },
    { id: 'browser', icon: 'search', label: '浏览器', to: `/browser/${charId}` },
    books.length && { id: 'shelf', icon: 'book', label: '书架', to: `/shelf/${charId}` },
    health.charOn(charId)
      && { id: 'body', icon: 'pulse', label: '身体状态', to: `/body/${charId}` },
    day.isOn(char) && { id: 'day', icon: 'calendar', label: '今天', to: `/day/${charId}` },
  ].filter(Boolean);

  // 角色那边此刻几点。跟着它自己的时区走，和「今天」用的是同一套
  const hhmm = clock.clockOnly(clock.now(), clock.charZone(char));
  const wall = theirs.wallpaperOf(charId) || char.cover;

  const dock = [
    { id: 'make', icon: 'sparkle', label: '生成', run: () => nav.push(`/make/${charId}`) },
    { id: 'look', icon: 'image', label: '外观', run: () => nav.push(`/look/${charId}`) },
    { id: 'lock',
      icon: 'lock',
      label: '锁上',
      run: () => { theirs.relock(charId); nav.replace(`/lock/${charId}`); } },
    { id: 'out', icon: 'chevronLeft', label: '退出', run: nav.pop },
  ];

  return html`
    <${Page} onBack=${nav.pop} hideBar noScroll
      statusBarStyle=${wall ? 'light' : undefined}>
      <${Wall} char=${char} own=${theirs.wallpaperOf(charId)}>
        <div class="tp-desk-top">
          <b>${hhmm}</b>
          <span>${day.weekdayOf(char)}　${char.name}</span>
        </div>

        <div class="tp-apps">
          ${tiles.map(t => html`<${Cell} key=${t.id} charId=${charId} tile=${t}/>`)}
        </div>

        <div class="tp-dock">
          ${dock.map(d => html`
            <button key=${d.id} class="tp-dock-btn press" onClick=${d.run}>
              <${Icon} name=${d.icon} size=${20}/>
              <span>${d.label}</span>
            </button>`)}
        </div>
      <//>
    <//>`;
}
