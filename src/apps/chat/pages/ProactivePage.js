import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Switch, Segmented,
         Icon, toast } from '../../../ui/index.js';

const { db, nav, ai } = phone;
const alt = ai.charAlt;

const PACE = [
  { value: 15,   label: '很勤' },
  { value: 60,   label: '适中' },
  { value: 240,  label: '偶尔' },
  { value: 1440, label: '很少' },
];

const fmtGap = m =>
  m < 60 ? `${m} 分钟` : m % 60 === 0 ? `${m / 60} 小时` : `${(m / 60).toFixed(1)} 小时`;

const fmtWhen = (t, cfg) => {
  if (!t) return '还没排上';
  const d = new Date(t);
  const soon = t - Date.now();
  if (soon <= 0) return '马上';
  const mins = Math.round(soon / 60000);
  const at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const when = mins < 60 ? `约 ${mins} 分钟后（${at}）` : `${at} 前后`;
  // 落点撞进免打扰里会被推到时段结束，先说清楚，免得看着像没发
  return ai.proactive.inQuiet(cfg, d)
    ? `${when}，但在免打扰里，会推到 ${cfg.proactiveQuietTo}:00 之后` : when;
};

// 这个角色多久主动找你一次。按角色单独配，见 CLAUDE.md 第 5 条
export function ProactivePage({ charId }) {
  useStore(db.characters.store);
  useStore(db.chats.store);
  const [busy, setBusy] = useState(false);

  const char = db.characters.get(charId);
  const cfg = ai.proactive.configOf(char);
  const acfg = alt.configOf(char);
  const alts = alt.altsOf(charId);
  const blocked = alt.blockedBy(charId);

  const set = patch => {
    db.characters.update(charId, patch);
    ai.proactive.reschedule(charId);
  };

  const chat = db.chats.all().find(c =>
    (c.characterIds || []).length === 1 && c.characterIds[0] === charId);

  const tryNow = async () => {
    if (!chat) { toast('尚未与该角色建立会话'); return; }
    setBusy(true);
    try {
      await ai.proactive.sendProactive(chat.id, charId);
      toast('已发送，返回会话查看', 'ok');
    } catch (e) {
      toast('发送失败：' + (e.message || e), 'error', 5000);
    } finally { setBusy(false); }
  };

  if (!char) {
    return html`<${Page} title="主动发起对话" onBack=${nav.pop}><div class="pad">该角色已不存在<//><//>`;
  }

  return html`
    <${Page} title="主动发起对话" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title=${`让${char.name}自己开口`} multiline
          subtitle="无需你先开口，角色会按设定的间隔主动发起对话。页面关闭期间不发送，重新打开时补发"
          right=${html`<${Switch} checked=${cfg.proactive}
            onChange=${v => set({ proactive: v })}/>`}/>
      <//>

      ${cfg.proactive ? html`
        <${List} title="发送频率">
          <${ListItem} title="平均间隔" subtitle=${`当前约 ${fmtGap(cfg.proactiveMinutes)}`} multiline/>
        <//>
        <div class="pad">
          <${Segmented} value=${PACE.some(p => p.value === cfg.proactiveMinutes) ? cfg.proactiveMinutes : 0}
            items=${[...PACE, { value: 0, label: '自定义' }]}
            onChange=${v => v && set({ proactiveMinutes: v })}/>
        </div>
        <div class="pad-x">
          <${Field} label="平均间隔（分钟）"
            desc="实际间隔在该值的 0.5 至 1.5 倍之间随机取值，不会固定在整点发送。">
            <${Input} type="number" value=${cfg.proactiveMinutes}
              onInput=${v => set({ proactiveMinutes: Math.max(1, parseInt(v, 10) || 1) })}/>
          <//>
        </div>

        <${List} title="免打扰">
          <${ListItem} title="免打扰时段" multiline
            subtitle=${cfg.proactiveQuietFrom === cfg.proactiveQuietTo
              ? '两个数填成一样就是全天都能发'
              : `${cfg.proactiveQuietFrom}:00 到 ${cfg.proactiveQuietTo}:00 之间攒着，到点再发`}/>
        <//>
        <div class="pad-x quiet-row">
          <${Field} label="从（点）">
            <${Input} type="number" value=${cfg.proactiveQuietFrom}
              onInput=${v => set({ proactiveQuietFrom: Math.min(23, Math.max(0, parseInt(v, 10) || 0)) })}/>
          <//>
          <${Field} label="到（点）">
            <${Input} type="number" value=${cfg.proactiveQuietTo}
              onInput=${v => set({ proactiveQuietTo: Math.min(23, Math.max(0, parseInt(v, 10) || 0)) })}/>
          <//>
        </div>

        <${List}>
          <${ListItem} title="下一条预计时间" subtitle=${fmtWhen(ai.proactive.nextAt(charId), cfg)}
            left=${html`<${Icon} name="clock" size=${18}/>`}/>
        <//>

        ${char.parentId ? null : html`
          <${List} title="角色小号">
            <${ListItem} title="允许角色自行创建小号" multiline
              subtitle=${acfg.charAlt
                ? (blocked || `轮到她主动时，有 ${Math.round(acfg.charAltChance * 100)}% 的可能她开的不是口，而是一个新号来加你`)
                : '她会换个名字来加你，你不知道那是她。开号的理由和人设都是她自己想的'}
              right=${html`<${Switch} checked=${acfg.charAlt}
                onChange=${v => db.characters.update(charId, { charAlt: v })}/>`}/>
            ${alts.length ? html`
              <${ListItem} title=${`已经开了 ${alts.length} 个`} multiline
                subtitle=${alts.map(a => a.name).join('、')}
                left=${html`<${Icon} name="users" size=${18}/>`}/>` : null}
          <//>
          ${acfg.charAlt ? html`
            <div class="pad-x">
              <${Field} label=${`开号的可能性 ${Math.round(acfg.charAltChance * 100)}%`}
                desc="每次角色主动发起对话时判定一次。数值越高出现小号的概率越大。">
                <input type="range" min="0.02" max="0.5" step="0.02" value=${acfg.charAltChance}
                  onInput=${e => db.characters.update(charId, { charAltChance: parseFloat(e.target.value) })}/>
              <//>
            </div>` : null}`}

        <div class="pad">
          <${Button} full variant="ghost" disabled=${busy || !ai.isConfigured()}
            onClick=${tryNow}>${busy ? '正在写' : '现在就来一条'}<//>
        </div>
        ${!ai.isConfigured() ? html`
          <div class="settings-foot">还没配聊天接口，发不出来</div>` : null}
      ` : null}

      <div class="settings-foot">
        堆了 3 条没看就会先停下来，不会一直往里灌
      </div>
    <//>`;
}
