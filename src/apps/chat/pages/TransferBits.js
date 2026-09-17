import { html, useState } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Sheet, Field, Input, Button, Icon, List, ListItem, toast } from '../../../ui/index.js';

const { db, transfer, currency, place, call } = phone;

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
          <div class="tr-amount">${transfer.display(msg.amount, msg.currency)}</div>
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
  const [picking, setPicking] = useState(false);
  const cur = currency.current();

  const close = () => { setAmount(''); setNote(''); setPicking(false); onClose(); };
  const submit = () => {
    try {
      transfer.send({ chatId, role: 'user', authorId: 'me', amount, note });
      close();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const ok = transfer.money(amount) > 0;
  return html`
    <${Sheet} open=${open} onClose=${close} title="转账">
      <${Field} label="金额"
        desc=${cur.digits ? `最多 ${cur.digits} 位小数。` : `${cur.name}不使用小数。`}>
        <${Input} value=${amount} type="number" inputmode="decimal"
          placeholder=${(0).toFixed(cur.digits)} onInput=${setAmount}/>
      <//>

      <${List} inset=${false}>
        <${ListItem} title="币种" subtitle=${`${cur.name}${cur.symbol ? ` · ${cur.symbol}` : ''}`}
          arrow onClick=${() => setPicking(true)}/>
      <//>
      <${Field} label="留言" desc="可以不写。">
        <${Input} value=${note} placeholder="留言" maxlength=${40} onInput=${setNote}/>
      <//>
      <div class="pad-t">
        <${Button} full disabled=${!ok} onClick=${submit}>转账${ok ? ` ${transfer.format(amount)}` : ''}<//>
      </div>
      <div class="settings-foot">
        转账后由对方决定收下或退回。在此之前可以长按该消息将其删除。<br/>
        币种仅影响此后发出的转账，已发出的保持原样。不进行汇率换算。
      </div>

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="币种" height="68%">
        <${List} inset=${false}>
          ${currency.LIST.map(c => html`
            <${ListItem} key=${c.code} title=${c.name}
              subtitle=${c.symbol ? `${c.symbol} · ${c.code}` : '金额不带符号'}
              right=${c.code === cur.code ? html`<${Icon} name="check" size=${16}/>` : null}
              onClick=${() => { currency.set(c.code); setPicking(false); }}/>`)}
        <//>
      <//>
    <//>`;
}

// 位置气泡。虚拟定位，不读设备 GPS，也不查地图接口，就是一个地点名加一行地址。
export function LocationBubble({ msg }) {
  return html`
    <div class="bubble bubble-location">
      <div class="loc-body">
        <div class="loc-name ellipsis">${msg.place}</div>
        ${msg.address ? html`<div class="loc-addr ellipsis">${msg.address}</div>` : null}
      </div>
      <div class="loc-map"><${Icon} name="map" size=${22}/></div>
    </div>`;
}

// 通话记录。整通电话只留这一条，点开看全文。
export function CallBubble({ msg, onOpen }) {
  const done = msg.outcome === 'done';
  return html`
    <div class=${`bubble bubble-call${done ? '' : ' is-miss'}`}
      onClick=${done && onOpen ? () => onOpen(msg) : null}>
      <${Icon} name="phone" size=${18}/>
      <span>${call.label(msg.direction, msg.outcome, msg.seconds)}</span>
    </div>`;
}

// 通话全文
export function CallLogSheet({ msg, onClose }) {
  if (!msg) return null;
  const chat = db.chats.get(msg.chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  const me = phone.accounts.current()?.name || '我';
  const lines = msg.callLog || [];
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose}
      title=${call.label(msg.direction, msg.outcome, msg.seconds)} height="72%">
      ${lines.length ? html`
        <div class="pad-x">
          ${lines.map((l, i) => html`
            <div key=${i} class="log-line">
              <span class="log-who">${l.role === 'user' ? me : (char?.name || '对方')}</span>
              <span class="log-text">${l.text}</span>
            </div>`)}
        </div>`
      : html`<div class="settings-foot">这通电话没有留下内容。</div>`}
    <//>`;
}

// 发送位置
export function LocationSheet({ open, chatId, onClose }) {
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');

  const close = () => { setName(''); setAddr(''); onClose(); };
  const submit = () => {
    try { place.send({ chatId, role: 'user', authorId: 'me', place: name, address: addr }); close(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${close} title="位置">
      <${Field} label="地点名称" desc="招牌上的名字，例如「城市图书馆」。">
        <${Input} value=${name} placeholder="地点名称" maxlength=${40} onInput=${setName}/>
      <//>
      <${Field} label="详细地址" desc="可以不写。">
        <${Input} value=${addr} placeholder="街道与门牌" maxlength=${80} onInput=${setAddr}/>
      <//>
      <div class="pad-t">
        <${Button} full disabled=${!name.trim()} onClick=${submit}>发送位置<//>
      </div>
      <div class="settings-foot">
        发送的是自行填写的地点，不会读取本机定位，也不会连接任何地图服务。
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
