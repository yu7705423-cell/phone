import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, NumberInput, Button, Switch, Icon,
  Sheet, toast, confirm } from '../../ui/index.js';

const { db, nav, ledger } = phone;

// 固定入账。每月某一天自动落一笔。
//
// 不起定时器：谁打开账本谁顺手把到期的补上。页面关着的时候没有任何东西在跑。
export function RulesPage() {
  useStore(db.books.store);
  useStore(db.entries.store);
  useStore(db.settings.store);
  const [editing, setEditing] = useState(null);
  const bookId = ledger.currentId();
  const book = ledger.get(bookId);
  if (!book) return html`<${Page} title="固定入账" onBack=${nav.pop}/>`;

  const list = ledger.rulesOf(bookId);

  const drop = async r => {
    if (!await confirm({
      title: '删除这条规则', danger: true,
      message: '已经落下的流水不会删除，只是此后不再自动入账。',
    })) return;
    ledger.removeRule(bookId, r.id);
    toast('已删除');
  };

  return html`
    <${Page} title="固定入账" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => setEditing({ day: 1, amount: '', category: 'salary', note: '' })}
        >新建</button>`}>

      <${List}>
        ${list.map(r => {
          const acc = ledger.accountOf(bookId, r.accountId);
          return html`
            <${ListItem} key=${r.id} multiline
              title=${`每月 ${r.day} 日　${ledger.money(bookId, r.amount)}`}
              subtitle=${[acc?.name, r.note, ledger.categoryOf(r.category).label]
                .filter(Boolean).join(' · ')}
              left=${html`<${Icon} name="calendar" size=${18}/>`}
              right=${html`<${Switch} checked=${r.active !== false}
                onChange=${v => ledger.setRule(bookId, r.id, { active: v })}/>`}
              onClick=${() => setEditing(r)}/>`;
        })}
        ${!list.length ? html`<${ListItem} title="还没有固定入账"/>` : null}
      <//>

      <div class="settings-foot">
        每月到日期后自动落一笔。填负数即为固定支出，例如房租。
        补账在打开记账时进行，不在后台运行：应用未打开的期间不会入账，
        再次打开时一次补齐。新建的规则从建立当天起算，不补此前的月份。
      </div>

      ${editing ? html`
        <${RuleEditor} bookId=${bookId} rule=${editing}
          onDrop=${() => { drop(editing); setEditing(null); }}
          onClose=${() => setEditing(null)}/>` : null}
    <//>`;
}

function RuleEditor({ bookId, rule, onClose, onDrop }) {
  const [day, setDay] = useState(rule.day || 1);
  const [amount, setAmount] = useState(String(rule.amount ?? ''));
  const [accountId, setAccountId] = useState(rule.accountId || ledger.accountsOf(bookId)[0]?.id || '');
  const [category, setCategory] = useState(rule.category || 'salary');
  const [note, setNote] = useState(rule.note || '');

  const save = () => {
    const v = Number(amount) || 0;
    if (!v) { toast('请填写金额', 'error'); return; }
    if (rule.id) ledger.setRule(bookId, rule.id, { day, amount: v, accountId, category, note });
    else ledger.addRule(bookId, { day, amount: v, accountId, category, note });
    ledger.runRules(bookId);
    toast('已保存', 'ok');
    onClose();
  };

  return html`
    <${Sheet} open title=${rule.id ? '固定入账' : '新建固定入账'} onClose=${onClose}>
      <div class="pad">
        <${Field} label="金额" desc="填负数即为固定支出，例如房租。">
          <${Input} type="number" inputmode="decimal" value=${amount}
            placeholder="0" onInput=${setAmount}/>
        <//>
        <${Field} label="每月哪一天" desc="该月没有这一天时，落在当月最后一天。">
          <${NumberInput} value=${day} min=${1} max=${31} unit="日"
            onChange=${setDay}/>
        <//>
      </div>

      <${List} title="落到哪个账户">
        ${ledger.accountsOf(bookId).map(a => html`
          <${ListItem} key=${a.id} title=${a.name}
            subtitle=${ledger.ownerLabel(bookId, a.owner)} multiline
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
        <${Field} label="备注">
          <${Input} value=${note} placeholder="工资 / 房租" maxlength=${40} onInput=${setNote}/>
        <//>
      </div>

      <div class="pad">
        <${Button} full onClick=${save}>保存<//>
        ${rule.id ? html`
          <div class="pad-t">
            <${Button} full variant="danger" onClick=${onDrop}>删除这条规则<//>
          </div>` : null}
      </div>
    <//>`;
}
