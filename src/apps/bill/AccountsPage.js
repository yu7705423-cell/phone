import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Segmented, Switch, Icon,
  Sheet, toast, confirm } from '../../ui/index.js';
import { Money, OwnerDot } from './parts.js';

const { db, nav, ledger } = phone;

// 账户。共同账户与角色账户在这里建，动用它们的规矩（申请、亲属卡、私密卡）
// 在后面的批次里做 —— 这一批先把「谁有多少钱」立起来。
export function AccountsPage() {
  useStore(db.books.store);
  useStore(db.entries.store);
  useStore(db.settings.store);
  const [editing, setEditing] = useState(null);
  const [card, setCard] = useState(null);
  const bookId = ledger.currentId();
  const book = ledger.get(bookId);
  if (!book) return html`<${Page} title="账户" onBack=${nav.pop}/>`;

  const who = ledger.whoOf(bookId);
  const list = ledger.accountsOf(bookId);

  const drop = async a => {
    const n = ledger.entriesOf(bookId).filter(e => e.accountId === a.id).length;
    if (!await confirm({
      title: `删除「${a.name}」`, danger: true, okText: '删除',
      message: `该账户下的 ${n} 笔流水会一并删除，且无法恢复。`,
    })) return;
    ledger.removeAccount(bookId, a.id);
    toast('已删除');
  };

  const groups = [
    ['me', who.me],
    ...(who.char ? [['char', who.char]] : []),
    ['joint', '共同'],
  ];

  return html`
    <${Page} title="账户" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => setEditing({ name: '', owner: 'me' })}>新建</button>`}>

      ${groups.map(([owner, label]) => {
        const rows = list.filter(a => a.owner === owner);
        return html`
          <${List} key=${owner} title=${label}>
            ${rows.map(a => html`
              <${ListItem} key=${a.id} title=${a.name}
                left=${html`<${OwnerDot} owner=${a.owner}/>`}
                right=${html`<${Money} bookId=${bookId} amount=${ledger.balanceOf(bookId, a.id)}/>`}
                onClick=${() => setEditing(a)}/>`)}
            ${!rows.length ? html`<${ListItem} title="还没有账户"/>` : null}
          <//>`;
      })}

      <${List} title="亲属卡">
        ${ledger.cardsOf(bookId).map(c => html`
          <${ListItem} key=${c.id} multiline
            title=${`${ledger.ownerLabel(bookId, c.from)} 发给 ${ledger.ownerLabel(bookId, c.to)}`}
            subtitle=${c.active === false
              ? '已停用。持卡一方消费时从本人余额扣除'
              : `额度 ${ledger.money(bookId, c.limit)} · 已用 ${ledger.money(bookId, ledger.cardUsed(bookId, c.id))}`
                + ` · 剩余 ${ledger.money(bookId, ledger.cardLeft(bookId, c))}`}
            left=${html`<${Icon} name="gift" size=${18}/>`}
            right=${html`<${Switch} checked=${c.active !== false}
              onChange=${v => ledger.setCard(bookId, c.id, { active: v })}/>`}
            onClick=${() => setCard(c)}/>`)}
        ${!ledger.cardsOf(bookId).length
          ? html`<${ListItem} title="还没有亲属卡" subtitle="在对话中发出申请，对方通过后生效" multiline/>`
          : null}
      <//>

      <${List} title="合计">
        <${ListItem} title="全部账户"
          right=${html`<${Money} bookId=${bookId} amount=${ledger.totalOf(bookId)}/>`}/>
      <//>

      <div class="settings-foot">
        余额由该账户下的全部流水累加得出，不单独存储。删除某一笔流水，余额会随之变化。
        ${who.char
        ? '共同账户与亲属卡在对话中发出申请，对方通过后生效。'
          + '持卡一方消费时在额度内从发卡方余额扣除，额度不足时恢复从本人余额扣除。'
        : ''}
      </div>

      ${editing ? html`
        <${AccountEditor} bookId=${bookId} acc=${editing} who=${who}
          onDrop=${() => { drop(editing); setEditing(null); }}
          onClose=${() => setEditing(null)}/>` : null}
      ${card ? html`
        <${CardEditor} bookId=${bookId} card=${card} onClose=${() => setCard(null)}/>` : null}
    <//>`;
}

function AccountEditor({ bookId, acc, who, onClose, onDrop }) {
  const [name, setName] = useState(acc.name || '');
  const [owner, setOwner] = useState(acc.owner || 'me');
  const owners = [
    { value: 'me', label: who.me },
    ...(who.char ? [{ value: 'char', label: who.char }] : []),
    { value: 'joint', label: '共同' },
  ];

  const save = () => {
    if (!name.trim()) { toast('请填写名称', 'error'); return; }
    if (acc.id) ledger.updateAccount(bookId, acc.id, { name, owner });
    else ledger.addAccount(bookId, { name, owner });
    toast('已保存', 'ok');
    onClose();
  };

  return html`
    <${Sheet} open title=${acc.id ? '账户' : '新建账户'} onClose=${onClose}>
      <div class="pad">
        <${Field} label="名称">
          <${Input} value=${name} placeholder="现金 / 银行卡 / 零钱" onInput=${setName}/>
        <//>
        <${Field} label="归谁"
          desc=${owner === 'joint'
            ? '共同账户由双方共用。'
            : owner === 'char' ? '该账户属于角色，余额同样由流水累加得出。' : '该账户属于本人。'}>
          <${Segmented} value=${owner} items=${owners} onChange=${setOwner}/>
        <//>
      </div>

      ${acc.id ? html`
        <${List}>
          <${ListItem} title="当前余额"
            right=${html`<${Money} bookId=${bookId} amount=${ledger.balanceOf(bookId, acc.id)}/>`}/>
        <//>` : null}

      <div class="pad">
        <${Button} full onClick=${save}>保存<//>
        ${acc.id ? html`
          <div class="pad-t">
            <${Button} full variant="danger" onClick=${onDrop}>删除这个账户<//>
          </div>` : null}
      </div>
    <//>`;
}

function CardEditor({ bookId, card, onClose }) {
  const [limit, setLimit] = useState(String(card.limit || ''));
  const used = ledger.cardUsed(bookId, card.id);

  const save = () => {
    ledger.setCard(bookId, card.id, { limit });
    toast('已保存', 'ok');
    onClose();
  };
  const drop = async () => {
    if (!await confirm({
      title: '删除这张亲属卡', danger: true,
      message: '删除后，此前走这张卡的消费会改为从持卡一方的余额扣除，两边余额都会随之变化。',
    })) return;
    ledger.removeCard(bookId, card.id);
    toast('已删除');
    onClose();
  };

  return html`
    <${Sheet} open title="亲属卡" onClose=${onClose}>
      <${List} inset=${false}>
        <${ListItem} title="发卡方" subtitle=${ledger.ownerLabel(bookId, card.from)} multiline/>
        <${ListItem} title="持卡方" subtitle=${ledger.ownerLabel(bookId, card.to)} multiline/>
        <${ListItem} title="已用" subtitle=${ledger.money(bookId, used)} multiline/>
      <//>
      <div class="pad">
        <${Field} label="额度"
          desc="持卡一方消费时，在剩余额度内从发卡方余额扣除。额度不足时该笔恢复从本人余额扣除。
            已用金额由流水累加得出，不单独存储。">
          <${Input} type="number" inputmode="decimal" value=${limit} onInput=${setLimit}/>
        <//>
      </div>
      <div class="pad">
        <${Button} full onClick=${save}>保存<//>
        <div class="pad-t">
          <${Button} full variant="danger" onClick=${drop}>删除这张卡<//>
        </div>
      </div>
    <//>`;
}
