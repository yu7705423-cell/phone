import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Icon, Button,
         Sheet, toast } from '../../ui/index.js';
import { PoopField } from './parts.js';
import { LogPage } from './pages/LogPage.js';
import { CyclePage } from './pages/CyclePage.js';
import { MedsPage } from './pages/MedsPage.js';
import { CharPage } from './pages/CharPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

const { db, nav, health } = phone;

// 健康。**一本记录，不是一个会看病的东西。**
// 全程不调接口：没有评估、没有建议。角色看到之后怎么反应由它的人设决定。

function Today() {
  useStore(db.health.store);
  useStore(db.meds.store);
  useStore(db.cycles.store);
  useStore(db.characters.store);
  useStore(db.settings.store);
  const [editing, setEditing] = useState(null);

  const date = health.dateKey();
  const d = health.today();
  const u = health.unit();
  const open = health.openCycle();
  const pred = health.predictCycle();
  const due = health.dueMeds();
  const chars = health.charsWithHealth();

  const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  return html`
    <${Page} title="健康"
      right=${html`<button class="nav-text press"
        onClick=${() => nav.push('/settings')}>设置</button>`}>

      <div class="hl-grid">
        <button class="hl-tile press" onClick=${() => setEditing('sleep')}>
          <${Icon} name="moon" size=${17}/>
          <b>${d.sleepMin ? health.fmtSleep(d.sleepMin) : '—'}</b>
          <span>睡眠</span>
        </button>
        <button class="hl-tile press" onClick=${() => setEditing('steps')}>
          <${Icon} name="compass" size=${17}/>
          <b>${d.steps ? d.steps.toLocaleString() : '—'}</b>
          <span>步数</span>
        </button>
        <button class="hl-tile press" onClick=${() => setEditing('weight')}>
          <${Icon} name="database" size=${17}/>
          <b>${d.weight ? `${health.toDisplay(d.weight)}` : '—'}</b>
          <span>体重 ${u}</span>
        </button>
        <button class="hl-tile press" onClick=${() => health.addWater()}>
          <${Icon} name="cup" size=${17}/>
          <b>${d.water || 0}</b>
          <span>喝水 · 点一下加一杯</span>
        </button>
      </div>

      <div class="pad-x">
        <${Field} label="今天怎么样">
          <${Segmented} value=${d.mood} onChange=${v => health.set(health.ME, date, { mood: v })}
            items=${health.MOODS.map(m => ({ value: m.id, label: m.label }))}/>
        <//>
        <${Field} label="精力">
          <${Segmented} value=${d.energy} onChange=${v => health.set(health.ME, date, { energy: v })}
            items=${health.ENERGY.map(m => ({ value: m.id, label: m.label }))}/>
        <//>
        <${Field} label="哪里不舒服" desc="点一下记上，再点取消。都没有就空着。">
          <div class="chip-row">
            ${health.SYMPTOMS.map(sy => html`
              <button key=${sy.id}
                class=${`chip${(d.symptoms || []).includes(sy.id) ? ' is-active' : ''}`}
                onClick=${() => health.toggleSymptom(health.ME, date, sy.id)}>${sy.label}</button>`)}
          </div>
        <//>
        <${PoopField} who=${health.ME} date=${date} list=${d.poops}/>
        <${Field} label="另外记一句" desc="可留空。">
          <${Input} value=${d.note} placeholder="可留空"
            onInput=${v => health.set(health.ME, date, { note: v.slice(0, 200) })}/>
        <//>
      </div>

      ${health.activeMeds().length ? html`
        <${List} title=${`今天要吃的 · ${(d.took || []).length}/${health.activeMeds().length}`}>
          ${health.activeMeds().map(m => html`
            <${ListItem} key=${m.id} title=${m.name} multiline
              subtitle=${[m.dose, (m.times || []).join('、')].filter(Boolean).join(' · ') || '没有设定时间'}
              left=${html`
                <span class=${`pick-dot${(d.took || []).includes(m.id) ? ' is-on' : ''}`}>
                  ${(d.took || []).includes(m.id) ? html`<${Icon} name="check" size=${11}/>` : null}
                </span>`}
              onClick=${() => health.takeMed(m.id)}/>`)}
        <//>` : null}

      ${due.length ? html`
        <div class="settings-foot">
          ${due.map(m => m.name).join('、')} 到时间了，还没有记上。
        </div>` : null}

      <${List}>
        <${ListItem} title="历史与趋势" arrow multiline
          subtitle=${`已记 ${health.recent(health.ME, 999).length} 天`}
          left=${html`<${Icon} name="layers" size=${18}/>`}
          onClick=${() => nav.push('/log')}/>
        <${ListItem} title="经期" arrow multiline
          subtitle=${open ? `${open.start} 开始，还没有记结束`
            : pred ? `按已记的 ${pred.samples} 次推算，下次约在 ${pred.next}`
            : '记下每次的开始与结束，记满两次之后可以推算'}
          left=${html`<${Icon} name="calendar" size=${18}/>`}
          onClick=${() => nav.push('/cycle')}/>
        <${ListItem} title="用药" arrow multiline
          subtitle=${health.activeMeds().length
            ? `${health.activeMeds().length} 项，到点提醒`
            : '记下在吃什么、什么时候吃'}
          left=${html`<${Icon} name="bookmark" size=${18}/>`}
          onClick=${() => nav.push('/meds')}/>
      <//>

      ${chars.length ? html`
        <${List} title="角色的身体状态">
          ${chars.map(c => {
            const cd = health.dayOf(c.id);
            const bits = [health.energyOf(cd.energy)?.label,
              (cd.symptoms || []).map(x => health.symptomOf(x)?.label).filter(Boolean).join('、')]
              .filter(Boolean).join(' · ');
            return html`
              <${ListItem} key=${c.id} title=${c.name} arrow multiline
                subtitle=${bits || '今天还没有设定'}
                left=${html`<${Icon} name="user" size=${18}/>`}
                onClick=${() => nav.push(`/char/${c.id}`)}/>`;
          })}
        <//>` : null}

      <div class="settings-foot">
        这里只做记录。所有数字都是你自己填的，不作任何健康评估，也不给建议。
      </div>

      <${Sheet} open=${!!editing} onClose=${() => setEditing(null)}
        title=${{ sleep: '睡眠', steps: '步数', weight: '体重' }[editing] || ''}>
        <div class="pad-x">
          ${editing === 'sleep' ? html`
            <${Field} label="睡了多久" desc="按分钟填。七个半小时就填 450。">
              <${Input} value=${d.sleepMin || ''} type="number" inputmode="numeric"
                placeholder="450"
                onInput=${v => health.set(health.ME, date, { sleepMin: num(v) })}/>
            <//>
            <${Field} label="几点睡的" desc="可留空。">
              <${Input} value=${d.sleepAt} placeholder="23:40"
                onInput=${v => health.set(health.ME, date, { sleepAt: v.trim().slice(0, 5) })}/>
            <//>` : null}
          ${editing === 'steps' ? html`
            <${Field} label="今天走了多少步">
              <${Input} value=${d.steps || ''} type="number" inputmode="numeric"
                placeholder="8000"
                onInput=${v => health.set(health.ME, date, { steps: num(v) })}/>
            <//>` : null}
          ${editing === 'weight' ? html`
            <${Field} label=${`体重（${u}）`} desc="按公斤存，换单位不会改到已记的数。">
              <${Input} value=${d.weight ? health.toDisplay(d.weight) : ''}
                type="number" inputmode="decimal" placeholder=${u === 'lb' ? '130' : '58'}
                onInput=${v => health.set(health.ME, date,
                  { weight: v === '' ? 0 : health.fromDisplay(v) })}/>
            <//>` : null}
          <div class="pad-b">
            <${Button} full variant="ghost" onClick=${() => setEditing(null)}>好了<//>
          </div>
        </div>
      <//>
    <//>`;
}

export default function HealthApp({ route }) {
  if (route === '/log') return html`<${LogPage}/>`;
  if (route === '/cycle') return html`<${CyclePage}/>`;
  if (route === '/meds') return html`<${MedsPage}/>`;
  if (route === '/settings') return html`<${SettingsPage}/>`;
  const c = route?.match(/^\/char\/(.+)$/);
  if (c) return html`<${CharPage} charId=${c[1]}/>`;
  return html`<${Today}/>`;
}
