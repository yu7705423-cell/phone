import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, NumberInput, Segmented,
         Switch, Icon, EmptyState, toast } from '../../../ui/index.js';

const { db, nav, pace, autoReply } = phone;

const MODES = [
  { value: pace.MANUAL, label: '按按钮' },
  { value: pace.NOW, label: '发完就回' },
  { value: pace.PACED, label: '过一会儿' },
];

// 三档一次列全，不是只讲当前那一档：选之前就该看得见各自什么行为。
const MODE_DESC = `按按钮：发出去只是发出去，什么时候回由你按发送键右边那个按钮决定。
发完就回：消息一发出去就立刻生成回复。
过一会儿：消息发出去后等一段时间再回。等多久由本地计算，不消耗额外的接口调用，
也不由模型决定 —— 时段、角色当时的安排、运势、以及这条消息本身是长是短、
有没有问号，都会影响。`;

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
          + `填 0 表示不限条数 —— 双方都开着自动回复时会一直回下去，请谨慎。`}>
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
          <${Field} label="基准时长"
            desc="实际等待时间在此基础上按时段、安排、运势与消息本身放大或缩短，并带随机抖动。">
            <${NumberInput} unit="秒" min=${1} value=${pace.baseOf(chat)}
              onChange=${v => pace.setPace(chatId, { base: v })}/>
          <//>
          <${Field} label="最长等多久"
            desc="无论怎么放大都不超过这个时长。填 0 表示不封顶。">
            <${NumberInput} unit="秒" value=${pace.maxOf(chat)} placeholder="不封顶"
              onChange=${v => pace.setPace(chatId, { max: v })}/>
          <//>` : null}
      </div>

      ${pending ? html`
        <${List}>
          <${ListItem} title="正在等待回复" subtitle=${pace.leftText(pace.leftOf(chat))} multiline
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
        并在对话中留下一行提示 —— 以免长时间开着而不自知。
        角色是否在深夜主动发起对话，在「主动发起对话」中设置。
      </div>
    <//>`;
}
