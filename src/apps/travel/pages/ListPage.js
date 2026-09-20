import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, Button, EmptyState } from '../../../ui/index.js';

const { db, nav, trip } = phone;

// 全部出行，按阶段分组。
//
// **进行中的排最前，已结束的收在最后。** 一次出行活着的时候你每天都要看它，
// 结束之后只是偶尔回头翻一眼 —— 两者不该在同一段里按时间混排。
//
// 每一行写的是**算出来的那几个数**：还有几天、第几天、几天几夜。
// 不写「快到了」这种形容，写「还有 3 天」（第 7 条：陈述句，不带情绪）。

const GROUPS = [
  { phase: trip.GOING, title: '进行中' },
  { phase: trip.SOON, title: '待出发' },
  { phase: trip.TALKING, title: '商量中' },
  { phase: trip.DONE, title: '已结束' },
  { phase: trip.DROPPED, title: '已取消' },
];

function subtitleOf(row) {
  const bits = [];
  const k = trip.kindOf(row.kind);
  bits.push(k.label);
  if (row.place) bits.push(row.place);
  const phase = trip.phaseOf(row);
  if (phase === trip.SOON) {
    const d = trip.daysUntil(row);
    bits.push(d === 0 ? '今天出发' : d != null ? `还有 ${d} 天` : '日期待定');
  } else if (phase === trip.GOING) {
    bits.push(`第 ${trip.dayIndex(row)} 天，共 ${trip.nights(row)} 天`);
  } else if (row.from) {
    bits.push(row.from);
  }
  if (phase === trip.TALKING && !row.agreed) bits.push('对方尚未回应');
  return bits.join(' · ');
}

export function ListPage() {
  useStore(db.trips.store);
  useStore(db.chats.store);
  useStore(db.characters.store);

  const rows = trip.all();
  const nameOf = row => {
    const chat = db.chats.get(row.chatId);
    const char = chat && db.characters.get((chat.characterIds || [])[0]);
    return char?.name || '';
  };

  const add = html`<button class="nav-text press"
    onClick=${() => nav.push('/new')}>新建</button>`;

  if (!rows.length) {
    return html`
      <${Page} title="出行" right=${add}>
        <${EmptyState} icon="compass" title="还没有出行计划"
          desc="新建一次出行，或在聊天中由角色提出。出行的支出记在该段对话绑定的账本上。"
          action=${html`<${Button} size="sm" icon="plus"
            onClick=${() => nav.push('/new')}>新建<//>`}/>
      <//>`;
  }

  return html`
    <${Page} title="出行" right=${add}>
      ${GROUPS.map(g => {
        const list = rows.filter(r => trip.phaseOf(r) === g.phase);
        if (!list.length) return null;
        return html`
          <${List} key=${g.phase} title=${`${g.title} ${list.length}`}>
            ${list.map(r => html`
              <${ListItem} key=${r.id} arrow multiline
                title=${`${r.title}${nameOf(r) ? `　与 ${nameOf(r)}` : ''}`}
                subtitle=${subtitleOf(r)}
                left=${html`<${Icon} name=${trip.kindOf(r.kind).icon} size=${18}/>`}
                onClick=${() => nav.push(`/trip/${r.id}`)}/>`)}
          <//>`;
      })}
      <div class="settings-foot">
        进行中与待出发由出发日期计算得出，不需要手动切换。
        出行的支出记在该段对话绑定的账本上，此处不另记金额。
      </div>
    <//>`;
}
