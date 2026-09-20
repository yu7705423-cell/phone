import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Segmented, Switch, Icon,
  Sheet, toast, confirm } from '../../ui/index.js';
import { Money } from './parts.js';
import { EntrySheet } from './EntrySheet.js';

const { db, nav, ledger } = phone;

// 账户。共同账户与角色账户在这里建，动用它们的规矩（申请、亲属卡、私密卡）
// 在后面的批次里做 —— 这一批先把「谁有多少钱」立起来。
export function AccountsPage() {
  useStore(db.books.store);
  useStore(db.entries.store);
  useStore(db.settings.store);
  const [editing, setEditing] = useState(null);
  const [card, setCard] = useState(null);
  const [guess, setGuess] = useState(null);
  // 存入 / 取出。**这件事的入口就该在账户旁边**（第 5 条）：
  // 想给某个账户加钱的人正看着那个账户，不该让他退回去「记一笔」再挑一遍
  const [moving, setMoving] = useState(null);
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
                subtitle=${a.secret && !ledger.unlocked(a) ? '已锁定，不计入合计' : ''}
                multiline=${a.secret && !ledger.unlocked(a)}
                left=${html`<${Icon} name=${a.secret ? 'lock' : null} size=${16}/>`}
                right=${a.secret && !ledger.unlocked(a)
                  ? html`<span class="li-hint">锁着</span>`
                  : html`<${Money} bookId=${bookId} amount=${ledger.balanceOf(bookId, a.id)}/>`}
                onClick=${() => (a.secret && !ledger.unlocked(a) ? setGuess(a) : setEditing(a))}/>
              ${a.secret && !ledger.unlocked(a) ? null : html`
                <div key=${`m-${a.id}`} class="acc-money">
                  <button class="chip press"
                    onClick=${() => setMoving({ accountId: a.id, side: 'in', title: `存入 ${a.name}` })}
                    >存入</button>
                  <button class="chip press"
                    onClick=${() => setMoving({ accountId: a.id, side: 'out', title: `取出 ${a.name}` })}
                    >取出</button>
                </div>`}`)}
            ${!rows.length ? html`<${ListItem} title="还没有账户"/>` : null}
          <//>`;
      })}

      ${moving ? html`
        <${EntrySheet} bookId=${bookId} preset=${moving}
          onClose=${() => setMoving(null)}/>` : null}

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
      ${guess ? html`
        <${GuessSheet} bookId=${bookId} acc=${guess} onClose=${() => setGuess(null)}/>` : null}
    <//>`;
}

function AccountEditor({ bookId, acc, who, onClose, onDrop }) {
  const [name, setName] = useState(acc.name || '');
  const [owner, setOwner] = useState(acc.owner || 'me');
  const [secret, setSecret] = useState(!!acc.secret);
  const [pass, setPass] = useState(acc.pass || '');
  const [hint, setHint] = useState(acc.hint || '');
  const owners = [
    { value: 'me', label: who.me },
    ...(who.char ? [{ value: 'char', label: who.char }] : []),
    { value: 'joint', label: '共同' },
  ];

  const save = () => {
    if (!name.trim()) { toast('请填写名称', 'error'); return; }
    const extra = owner === 'char' ? { secret, pass, hint } : { secret: false };
    if (acc.id) ledger.updateAccount(bookId, acc.id, { name, owner, ...extra });
    else ledger.addAccount(bookId, { name, owner, ...extra });
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

      ${owner === 'char' ? html`
        <${List} title="私密账户">
          <${ListItem} title="设为私密" multiline
            subtitle=${secret
              ? '余额不显示、不计入合计，也不写入角色的上下文。需要输入密码才能查看。'
              : '关闭。该账户的余额正常显示。'}
            right=${html`<${Switch} checked=${secret}
              onChange=${setSecret}/>`}/>
        <//>
        ${secret ? html`
          <div class="pad">
            <${Field} label="密码" desc="仅保存在本设备。输入正确后永久解锁。">
              <${Input} value=${pass} placeholder="四到六位" maxlength=${12}
                onInput=${setPass}/>
            <//>
            <${Field} label="线索" desc="查看时显示，供推断密码。留空则不显示线索。">
              <${Input} value=${hint} placeholder="与某个日期有关" maxlength=${30}
                onInput=${setHint}/>
            <//>
          </div>` : null}` : null}

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

// 猜密码。整件事只发生在这一页里 —— 密码与余额都不进 prompt，
// 注入了角色迟早会说漏，那就没得猜了。
function GuessSheet({ bookId, acc, onClose }) {
  const [input, setInput] = useState('');
  const [wrong, setWrong] = useState(0);

  const submit = () => {
    if (ledger.tryPass(bookId, acc.id, input)) {
      toast('已解锁', 'ok');
      onClose();
    } else {
      setWrong(n => n + 1);
      setInput('');
    }
  };

  return html`
    <${Sheet} open title=${acc.name} onClose=${onClose}>
      <div class="settings-foot">
        该账户已锁定。余额不显示，也不计入合计。输入正确的密码后永久解锁。
      </div>
      ${acc.hint ? html`
        <${List} inset=${false}>
          <${ListItem} title="线索" subtitle=${acc.hint} multiline
            left=${html`<${Icon} name="key" size=${18}/>`}/>
        <//>` : null}
      <div class="pad">
        <${Field} label="密码"
          desc=${wrong ? `不正确。已尝试 ${wrong} 次，可继续尝试。` : '输入后点击下方按钮。'}>
          <${Input} value=${input} inputmode="numeric" maxlength=${12}
            placeholder="密码" onInput=${setInput}/>
        <//>
        <div class="pad-t">
          <${Button} full disabled=${!input.trim()} onClick=${submit}>解锁<//>
        </div>
      </div>
    <//>`;
}
