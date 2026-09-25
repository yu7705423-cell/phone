import { html } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { List, ListItem, Icon, Sheet } from '../../../ui/index.js';

const { db, trip, intent } = phone;

// 会话里那条出行提议。
//
// 和外卖那一条同构（见 4.675 那一套）：气泡带着状态，收到的一方点一下表态，
// 表完态落一行提示。区别只有一个 —— **答应了会多出一行出行**，
// 因为一次出行是要活很久的东西，不是一条消息就完了。
//
// 已经答应过的那条**点得进去**：直接跳到那次出行的详情页。这一跳带回头路，
// 退回来还在这段会话里。

export function TripBubble({ msg, onSettle }) {
  const pending = msg.trip === trip.PENDING;
  // 自己提的那一次不能自己答应 —— 去不去是对方的事
  const actionable = pending && msg.role !== 'user' && onSettle;
  const row = msg.tripId ? trip.get(msg.tripId) : null;
  const foot = pending ? (actionable ? '点击回应' : '等待回应')
    : msg.trip === trip.JOINED ? (row ? '已同意 · 点击查看' : '已同意')
    : '未同意';
  const open = () => {
    if (actionable) { onSettle(msg); return; }
    if (row) intent.open('travel', { route: `/trip/${row.id}`, back: true });
  };
  return html`
    <div class=${`bubble bubble-trip${pending ? '' : ' is-done'}`}
      onClick=${actionable || row ? open : null}>
      <div class="tr-top">
        <${Icon} name="compass" size=${20}/>
        <div class="tr-body">
          <div class="meal-item ellipsis">${msg.where}</div>
          ${msg.when ? html`<div class="meal-price">${msg.when}</div>` : null}
        </div>
      </div>
      <div class="tr-foot">${foot}</div>
    </div>`;
}

// 对方提的那一次，同行还是不去
export function TripSettleSheet({ msg, onClose }) {
  if (!msg) return null;
  const char = db.characters.get(msg.authorId);
  const act = join => { trip.settle(msg.id, join); onClose(); };
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose}
      title=${`${phone.remark.nameOf(char) || '对方'}提议一起去${msg.where}`}>
      ${msg.when ? html`<div class="settings-foot">提出的时间：${msg.when}</div>` : null}
      <${List} inset=${false}>
        <${ListItem} title="同行" arrow
          left=${html`<${Icon} name="check" size=${18}/>`} onClick=${() => act(true)}/>
        <${ListItem} title="不同行" arrow
          left=${html`<${Icon} name="close" size=${18}/>`} onClick=${() => act(false)}/>
      <//>
      <div class="settings-foot">
        同意后会在「出行」中建立一次出行，日期与预算在该处填写。回应结果会告知对方。
      </div>
    <//>`;
}
