import { html, useState } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Sheet, List, ListItem, Field, Input, Textarea, Button, Segmented, toast, confirm } from '../../ui/index.js';

const { ledger } = phone;

const SIDES = [
  { value: 'out', label: '支出' },
  { value: 'in', label: '收入' },
];

const toLocal = at => {
  const d = new Date(at);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 记一笔。新建和修改共用这一张 —— 两边字段完全一样，写两份迟早走岔。
export function EntrySheet({ bookId, entryId, onClose }) {
  const old = entryId ? phone.db.entries.get(entryId) : null;
  const accs = ledger.accountsOf(bookId);
  const [side, setSide] = useState(old && old.amount > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState(old ? String(Math.abs(old.amount)) : '');
  const [accountId, setAccountId] = useState(old?.accountId || accs[0]?.id || '');
  const [category, setCategory] = useState(old?.category || 'food');
  const [note, setNote] = useState(old?.note || '');
  const [at, setAt] = useState(toLocal(old?.at || Date.now()));

  const save = () => {
    const v = Math.abs(Number(amount) || 0);
    if (!v) { toast('请填写金额', 'error'); return; }
    const signed = side === 'in' ? v : -v;
    const when = new Date(at).getTime() || Date.now();
    try {
      if (old) ledger.edit(old.id, { amount: signed, accountId, category, note, at: when });
      else ledger.add({ bookId, accountId, amount: signed, category, note, at: when });
      toast(old ? '已保存' : '已记账', 'ok');
      onClose();
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
  };

  const drop = async () => {
    if (!await confirm({ title: '删除这一笔', danger: true, message: '删除后余额会一并减去这一笔。' })) return;
    ledger.drop(old.id);
    toast('已删除');
    onClose();
  };

  return html`
    <${Sheet} open title=${old ? '修改这一笔' : '记一笔'} onClose=${onClose}>
      <div class="pad">
        <${Segmented} value=${side} items=${SIDES} onChange=${setSide}/>
      </div>

      <div class="pad-x">
        <${Field} label="金额">
          <${Input} type="number" inputmode="decimal" value=${amount} placeholder="0"
            onInput=${setAmount}/>
        <//>
      </div>

      <${List} title="记到哪个账户">
        ${accs.map(a => html`
          <${ListItem} key=${a.id} title=${a.name}
            subtitle=${`${ledger.ownerLabel(bookId, a.owner)} · 余额 ${ledger.money(bookId, ledger.balanceOf(bookId, a.id))}`}
            multiline
            right=${accountId === a.id ? html`<span class="li-hint">已选</span>` : null}
            onClick=${() => setAccountId(a.id)}/>`)}
      <//>

      <div class="pad-x pad-t">
        <${Field} label="分类">
          <div class="chip-row">
            ${ledger.CATEGORIES.map(c => html`
              <button key=${c.id} class=${`chip${category === c.id ? ' is-active' : ''}`}
                onClick=${() => setCategory(c.id)}>${c.label}</button>`)}
          </div>
        <//>
      </div>

      <div class="pad-x">
        <${Field} label="备注">
          <${Textarea} rows=${2} value=${note} placeholder="这一笔是什么"
            onInput=${setNote}/>
        <//>
        <${Field} label="时间">
          <${Input} type="datetime-local" value=${at} onInput=${setAt}/>
        <//>
      </div>

      <div class="pad">
        <${Button} full onClick=${save}>${old ? '保存' : '记下'}<//>
        ${old ? html`
          <div class="pad-t">
            <${Button} full variant="danger" onClick=${drop}>删除这一笔<//>
          </div>` : null}
      </div>
    <//>`;
}
