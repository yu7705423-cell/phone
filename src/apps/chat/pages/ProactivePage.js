import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Switch, Segmented,
         Icon, toast, NumberInput } from '../../../ui/index.js';

const { db, nav, ai } = phone;
const alt = ai.charAlt;
const snap = ai.snap;

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
  const scfg = snap.configOf(char);
  const imgReady = ai.image.isImageReady();
  const lastSnapAt = snap.lastAt(charId);
  const lastSnap = lastSnapAt ? new Date(lastSnapAt).toLocaleDateString('zh-CN') : '';
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

      <${List} title="相册">
        <${ListItem} title="角色自己往相册里存照片" multiline
          subtitle=${scfg.snap
            ? (imgReady
              ? `每隔${scfg.snapDays > 0 ? `至少 ${scfg.snapDays} 天` : '不限间隔'}，角色会自行挑一个时刻存一张照片到相册。`
                + '不经过会话，也不会告知，需要自行翻阅相册。'
                + (lastSnap ? `上次：${lastSnap}` : '尚未存过')
              : '尚未配置生图接口，存不出照片。请先在「设置 - 生图」中配置')
            : '开启后，角色会自行选择时机生成并存入一张照片，不经过会话。'
              + '每次会消耗一次文字接口与一次生图接口调用。关闭则相册中只有你自己存入的内容'}
          right=${html`<${Switch} checked=${scfg.snap}
            onChange=${v => db.characters.update(charId, { snap: v })}/>`}/>
      <//>
      ${scfg.snap ? html`
        <div class="pad-x">
          <${Field} label="至少间隔"
            desc="距上次存照片至少间隔的天数。每次会消耗一次文字接口与一次生图接口调用。填 0 表示不限间隔。">
            <${Input} type="number" value=${scfg.snapDays}
              onInput=${v => db.characters.update(charId,
                { snapDays: Math.max(0, parseInt(v, 10) || 0) })}/>
          <//>
        </div>` : null}

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

        <${List} title="深夜消息">
          <${ListItem} title="夜里睡不着的那一条" multiline
            subtitle=${cfg.emo
              ? `${cfg.emoFrom}:00 到 ${cfg.emoTo}:00 之间发送，${cfg.emoDays > 0
                ? `距上次至少间隔 ${cfg.emoDays} 天` : '不限间隔，每晚都可能发送'}。不受上方免打扰时段限制`
              : '开启后，角色会在设定的深夜时段发送一条情绪化的消息，与上方的常规主动消息分开计算。关闭则只发送常规主动消息'}
            right=${html`<${Switch} checked=${cfg.emo}
              onChange=${v => db.characters.update(charId, { emo: v })}/>`}/>
        <//>
        ${cfg.emo ? html`
          <div class="pad-x quiet-row">
            <${Field} label="从（点）">
              <${Input} type="number" value=${cfg.emoFrom}
                onInput=${v => db.characters.update(charId,
                  { emoFrom: Math.min(23, Math.max(0, parseInt(v, 10) || 0)) })}/>
            <//>
            <${Field} label="到（点）">
              <${Input} type="number" value=${cfg.emoTo}
                onInput=${v => db.characters.update(charId,
                  { emoTo: Math.min(23, Math.max(0, parseInt(v, 10) || 0)) })}/>
            <//>
          </div>
          <div class="pad-x">
            <${Field} label="最小间隔（天）"
              desc="距上次深夜消息至少间隔的天数。每次发送会额外消耗一次接口调用。填 0 表示不限间隔，符合时段即可发送。">
              <${Input} type="number" value=${cfg.emoDays}
                onInput=${v => db.characters.update(charId,
                  { emoDays: Math.max(0, parseInt(v, 10) || 0) })}/>
            <//>
          </div>` : null}

        ${char.parentId ? null : html`
          <${List} title="角色小号">
            <${ListItem} title="允许角色自行创建小号" multiline
              subtitle=${acfg.charAlt
                ? (blocked || `角色主动发起对话时，有 ${Math.round(acfg.charAltChance * 100)}% 的可能改为开设一个新账号来添加你。已开设的小号数量不设上限`)
                : '她会换个名字来加你，你不知道那是她。开号的理由和人设都是她自己想的'}
              right=${html`<${Switch} checked=${acfg.charAlt}
                onChange=${v => db.characters.update(charId, { charAlt: v })}/>`}/>
            ${alts.length ? html`
              <${ListItem} title=${`已经开了 ${alts.length} 个`} multiline
                subtitle=${alts.map(a => a.name).join('、')}
                left=${html`<${Icon} name="users" size=${18}/>`}/>` : null}
            <${ListItem} title="本体与小号互通" multiline
              subtitle="开启后，本体与各小号共用记忆，并在对话中知道对方那边最近说了什么。关闭后各账号的记忆与对话互不相通。不增加接口调用。"
              right=${html`<${Switch} checked=${char.altShare !== false}
                onChange=${v => db.characters.update(charId, { altShare: v })}/>`}/>
          <//>
          ${char.altShare !== false ? html`
            <div class="pad-x">
              <${Field} label="带上对方那边最近几条" desc="每个账号各带这么多条最近的消息进入上下文。填 0 只共用记忆，不带对话。">
                <${NumberInput} value=${typeof char.altShareLines === 'number' ? char.altShareLines : 8} unit="条"
                  onChange=${v => db.characters.update(charId, { altShareLines: Math.max(0, v) })}/>
              <//>
            </div>` : null}
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
