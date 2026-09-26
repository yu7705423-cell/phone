import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, NumberInput, Segmented,
         Switch, Icon, EmptyState, toast } from '../../../ui/index.js';

const { db, nav, pace, autoReply } = phone;

const MODES = [
  { value: pace.MANUAL, label: '按按钮' },
  { value: pace.NOW, label: '发完就回' },
  { value: pace.PACED, label: '延迟回复' },
];

// 三档一次列全，不是只讲当前那一档：选之前就该看得见各自什么行为。
const MODE_DESC = `按按钮：发出去只是发出去，什么时候回由你按发送键右边那个按钮决定。
发完就回：消息一发出去就立刻生成回复。
延迟回复：角色什么时候回取决于角色当时的状态。空闲时几分钟内回；「角色的一天」里当前时段安排了事项，
等这件事结束后回；免打扰时段内视为休息，起床后回。期间发出的多条消息一并回复，不消耗额外的接口调用，
时刻由本地计算，不由模型决定。到点时应用需在前台，或在「设置 - 后台」开启保活或后台运行；否则在下次打开时补回。`;

const toLocalInput = ms => {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function AutoSide({ chatId, chat, side, title, desc }) {
  const c = autoReply.configOf(chat, side);
  const set = patch => autoReply.setConfig(chatId, side, patch);
  const left = autoReply.leftOf(chat, side);

  return html`
    <${List} title=${title}/>
    <div class="pad-x pad-b">
      <${List}>
        <${ListItem} title="开启" multiline
          subtitle=${c.on && c.text
            ? `已开启，${left === Infinity ? '不限条数' : `还可回 ${left} 条`}`
            : desc}
          right=${html`<${Switch} checked=${!!c.on}
            onChange=${v => {
              if (v && !c.text.trim()) { toast('请先填写自动回复的内容', 'error'); return; }
              set({ on: v });
            }}/>`}/>
      <//>

      <${Field} label="回什么" desc="固定的一句话，不经过模型，因此不消耗接口调用。">
        <${Textarea} rows=${2} value=${c.text} placeholder="例如：在忙，晚点回你"
          onInput=${v => set({ text: v })}/>
      <//>

      <${Field} label="最多回几条"
        desc=${`一个开启窗口内最多自动回这么多条，达到后自动关闭并在对话中留下提示。`
          + `填 0 表示不限条数。双方同时开启自动回复时会持续往返，请谨慎设置。`}>
        <${NumberInput} unit="条" value=${c.max} placeholder="不限"
          onChange=${v => set({ max: v })}/>
      <//>

      <${Field} label="到什么时候结束"
        desc="到点后自动关闭并在对话中留下提示。留空表示不设结束时间。">
        <input class="dt-input" type="datetime-local"
          value=${c.until ? toLocalInput(c.until) : ''}
          onInput=${e => {
            const ms = new Date(e.target.value).getTime();
            set({ until: Number.isNaN(ms) ? 0 : ms });
          }}/>
        ${c.until ? html`
          <div class="chip-row">
            <button class="chip" onClick=${() => set({ until: 0 })}>清除</button>
          </div>` : null}
      <//>
    </div>`;
}

export function PacePage({ chatId }) {
  useStore(db.chats.store);
  useStore(db.characters.store);
  const [, setTick] = useState(0);

  const chat = db.chats.get(chatId);
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;
  const pending = chat ? pace.pendingOf(chat) : null;

  // 正在等的时候，那一行倒计时每秒刷一下
  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending?.dueAt]);

  if (!chat || !char) {
    return html`
      <${Page} title="节奏与自动回复" onBack=${nav.pop}>
        <${EmptyState} icon="clock" title="这段对话已不存在"/>
      <//>`;
  }

  const mode = pace.modeOf(chat);

  return html`
    <${Page} title="节奏与自动回复" onBack=${nav.pop}>
      <${List} title="她什么时候回"/>
      <div class="pad-x pad-b">
        <${Field} label="回复节奏" desc=${MODE_DESC}>
          <${Segmented} value=${mode} items=${MODES}
            onChange=${v => pace.setMode(chatId, v)}/>
        <//>

        ${mode === pace.PACED ? html`
          <${Field} label="空闲时的基准时长"
            desc="角色空闲时在此基础上按消息本身与运势缩放，并带随机抖动。">
            <${NumberInput} unit="秒" min=${1} value=${pace.baseOf(chat)}
              onChange=${v => pace.setPace(chatId, { base: v })}/>
          <//>
          <${Field} label="最长等多久"
            desc="无论忙碌还是休息，都不超过这个时长。填 0 表示等到状态结束为止。">
            <${NumberInput} unit="秒" value=${pace.maxOf(chat)} placeholder="等到状态结束"
              onChange=${v => pace.setPace(chatId, { max: v })}/>
          <//>
          <${List}>
            <${ListItem} title="休息时不回复" multiline
              subtitle=${`免打扰时段（${char.proactiveQuietFrom ?? 0}:00 到 ${char.proactiveQuietTo ?? 8}:00，在「主动发起对话」中设置）内视为休息，起床后回复。关闭后按空闲计算`}
              right=${html`<${Switch} checked=${pace.sleepOf(chat)} onChange=${v => pace.setSleep(chatId, v)}/>`}/>
          <//>
          <div class="settings-foot">当前状态：${(() => { const st = pace.stateOf(chat); return st.kind === 'busy' ? `正在${st.what}` : st.kind === 'asleep' ? '休息中' : '空闲'; })()}</div>` : null}
      </div>

      ${pending ? html`
        <${List}>
          <${ListItem} title="正在等待回复" subtitle=${pace.pendingText(chat)} multiline
            left=${html`<${Icon} name="clock" size=${18}/>`}
            right=${html`
              <button class="nav-text press" onClick=${() => pace.clear(chatId)}>取消等待</button>`}/>
        <//>` : null}

      <${AutoSide} chatId=${chatId} chat=${chat} side="hers"
        title=${`${char.name || '角色'}的自动回复`}
        desc="关着。开启后你发消息时，角色回一句固定的话，不经过模型"/>

      <${AutoSide} chatId=${chatId} chat=${chat} side="mine"
        title="我的自动回复"
        desc="关着。开启后角色发来消息时，替你回一句固定的话"/>

      <div class="settings-foot">
        双方的自动回复不会互相触发，因此不会来回刷屏。条数与结束时间任一达到即自动关闭，
        并在对话中留下一行提示，以免长时间开启而不自知。
        角色是否在深夜主动发起对话，在「主动发起对话」中设置。
      </div>
    <//>`;
}
