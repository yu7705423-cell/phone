import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Icon, Button, Spinner, Switch,
         EmptyState, toast, confirm } from '../../../ui/index.js';
import { PoopField } from '../parts.js';

const { db, nav, health, ai } = phone;

// 角色的身体状态。和「角色的一天」一样是**设定出来的**，不是测出来的 ——
// 你替它定今天累不累、哪儿不舒服，它在对话里就按这个来。
export function CharPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.health.store);
  const [busy, setBusy] = useState(false);
  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="身体状态" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const date = health.dateKey();
  const d = health.dayOf(charId, date);
  const set = patch => health.set(charId, date, patch);

  // 这一天已经有内容了没有。有的话生成之前要问一句 —— 手填的那份
  // 是用户自己一格一格点出来的，不能默默盖掉
  const filled = !!(d.energy || d.mood || (d.symptoms || []).length
    || d.sleepMin || (d.poops || []).length || d.note);

  const gen = async () => {
    if (busy) return;
    if (filled && !await confirm({
      title: '重新生成今天', okText: '生成', danger: true,
      message: '当前已填写的内容将被覆盖，包括手动填写的部分。',
    })) return;
    setBusy(true);
    try {
      await ai.healthTask.generateDay(charId, date);
      toast('已生成', 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };

  return html`
    <${Page} title=${`${char.name} 今天`} onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          这一份是角色的设定，不是测量值。开启注入后，它会作为事实写进
          这个角色的对话上下文。可以逐项填写，也可以按人设一键生成。
        </div>
        <div class="pad-b">
          <${Button} full variant=${filled ? 'ghost' : 'primary'}
            disabled=${busy || !ai.isConfigured()}
            icon=${busy ? null : 'refresh'} onClick=${gen}>
            ${busy ? html`<${Spinner} size=${16}/>` : (filled ? '重新生成今天' : '按人设生成今天')}
          <//>
        </div>
        ${!ai.isConfigured() ? html`
          <div class="settings-foot">尚未配置聊天接口，无法生成。</div>` : null}
        <${List} inset=${false}>
          <${ListItem} title="每天自动生成" multiline
            subtitle=${char.healthAuto === true
              ? '已开启。每天按人设为该角色生成一次当天的身体状态，每天一次接口调用（副用）。'
                + '当天已有内容（包括手动填写的）时不生成。'
              : '已关闭。需要时手动点击上方按钮生成。开启后每天一次接口调用。'}
            right=${html`<${Switch} checked=${char.healthAuto === true}
              onChange=${v => db.characters.update(charId, { healthAuto: v, healthAutoAt: '' })}/>`}/>
        <//>
        ${char.healthAuto === true && char.healthAutoError && char.healthAutoAt === date ? html`
          <div class="settings-foot is-error">今天的自动生成失败：${char.healthAutoError}。可点击上方按钮重试。</div>` : null}
        ${d.source === 'ai' ? html`
          <div class="settings-foot">当前这一份由模型按人设生成，可以逐项修改。</div>` : null}
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
        <${PoopField} who=${charId} date=${date} list=${d.poops} mine=${false}/>
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
