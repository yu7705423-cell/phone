import { html } from '../../lib.js';
import { Icon } from '../../icons/Icon.js';
import { registerWidget } from '../../system/registry.js';
import { chats, moments, memories, characters, lastMessageOf, persona } from '../../system/db/index.js';
import { openApp } from '../../system/nav.js';
import { useImage } from '../../system/db/useImage.js';

function relTime(ts) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  if (min < 1440) return `${Math.floor(min / 60)}小时前`;
  return `${Math.floor(min / 1440)}天前`;
}

// ---- 顶部横条:播放器版式。一侧圆角方形封面,旁边三行字号递减的文本 ----
export const PLAYER_DEFAULT = {
  cover: null,
  line1: '还没有名字',
  line2: '点一下可以改这里的字',
  line3: '第三行更小一点，像歌词',
  align: 'left',      // 封面在左还是在右
};

function PlayerCover({ id }) {
  const url = useImage(id);
  return html`
    <div class="pl-cover" style=${url ? `background-image:url(${url})` : ''}>
      ${url ? null : html`<${Icon} name="image" size=${20}/>`}
    </div>`;
}

registerWidget({
  id: 'header',
  label: '顶部横条',
  sizes: ['4x2'],
  editable: true,
  defaults: PLAYER_DEFAULT,
  render(cell) {
    const c = { ...PLAYER_DEFAULT, ...(cell?.config || {}) };
    return html`
      <div class=${`wg wg-player${c.align === 'right' ? ' is-right' : ''}`}>
        <${PlayerCover} id=${c.cover}/>
        <div class="pl-text">
          <div class="pl-l1 ellipsis">${c.line1}</div>
          <div class="pl-l2 ellipsis">${c.line2}</div>
          <div class="pl-l3 ellipsis">${c.line3}</div>
        </div>
      </div>`;
  },
});

registerWidget({
  id: 'recent-chats',
  label: '最近会话',
  sizes: ['2x2'],
  render() {
    const list = chats.all()
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
      .slice(0, 3);
    return html`
      <div class="wg wg-list" onClick=${() => openApp('chat')}>
        <div class="wg-head"><${Icon} name="message" size=${15}/><span>最近会话</span></div>
        ${list.length ? list.map(c => {
          const char = characters.get((c.characterIds || [])[0]);
          const last = lastMessageOf(c.id);
          return html`
            <div key=${c.id} class="wg-row">
              <div class="wg-row-title ellipsis">${char?.name || c.title || '会话'}</div>
              <div class="wg-row-sub ellipsis">${last?.content || '还没有消息'}</div>
            </div>`;
        }) : html`<div class="wg-empty">还没有会话</div>`}
      </div>`;
  },
});

registerWidget({
  id: 'moments-peek',
  label: '朋友圈',
  sizes: ['2x2'],
  render() {
    const mo = moments.all().sort((a, b) => b.createdAt - a.createdAt)[0];
    const author = mo ? (mo.authorId === 'me' ? persona.get().name : characters.get(mo.authorId)?.name) : null;
    return html`
      <div class="wg wg-list" onClick=${() => openApp('chat', '/moments')}>
        <div class="wg-head"><${Icon} name="compass" size=${15}/><span>朋友圈</span></div>
        ${mo ? html`
          <div class="wg-moment">
            <div class="wg-row-title ellipsis">${author || '某人'}</div>
            <div class="wg-moment-text">${mo.text}</div>
            <div class="wg-row-sub">${relTime(mo.createdAt)}</div>
          </div>` : html`<div class="wg-empty">还没有动态</div>`}
      </div>`;
  },
});

registerWidget({
  id: 'memory-count',
  label: '记忆',
  sizes: ['2x2'],
  render() {
    const all = memories.all();
    const auto = all.filter(m => m.source === 'auto').length;
    return html`
      <div class="wg wg-stat" onClick=${() => openApp('memory')}>
        <div class="wg-head"><${Icon} name="brain" size=${15}/><span>记忆</span></div>
        <div class="wg-stat-num">${all.length}</div>
        <div class="wg-row-sub">其中 ${auto} 条自动提取</div>
      </div>`;
  },
});
