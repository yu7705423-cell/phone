import { html } from '../../lib.js';
import { Icon } from '../../icons/Icon.js';
import { registerWidget } from '../../system/registry.js';
import { chats, moments, memories, characters, lastMessageOf, persona } from '../../system/db/index.js';
import { openApp } from '../../system/nav.js';

function relTime(ts) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  if (min < 1440) return `${Math.floor(min / 60)}小时前`;
  return `${Math.floor(min / 1440)}天前`;
}

registerWidget({
  id: 'header',
  label: '顶部横条',
  sizes: ['4x1'],
  render() {
    const now = new Date();
    const md = `${now.getMonth() + 1}月${now.getDate()}日`;
    const wd = '周' + '日一二三四五六'[now.getDay()];
    const me = persona.get();
    return html`
      <div class="wg wg-header">
        <div class="wg-header-main">
          <div class="wg-header-date">${md} ${wd}</div>
          <div class="wg-header-hi">${me.name ? `${me.name}，你好` : '你好'}</div>
        </div>
        <${Icon} name="sparkle" size=${20} style="color:var(--text-3)"/>
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
