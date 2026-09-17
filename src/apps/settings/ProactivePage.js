import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Switch, Segmented,
         Icon, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;

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
  // 落点撞进免打扰里就会被推到时段结束，这里先说清楚，免得看着像没发
  return ai.proactive.inQuiet(cfg, d) ? `${when}，但在免打扰里，会推到 ${cfg.quietTo}:00 之后` : when;
};

export function ProactivePage() {
  const s = useStore(db.settings.store);
  useStore(db.characters.store);
  const [busy, setBusy] = useState(false);
  const cfg = ai.proactive.config();

  const set = patch => {
    db.settings.set({ proactive: { ...cfg, ...patch } });
    ai.proactive.reschedule();
  };

  const chars = db.characters.all();
  const on = chars.filter(c => c.proactive !== false).length;

  // 立刻来一条，用来确认接口和人设都通了，不用干等
  const tryNow = async () => {
    const chat = db.chats.all().find(c => (c.characterIds || []).length === 1);
    if (!chat) { toast('还没有会话，先去联系人里开一个'); return; }
    setBusy(true);
    try {
      await ai.proactive.sendProactive(chat.id, chat.characterIds[0]);
      toast('发来了，去消息里看看', 'ok');
    } catch (e) {
      toast('没发出来：' + (e.message || e), 'error', 5000);
    } finally { setBusy(false); }
  };

  return html`
    <${Page} title="主动消息" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="让角色自己发消息" multiline
          subtitle="不用你先开口。页面关着的时候不会发，重新打开时会补上一条"
          right=${html`<${Switch} checked=${cfg.enabled}
            onChange=${v => set({ enabled: v })}/>`}/>
      <//>

      ${cfg.enabled ? html`
        <${List} title="频率">
          <${ListItem} title="大概多久一条" subtitle=${`现在是 ${fmtGap(cfg.minutes)}左右`} multiline/>
        <//>
        <div class="pad">
          <${Segmented} value=${PACE.some(p => p.value === cfg.minutes) ? cfg.minutes : 0}
            items=${[...PACE, { value: 0, label: '自定义' }]}
            onChange=${v => v && set({ minutes: v })}/>
        </div>
        <div class="pad-x">
          <${Field} label="平均间隔（分钟）"
            desc="不会掐着点发。每次落在这个数的一半到一倍半之间随机，所以是忽早忽晚的">
            <${Input} type="number" value=${cfg.minutes}
              onInput=${v => set({ minutes: Math.max(1, parseInt(v, 10) || 1) })}/>
          <//>
        </div>

        <${List} title="免打扰">
          <${ListItem} title="这段时间不发" multiline
            subtitle=${cfg.quietFrom === cfg.quietTo
              ? '两个数填成一样就是全天都能发'
              : `${cfg.quietFrom}:00 到 ${cfg.quietTo}:00 之间攒着，到点再发`}/>
        <//>
        <div class="pad-x quiet-row">
          <${Field} label="从（点）">
            <${Input} type="number" value=${cfg.quietFrom}
              onInput=${v => set({ quietFrom: Math.min(23, Math.max(0, parseInt(v, 10) || 0)) })}/>
          <//>
          <${Field} label="到（点）">
            <${Input} type="number" value=${cfg.quietTo}
              onInput=${v => set({ quietTo: Math.min(23, Math.max(0, parseInt(v, 10) || 0)) })}/>
          <//>
        </div>

        <${List} title="谁会发">
          <${ListItem} title="按角色开关" multiline
            subtitle=${`${on} / ${chars.length} 个角色开着。要单独关掉某个人，去他的角色卡里`}
            left=${html`<${Icon} name="users" size=${18}/>`}/>
          <${ListItem} title="下一条" subtitle=${fmtWhen(ai.proactive.nextAt(), cfg)}
            left=${html`<${Icon} name="clock" size=${18}/>`}/>
        <//>

        <div class="pad">
          <${Button} full variant="ghost" disabled=${busy || !ai.isConfigured()}
            onClick=${tryNow}>${busy ? '正在写' : '现在就来一条'}<//>
        </div>
        ${!ai.isConfigured() ? html`
          <div class="settings-foot">还没配聊天接口，主动消息发不出来</div>` : null}
      ` : null}

      <div class="settings-foot">
        堆了 ${cfg.maxUnread} 条没看就会先停下来，不会一直往里灌
      </div>
    <//>`;
}
