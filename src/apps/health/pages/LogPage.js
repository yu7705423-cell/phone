import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Segmented, Icon, EmptyState, confirm } from '../../../ui/index.js';

const { db, nav, health } = phone;

const FIELDS = [
  { id: 'weight', label: '体重', pick: r => r.weight, fmt: v => `${health.toDisplay(v)} ${health.unit()}` },
  { id: 'sleepMin', label: '睡眠', pick: r => r.sleepMin, fmt: v => health.fmtSleep(v) },
  { id: 'steps', label: '步数', pick: r => r.steps, fmt: v => v.toLocaleString() },
];

// 一条极简折线。黑白，跟着 currentColor 走，不引入任何色相（第 4 条）
function Spark({ points }) {
  if (points.length < 2) return null;
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.v);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const W = 100;
  const H = 28;
  const d = points.map((p, i) => {
    const x = (xs[i] / (points.length - 1)) * W;
    const y = H - ((p.v - lo) / span) * (H - 4) - 2;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return html`
    <svg class="hl-spark" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d=${d}/>
    </svg>`;
}

export function LogPage() {
  useStore(db.health.store);
  useStore(db.settings.store);
  const [field, setField] = useState('weight');

  const rows = health.recent(health.ME, 999);
  const f = FIELDS.find(x => x.id === field) || FIELDS[0];
  // 画趋势要按时间从早到晚，列表要从晚到早
  const series = rows.slice().reverse()
    .map(r => ({ date: r.date, v: f.pick(r) || 0 }))
    .filter(p => p.v > 0)
    .slice(-30);

  const wipe = async () => {
    if (!await confirm({ title: '清空全部记录', danger: true,
      message: '删除你自己的全部每日记录。经期与用药不受影响。' })) return;
    health.wipe(health.ME);
  };

  if (!rows.length) {
    return html`<${Page} title="历史" onBack=${nav.pop}>
      <${EmptyState} icon="layers" title="还没有记录"
        desc="在「健康」首页记下今天的情况，之后这里会按天列出来。"/><//>`;
  }

  return html`
    <${Page} title="历史" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${wipe}>清空</button>`}>
      <div class="pad-x pad-t">
        <${Segmented} value=${field} onChange=${setField}
          items=${FIELDS.map(x => ({ value: x.id, label: x.label }))}/>
        ${series.length >= 2 ? html`
          <div class="hl-trend">
            <${Spark} points=${series}/>
            <div class="hl-trend-foot">
              <span>${series[0].date}</span>
              <span>${f.fmt(series[series.length - 1].v)}</span>
            </div>
          </div>`
        : html`<div class="settings-foot">这一项记满两天之后会画出趋势。</div>`}
      </div>

      <${List} title=${`共 ${rows.length} 天`}>
        ${rows.map(r => {
          const bits = [
            r.sleepMin ? health.fmtSleep(r.sleepMin) : '',
            r.steps ? `${r.steps.toLocaleString()} 步` : '',
            r.weight ? `${health.toDisplay(r.weight)} ${health.unit()}` : '',
            r.water ? `${r.water} 杯水` : '',
            health.moodOf(r.mood)?.label,
            health.energyOf(r.energy)?.label,
            (r.symptoms || []).map(x => health.symptomOf(x)?.label).filter(Boolean).join('、'),
            r.note,
          ].filter(Boolean).join(' · ');
          return html`
            <${ListItem} key=${r.id} title=${r.date} multiline
              subtitle=${bits || '这一天没有填内容'}
              left=${html`<${Icon} name="calendar" size=${18}/>`}/>`;
        })}
      <//>
    <//>`;
}
