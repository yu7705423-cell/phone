import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState } from '../../../ui/index.js';

const { db, nav, day, events, intent } = phone;

// 这台手机上的今天。**只看不改** —— 安排、重排、勾完成都在「一天」那边。
export function DayPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.days.store);

  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="今天" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const d = day.today(charId);
  const items = d?.items || [];
  const nowSlot = day.slotNow(char)?.id;

  return html`
    <${Page} title="今天" onBack=${nav.pop}>
      ${items.length ? html`
        <${List} title=${`${d.date}　${day.weekdayOf(char)}`}>
          ${items.map(it => html`
            <${ListItem} key=${it.id} title=${it.text} multiline
              subtitle=${[
                day.slotOf(it.slot)?.label,
                it.slot === nowSlot ? '正是此刻' : '',
                it.state === day.DONE ? '已完成' : it.state === day.DROP ? '已取消' : '',
              ].filter(Boolean).join(' · ')}
              left=${html`<${Icon}
                name=${it.state === day.DONE ? 'check' : it.state === day.DROP ? 'close' : 'clock'}
                size=${18}/>`}/>`)}
        <//>`
      : html`
        <${EmptyState} icon="calendar" title="今天还没有安排"
          desc="在「一天」中为该角色安排今天，之后会显示在这里。"/>`}

      ${d?.event?.text ? html`
        <${List} title="今天遇上的事">
          <${ListItem} title=${d.event.text} multiline
            subtitle=${events.toneOf(d.event.tone)?.label || ''}
            left=${html`<${Icon} name="sparkle" size=${18}/>`}/>
        <//>` : null}

      <div class="settings-foot">
        本页只作查看。安排与调整都在「一天」中处理，本页不作改动。
      </div>
      <${List}>
        <${ListItem} title="前往「一天」" arrow
          left=${html`<${Icon} name="calendar" size=${18}/>`}
          onClick=${() => intent.open('daily', { route: `/today/${charId}` })}/>
      <//>
    <//>`;
}
