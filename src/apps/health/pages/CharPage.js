import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Icon,
         EmptyState } from '../../../ui/index.js';

const { db, nav, health } = phone;

// 角色的身体状态。和「角色的一天」一样是**设定出来的**，不是测出来的 ——
// 你替它定今天累不累、哪儿不舒服，它在对话里就按这个来。
export function CharPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.health.store);
  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="身体状态" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const date = health.dateKey();
  const d = health.dayOf(charId, date);
  const set = patch => health.set(charId, date, patch);

  return html`
    <${Page} title=${`${char.name} 今天`} onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          这一份是你替角色定的设定，不是测量值。开启注入后，它会作为事实写进
          这个角色的对话上下文。
        </div>
        <${Field} label="精力">
          <${Segmented} value=${d.energy} onChange=${v => set({ energy: v })}
            items=${health.ENERGY.map(m => ({ value: m.id, label: m.label }))}/>
        <//>
        <${Field} label="心情">
          <${Segmented} value=${d.mood} onChange=${v => set({ mood: v })}
            items=${health.MOODS.map(m => ({ value: m.id, label: m.label }))}/>
        <//>
        <${Field} label="哪里不舒服" desc="点一下记上，再点取消。都没有就空着。">
          <div class="chip-row">
            ${health.SYMPTOMS.map(sy => html`
              <button key=${sy.id}
                class=${`chip${(d.symptoms || []).includes(sy.id) ? ' is-active' : ''}`}
                onClick=${() => health.toggleSymptom(charId, date, sy.id)}>${sy.label}</button>`)}
          </div>
        <//>
        <${Field} label="睡了多久" desc="按分钟填，可留空。">
          <${Input} value=${d.sleepMin || ''} type="number" inputmode="numeric"
            placeholder="可留空"
            onInput=${v => set({ sleepMin: Math.max(0, Number(v) || 0) })}/>
        <//>
        <${Field} label="另外记一句" desc="可留空。会一并写进上下文。">
          <${Input} value=${d.note} placeholder="可留空"
            onInput=${v => set({ note: v.slice(0, 200) })}/>
        <//>
      </div>

      <${List}>
        <${ListItem} title="角色卡" arrow multiline
          subtitle="身体状态的总开关在角色卡上，关掉之后这一份不再注入"
          left=${html`<${Icon} name="user" size=${18}/>`}
          onClick=${() => phone.intent.open('chat', { route: `/edit/${charId}` })}/>
      <//>
    <//>`;
}
