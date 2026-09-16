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

// ---- 播放器版式横条 ----
export const LINE_SIZES = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
  { value: 'xl', label: '特大' },
];

export const PLAYER_DEFAULT = {
  cover: null,
  align: 'left',
  line1: 'Cosy Hope',   size1: 'md',
  line2: 'Sweet Serene', size2: 'xl',
  line3: 'Tender Dawn',  size3: 'lg',
  serif: true,
};

function Cover({ id }) {
  const url = useImage(id);
  return html`
    <div class="pl-cover" style=${url ? `background-image:url(${url})` : ''}>
      ${url ? null : html`<${Icon} name="image" size=${22}/>`}
    </div>`;
}

registerWidget({
  id: 'player',
  label: '播放器横条',
  sizes: [[4, 2]],
  editable: true,
  render(cell) {
    const c = { ...PLAYER_DEFAULT, ...(cell?.config || {}) };
    return html`
      <div class=${`wg wg-player${c.align === 'right' ? ' is-right' : ''}${c.serif ? ' is-serif' : ''}`}>
        <${Cover} id=${c.cover}/>
        <div class="pl-text">
          <div class=${`pl-line pl-${c.size1}`}>${c.line1}</div>
          <div class=${`pl-line pl-${c.size2}`}>${c.line2}</div>
          <div class=${`pl-line pl-${c.size3}`}>${c.line3}</div>
        </div>
        <${Icon} name="sparkle" size=${18} class="pl-mark"/>
      </div>`;
  },
});

// ---- 自由文字块，任意尺寸 ----
export const NOTE_DEFAULT = { line1: '写点什么', size1: 'lg', line2: '', size2: 'sm', serif: false };

registerWidget({
  id: 'note',
  label: '文字块',
  sizes: [[2, 1], [2, 2], [4, 1], [4, 2]],
  editable: true,
  render(cell) {
    const c = { ...NOTE_DEFAULT, ...(cell?.config || {}) };
    return html`
      <div class=${`wg wg-note${c.serif ? ' is-serif' : ''}`}>
        <div class=${`pl-line pl-${c.size1}`}>${c.line1}</div>
        ${c.line2 ? html`<div class=${`pl-line pl-${c.size2}`}>${c.line2}</div>` : null}
      </div>`;
  },
});

// ---- 大图块 ----
registerWidget({
  id: 'photo',
  label: '图片块',
  sizes: [[2, 2], [4, 2], [2, 1]],
  editable: true,
  render(cell) {
    const c = cell?.config || {};
    return html`<${PhotoBody} id=${c.cover} caption=${c.line1}/>`;
  },
});

function PhotoBody({ id, caption }) {
  const url = useImage(id);
  return html`
    <div class="wg wg-photo" style=${url ? `background-image:url(${url})` : ''}>
      ${url ? null : html`<div class="wg-photo-empty"><${Icon} name="image" size=${24}/></div>`}
      ${caption ? html`<div class="wg-photo-cap">${caption}</div>` : null}
    </div>`;
}

registerWidget({
  id: 'recent-chats',
  label: '最近会话',
  sizes: [[2, 2], [4, 2]],
  render() {
    const list = chats.all()
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
      .slice(0, 3);
    return html`
      <div class="wg wg-list" onClick=${() => openApp('chat')}>
        <div class="wg-head"><${Icon} name="message" size=${15}/><span>最近会话</span></div>
        ${list.length ? html`<div class="wg-rows">
          ${list.map(c => {
            const char = characters.get((c.characterIds || [])[0]);
            const last = lastMessageOf(c.id);
            return html`
              <div key=${c.id} class="wg-row">
                <div class="wg-row-title ellipsis">${char?.name || c.title || '会话'}</div>
                <div class="wg-row-sub ellipsis">${last?.content || '还没有消息'}</div>
              </div>`;
          })}
        </div>` : html`<div class="wg-empty">还没有会话</div>`}
      </div>`;
  },
});

registerWidget({
  id: 'moments-peek',
  label: '朋友圈',
  sizes: [[2, 2], [4, 2]],
  render() {
    const mo = moments.all().sort((a, b) => b.createdAt - a.createdAt)[0];
    const author = mo ? (mo.authorId === 'me' ? persona.get().name : characters.get(mo.authorId)?.name) : null;
    return html`
      <div class="wg wg-list" onClick=${() => openApp('chat', '/moments')}>
        <div class="wg-head"><${Icon} name="moments" size=${15}/><span>朋友圈</span></div>
        ${mo ? html`
          <div class="wg-rows">
            <div class="wg-row-title ellipsis">${author || '某人'}</div>
            <div class="wg-moment-text">${mo.text}</div>
            <div class="wg-row-sub">${relTime(mo.createdAt)}</div>
          </div>` : html`<div class="wg-empty">还没有动态</div>`}
      </div>`;
  },
});

registerWidget({
  id: 'memory-count',
  label: '记忆统计',
  sizes: [[2, 2], [2, 1]],
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

registerWidget({
  id: 'clock',
  label: '时间',
  sizes: [[2, 1], [2, 2], [4, 1]],
  render() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return html`
      <div class="wg wg-clock">
        <div class="wg-clock-time">${hh}:${mm}</div>
        <div class="wg-row-sub">${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]}</div>
      </div>`;
  },
});
