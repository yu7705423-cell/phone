import { html, useState } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Sheet, Field, Input, Button, Icon, List, ListItem, toast } from '../../../ui/index.js';

const { db, transfer } = phone;

// 转账气泡。发出去的那一张不能自己点 —— 收不收是对方的事。
export function TransferBubble({ msg, onSettle }) {
  const mine = msg.role === 'user';
  const pending = msg.transfer === transfer.PENDING;
  const actionable = pending && !mine && onSettle;
  return html`
    <div class=${`bubble bubble-transfer${pending ? '' : ' is-done'}`}
      onClick=${actionable ? () => onSettle(msg) : null}>
      <div class="tr-top">
        <${Icon} name="wallet" size=${20}/>
        <div class="tr-body">
          <div class="tr-amount">${transfer.format(msg.amount)}</div>
          ${msg.note ? html`<div class="tr-note ellipsis">${msg.note}</div>` : null}
        </div>
      </div>
      <div class="tr-foot">
        ${transfer.stateLabel(msg.transfer)}${actionable ? ' · 点击处理' : ''}
      </div>
    </div>`;
}

// 提示行。不占气泡，居中一行灰字，两边都看得见刚才发生了什么。
export function NoticeLine({ msg }) {
  return html`<div class="conv-notice">${String(msg.content || '').replace(/^\[|\]$/g, '')}</div>`;
}

// 发起转账
export function TransferSheet({ open, chatId, onClose }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const close = () => { setAmount(''); setNote(''); onClose(); };
  const submit = () => {
    try {
      transfer.send({ chatId, role: 'user', authorId: 'me', amount, note });
      close();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const ok = transfer.money(amount) > 0;
  return html`
    <${Sheet} open=${open} onClose=${close} title="转账">
      <${Field} label="金额" desc="最多两位小数。">
        <${Input} value=${amount} type="number" inputmode="decimal" placeholder="0.00"
          onInput=${setAmount}/>
      <//>
      <${Field} label="留言" desc="可以不写。">
        <${Input} value=${note} placeholder="留言" maxlength=${40} onInput=${setNote}/>
      <//>
      <div class="pad-t">
        <${Button} full disabled=${!ok} onClick=${submit}>转账${ok ? ` ${transfer.format(amount)}` : ''}<//>
      </div>
      <div class="settings-foot">
        转账后由对方决定收下或退回。在此之前可以长按该消息将其删除。
      </div>
    <//>`;
}

// 收下或退回
export function SettleSheet({ msg, onClose }) {
  if (!msg) return null;
  const char = db.characters.get(msg.authorId);
  const act = take => {
    transfer.settle(msg.id, take);
    onClose();
  };
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose}
      title=${`${char?.name || '对方'}转来 ${transfer.format(msg.amount)}`}>
      ${msg.note ? html`<div class="settings-foot">留言：${msg.note}</div>` : null}
      <${List} inset=${false}>
        <${ListItem} title="收款" arrow
          left=${html`<${Icon} name="check" size=${18}/>`} onClick=${() => act(true)}/>
        <${ListItem} title="退回" arrow
          left=${html`<${Icon} name="reply" size=${18}/>`} onClick=${() => act(false)}/>
      <//>
      <div class="settings-foot">处理结果会告知对方。</div>
    <//>`;
}
