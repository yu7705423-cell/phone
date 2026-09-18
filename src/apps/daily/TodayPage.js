import { html, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Avatar, Button, Icon, IconButton, Spinner,
         Sheet, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, day, events, food, ai } = phone;

const TONE_TEXT = { good: '好事', bad: '坏事', plain: '不好不坏' };

function Row({ char, onClick }) {
  const url = useImage(char.avatar);
  const b = day.brief(char.id);
  const on = day.isOn(char);
  const sub = !on ? '未开启当日日程'
    : b ? `${b.slot.label} · ${b.done} / ${b.total} 已完成`
    : '今天还没有安排';
  return html`
    <button class="sp-row press" onClick=${onClick}>
      <${Avatar} src=${url} name=${char.name} size=${44}/>
      <div class="sp-row-body">
        <div class="sp-row-name ellipsis">${char.name || '未命名'}</div>
        <div class="sp-row-sub ellipsis">${sub}</div>
      </div>
    </button>`;
}

export function TodayList() {
  useStore(db.characters.store);
  useStore(db.days.store);
  const list = db.characters.all().filter(c => !c.isNpc && !c.parentId);

  return html`
    <${Page} title="今天" onBack=${nav.pop}>
      ${list.length ? html`
        <div class="pad-x pad-t">
          <div class="hint-box">
            日程由模型按人设生成，一天一次。撞上的事、运势与三顿吃什么都由本地随机数决定，
            不额外消耗接口调用。是否开启在每个角色的角色卡中设置。
          </div>
          <div class="capsule">
            ${list.map(c => html`
              <${Row} key=${c.id} char=${c} onClick=${() => nav.push(`/today/${c.id}`)}/>`)}
          </div>
        </div>`
      : html`<${EmptyState} icon="users" title="还没有角色"
          desc="在「联系」中创建角色后，可在这里查看每个角色的一天。"/>`}
    <//>`;
}

export function TodayPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.days.store);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(false);

  const char = db.characters.get(charId);
  const on = day.isOn(char);
  const date = char ? day.dateKey(char) : '';
  const today = char ? day.get(charId, date) : null;
  const b = char ? day.brief(charId) : null;
  const cur = char ? day.slotNow(char) : null;

  if (!char) {
    return html`
      <${Page} title="今天" onBack=${nav.pop}>
        <${EmptyState} icon="sparkle" title="角色不存在"/>
      <//>`;
  }

  const make = async force => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    if (force && !await confirm({
      title: '重新安排今天', danger: true,
      message: '今天已有的安排、撞上的事与三顿吃什么将全部重掷。',
    })) return;
    setBusy(true);
    try {
      await ai.dayTask.makeToday(charId, { force });
      toast('已安排', 'ok');
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setBusy(false); }
  };

  const cycle = it => {
    const next = it.state === day.PLAN ? day.DONE : it.state === day.DONE ? day.DROP : day.PLAN;
    day.setState(today.id, it.id, next);
  };

  const meals = today?.meals || [];
  const ev = today?.event || null;
  const evReady = !!(b && b.event);

  return html`
    <${Page} title=${char.name || '今天'} onBack=${nav.pop}
      right=${today ? html`<${IconButton} name="refresh" label="重新安排"
        onClick=${() => make(true)}/>` : null}>

      ${!on ? html`
        <${EmptyState} icon="sparkle" title="这个角色还没有开启当日日程"
          desc="在角色卡的「当日日程」中开启后，每天首次对话时会自动安排一次。"/>`
      : !today ? html`
        <${EmptyState} icon="calendar" title=${`${date} 还没有安排`}
          desc="每天首次对话时会自动安排一次，也可以现在就排。"
          action=${html`<${Button} size="sm" disabled=${busy} onClick=${() => make(false)}>
            ${busy ? html`<${Spinner} size=${14}/>` : null}${busy ? '正在安排' : '现在安排'}<//>`}/>`
      : html`
        <div class="pad-x pad-t">
          <div class="hint-box">
            ${date} · 现在是${cur.label} · 运势${events.luckLabel(today.luck)}。
            还没到的时段，角色只知道自己打算做什么。
          </div>
        </div>

        ${day.SLOTS.map(s => {
          const items = (today.items || []).filter(it => it.slot === s.id);
          const meal = meals.find(m => food.mealBySlot(s.id)?.id === m.meal);
          const evHere = ev && ev.slot === s.id;
          if (!items.length && !meal && !evHere) return null;
          const isNow = s.id === cur.id;
          return html`
            <${List} key=${s.id} title=${isNow ? `${s.label}（现在）` : s.label}>
              ${meal ? html`
                <${ListItem} title=${meal.name} multiline
                  subtitle=${[food.mealOf(meal.meal)?.label, meal.place].filter(Boolean).join(' · ')}
                  left=${html`<${Icon} name="cup" size=${18}/>`}/>` : null}
              ${items.map(it => html`
                <${ListItem} key=${it.id} title=${it.text} subtitle=${day.stateLabel(it.state)}
                  class=${it.state === day.DROP ? 'is-dropped' : ''}
                  left=${html`<${Icon} name=${it.state === day.DONE ? 'check'
                    : it.state === day.DROP ? 'close' : 'clock'} size=${18}/>`}
                  onClick=${() => cycle(it)}/>`)}
              ${evHere ? html`
                <${ListItem} title=${ev.text} multiline
                  subtitle=${`撞上的事 · ${TONE_TEXT[ev.tone] || ''}`
                    + (evReady ? '' : ' · 时段未到，角色还不知道')}
                  left=${html`<${Icon} name="sparkle" size=${18}/>`}/>` : null}
            <//>`;
        })}

        ${!ev ? html`
          <div class="settings-foot">今天没有撞上什么事。大部分日子本来就是这样。</div>` : null}

        <div class="pad">
          <${Button} full variant="ghost" onClick=${() => setLog(true)}>看看最近几天<//>
        </div>
        <div class="settings-foot">
          点击任意一条切换状态：计划中 · 已完成 · 已取消。角色在对话中也可以自己标记。
        </div>`}

      <${Sheet} open=${log} onClose=${() => setLog(false)} title="最近几天">
        <${List} inset=${false}>
          ${day.recent(charId, 7).map(d => html`
            <${ListItem} key=${d.id} title=${d.date} multiline
              subtitle=${[
                `${(d.items || []).filter(x => x.state === day.DONE).length} / ${(d.items || []).length} 完成`,
                d.event ? `撞上：${d.event.text}` : '',
                (d.meals || []).map(m => m.name).join('、'),
              ].filter(Boolean).join('　')}/>`)}
        <//>
        ${day.recent(charId, 1).length ? null
          : html`<div class="settings-foot">还没有记录。</div>`}
      <//>
    <//>`;
}
