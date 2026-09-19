import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState } from '../../../ui/index.js';

const { db, nav, shelf, intent } = phone;

// 这台手机上的书架。**只看不改** —— 加书、接真书都在「一起看」那边，
// 页脚给一条路过去（第 5 条：同一个开关只有一个入口）。
export function ShelfPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.ebooks.store);

  const char = db.characters.get(charId);
  const list = shelf.listOf(charId);

  if (!char) {
    return html`<${Page} title="书架" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  return html`
    <${Page} title="书架" onBack=${nav.pop}>
      ${list.length ? html`
        <${List} title=${`共 ${list.length} 本`}>
          ${list.map(it => html`
            <${ListItem} key=${it.id} title=${it.title} multiline
              arrow=${it.real}
              subtitle=${[
                it.author,
                it.real ? `已读 ${Math.round(it.percent * 100)}%` : '书架上有，但没有接上正文',
                it.note,
              ].filter(Boolean).join(' · ')}
              left=${html`<${Icon} name="book" size=${18}/>`}
              onClick=${it.real
                ? () => intent.open('theater', { route: `/book/${it.bookId}` })
                : null}/>`)}
        <//>`
      : html`
        <${EmptyState} icon="book" title="书架上还没有书"
          desc="在「一起看」中为该角色添加书目，之后会显示在这里。"/>`}

      <div class="settings-foot">
        本页只作查看。添加书目、接上正文与阅读进度都在「一起看」中处理。
      </div>
      <${List}>
        <${ListItem} title="前往「一起看」的书架" arrow
          left=${html`<${Icon} name="film" size=${18}/>`}
          onClick=${() => intent.open('theater', { route: `/shelf/${charId}` })}/>
      <//>
    <//>`;
}
