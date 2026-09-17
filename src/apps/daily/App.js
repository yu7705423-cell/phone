import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, IconButton, Field, NumberInput } from '../../ui/index.js';
import { CellPage } from './CellPage.js';
import { BatchPage } from './BatchPage.js';

const { db, nav, events } = phone;

// 日常。
//
// 眼下只有随机事件库这一块。「今天她遇上了什么」分成两半：
// 日程是她自己安排的，由模型按人设生成；随机事件是撞上的，
// 由本地骰子从这个库里抽 —— 不花钱，也不问模型。
//
// 分开的理由就是一句话：撞上什么是运气，运气该由随机数决定。
// 让模型「随便想一件事」，它会一直想出同一类事，那不是随机，那是它的偏好。

function Grid() {
  const n = events.counts();
  const total = events.all().length;

  return html`
    <div class="pad-x">
      <div class="ev-grid">
        <div class="ev-head"></div>
        ${events.TONES.map(t => html`<div key=${t.id} class="ev-head">${t.label}</div>`)}
        ${events.DOMAINS.map(d => html`
          <div key=${d.id} class="ev-head is-row">${d.label}</div>
          ${events.TONES.map(t => {
            const c = n[events.cellKey(d.id, t.id)] || 0;
            return html`
              <button key=${t.id} class=${`ev-cell press${c ? '' : ' is-empty'}`}
                onClick=${() => nav.push(`/cell/${d.id}/${t.id}`)}>
                <b>${c}</b>
              </button>`;
          })}`)}
      </div>
      <div class="hint-box">
        共 ${total} 条。横向是色彩，纵向是领域。点任意一格查看与编辑该格的词条。
      </div>
    </div>`;
}

function Home() {
  useStore(db.events.store);
  const s = useStore(db.settings.store);

  return html`
    <${Page} title="日常"
      right=${html`<${IconButton} name="sparkle" label="批量生成"
        onClick=${() => nav.push('/gen')}/>`}>

      <${Grid}/>

      <${List} title="抽取">
        <${ListItem} title="批量生成" arrow multiline
          left=${html`<${Icon} name="sparkle" size=${19}/>`}
          subtitle="按领域与色彩分格生成词条。每格一次单独的接口调用，与聊天互不相干。"
          onClick=${() => nav.push('/gen')}/>
      <//>

      <div class="pad-x pad-b">
        <${Field} label="每天撞上一件事的概率"
          desc=${`按百分比填写。距上次越久，实际概率越高；角色走背字时也会高一些。`
            + `填 0 表示不再发生随机事件，日程照常。`}>
          <${NumberInput} unit="%" placeholder="不发生"
            value=${Math.round((s.eventChance || 0) * 100)}
            onChange=${v => db.settings.set({ eventChance: Math.min(100, v) / 100 })}/>
        <//>

        <${Field} label="刚抽过的压一压"
          desc=${`最近抽中过的这么多条，被再次抽中的机会按远近打折，越靠后折扣越小，`
            + `超出范围即完全恢复。压的是重复，不是封杀：同一条仍然可能再来。`
            + `填 0 表示不压，允许连着抽到同一条。`}>
          <${NumberInput} unit="条" placeholder="不压"
            value=${s.eventCooldown} onChange=${v => db.settings.set({ eventCooldown: v })}/>
        <//>
      </div>

      <div class="settings-foot">
        事件库是全局的，不属于任何角色。某个角色要不要遇上随机事件，
        在该角色的会话菜单中设置。
      </div>
    <//>`;
}

export default function DailyApp({ route }) {
  if (route === '/gen') return html`<${BatchPage}/>`;
  const c = route?.match(/^\/cell\/([^/]+)\/([^/]+)$/);
  if (c) return html`<${CellPage} domain=${c[1]} tone=${c[2]}/>`;
  return html`<${Home}/>`;
}
