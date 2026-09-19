import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState } from '../../../ui/index.js';

const { db, nav, health, intent } = phone;

// 这台手机上的身体状态。**只看不改** —— 设定在「健康」那边。
//
// 一行一项，没设定的那一项不列 —— 列一行「未设定」等于用空话占地方。
export function BodyPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.health.store);

  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="身体状态" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const d = health.dayOf(charId);
  const poops = d.poops || [];
  const rows = [
    health.energyOf(d.energy) && { icon: 'power', t: '精力', v: health.energyOf(d.energy).label },
    health.moodOf(d.mood) && { icon: 'heart', t: '心情', v: health.moodOf(d.mood).label },
    (d.symptoms || []).length && {
      icon: 'pulse', t: '不适',
      v: d.symptoms.map(x => health.symptomOf(x)?.label).filter(Boolean).join('、'),
    },
    d.sleepMin && { icon: 'moon', t: '睡眠', v: health.fmtSleep(d.sleepMin) },
    poops.length && {
      icon: 'clock', t: '排便',
      v: `${poops.length} 次` + (() => {
        const bits = poops.map(e => [health.poopTime(e), health.poopFormOf(e.form)?.label]
          .filter(Boolean).join(' ')).filter(Boolean);
        return bits.length ? `（${bits.join('、')}）` : '';
      })(),
    },
    d.note && { icon: 'notes', t: '另外', v: d.note },
  ].filter(Boolean);

  return html`
    <${Page} title="身体状态" onBack=${nav.pop}>
      ${rows.length ? html`
        <${List} title=${d.date}>
          ${rows.map(r => html`
            <${ListItem} key=${r.t} title=${r.t} multiline subtitle=${r.v}
              left=${html`<${Icon} name=${r.icon} size=${18}/>`}/>`)}
        <//>`
      : html`
        <${EmptyState} icon="pulse" title="今天还没有设定"
          desc="在「健康」中为该角色设定今天的状态，之后会显示在这里。"/>`}

      <div class="settings-foot">
        本页只作查看。该角色的身体状态由你在「健康」中设定，本页不作改动。
      </div>
      <${List}>
        <${ListItem} title="前往「健康」设定" arrow
          left=${html`<${Icon} name="pulse" size=${18}/>`}
          onClick=${() => intent.open('health', { route: `/char/${charId}` })}/>
      <//>
    <//>`;
}
