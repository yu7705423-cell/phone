import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, Button, Sheet, Field, Input, toast, confirm } from '../../ui/index.js';
import { Money, Row, DayHead, dayKey } from './parts.js';
import { EntrySheet } from './EntrySheet.js';

const { db, nav, ledger, request } = phone;

// 一个钱包一页：我的钱、角色的钱、情侣账户（ARCHITECTURE 4.278）。
//
// 三个钱包是同一张页：余额、这个钱包能做的几件事、它的固定收支、它的流水。
// 差别只在「能做的几件事」：我的钱能存入情侣账户；角色的钱由模型按角色卡生成；
// 情侣账户只能存，动用要在对话里申请。
export function PoolPage({ owner }) {
  useStore(db.books.store);
  useStore(db.entries.store);
  useStore(db.settings.store);
  useStore(db.messages.store);
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);
  const bookId = ledger.currentId();
  const book = ledger.get(bookId);
  if (!book) return html`<${Page} title="钱包" onBack=${nav.pop}/>`;

  const who = ledger.whoOf(bookId);
  const isMe = owner === ledger.ME;
  const isChar = owner === ledger.CHAR;
  const isJoint = owner === ledger.JOINT;
  const title = isMe ? '我的钱' : isChar ? `${who.char || '角色'}的钱` : '情侣账户';
  const acc = ledger.defaultFor(bookId, owner);
  const ready = !isChar || ledger.charReady(bookId);
  const joint = ledger.hasJoint(bookId);
  const info = isChar ? ledger.charMoneyOf(bookId) : null;
  const ids = new Set(ledger.accountsOf(bookId).filter(a => a.owner === owner).map(a => a.id));
  const rows = ledger.recent(bookId).filter(e => !e.pending && ids.has(e.accountId));
  const rules = ledger.rulesOf(bookId).filter(r => ids.has(r.accountId));
  const days = [];
  for (const e of rows) {
    const k = dayKey(e.at);
    if (!days.length || days[days.length - 1].day !== k) days.push({ day: k, rows: [] });
    days[days.length - 1].rows.push(e);
  }

  // 存入情侣账户：从我的钱包转过去，落在对话里（角色看得见），发出即落定
  const deposit = () => setSheet({ deposit: true });
  const doDeposit = amount => {
    if (!book.chatId) { toast('这本账没有关联对话', 'error'); return; }
    if (!ledger.affordable(book.chatId, ledger.ME, amount)) { toast('余额不足，存不了这么多', 'error'); return; }
    try {
      request.send({ chatId: book.chatId, role: 'user', authorId: 'me', kind: request.DEPOSIT, amount });
      toast('已存入', 'ok');
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const generate = async () => {
    if (!await confirm({
      title: ready ? '重新生成角色的钱' : '按角色卡生成角色的钱',
      message: '调用一次接口。模型按角色卡决定起始余额与每月固定收支。'
        + (ready ? '上一次生成的起始余额与固定收支会被替换，你自己记的流水不变。' : ''),
      okText: '生成',
    })) return;
    setBusy(true);
    try { await ledger.ai.generate(bookId); toast('已生成', 'ok'); }
    catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  return html`
    <${Page} title=${title} onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="bl-card">
          <div class="bl-card-head">${isJoint ? '两个人共同的钱' : isChar ? '由模型按角色卡生成' : '本人的钱'}</div>
          ${ready && acc
            ? html`<${Money} bookId=${bookId} amount=${ledger.totalOf(bookId, owner)} size="lg"/>`
            : html`<div class="bl-lab">${isChar ? '尚未生成' : '尚未开设'}</div>`}
          <div class="bl-card-foot">
            ${isChar && !ready
              ? '生成前视作未知：不写入角色的上下文，也不拦截该角色的支付。'
              : isJoint ? '双方均可存入。动用需在对话中发出申请，对方通过后从此处扣除。'
              : '余额由流水累加得出，不单独存储。'}
          </div>
        </div>
      </div>

      ${isChar && info?.summary ? html`
        <${List} title="角色卡上的钱">
          <${ListItem} title=${info.summary} multiline/>
        <//>` : null}

      <div class="pad">
        ${isChar ? html`
          <${Button} full disabled=${busy} onClick=${generate}>
            ${busy ? '生成中' : ready ? '重新生成（调用一次接口）' : '按角色卡生成（调用一次接口）'}
          <//>` : null}
        ${(isMe || isJoint) && joint && book.chatId ? html`
          <div class=${isChar ? 'pad-t' : ''}>
            <${Button} full onClick=${deposit}>${isMe ? '存入情侣账户' : '从我的钱存入'}<//>
          </div>` : null}
        ${isJoint && !joint ? html`
          <div class="settings-foot">在对话中发出「开设情侣账户」的申请，对方通过后建立。</div>` : null}
        ${acc && !isJoint ? html`
          <div class="acc-money pad-t">
            <button class="chip press" onClick=${() => setSheet({ accountId: acc.id, side: 'in', title: `记一笔收入` })}>记一笔收入</button>
            <button class="chip press" onClick=${() => setSheet({ accountId: acc.id, side: 'out', title: `记一笔支出` })}>记一笔支出</button>
          </div>` : null}
      </div>

      ${acc ? html`
        <${List} title="固定收支">
          ${rules.map(r => html`
            <${ListItem} key=${r.id} title=${`每月 ${r.day} 日`} subtitle=${r.note} multiline
              left=${html`<${Icon} name="calendar" size=${18}/>`}
              right=${html`<${Money} bookId=${bookId} amount=${r.amount}/>`}
              onClick=${() => nav.push('/rules')}/>`)}
          <${ListItem} title=${rules.length ? '管理固定收支' : '还没有固定收支'} arrow
            subtitle=${rules.length ? '' : '可设置每月固定的收入或支出'}
            multiline=${!rules.length}
            onClick=${() => nav.push('/rules')}/>
        <//>` : null}

      <${List}>
        <${ListItem} title="账户设置" arrow subtitle="多个账户、私密账户、亲属卡" multiline
          left=${html`<${Icon} name="database" size=${18}/>`}
          onClick=${() => nav.push('/accounts')}/>
      <//>

      ${rows.length ? html`
        <div class="bl-list">
          ${days.map(d => html`
            <div key=${d.day}>
              <${DayHead} bookId=${bookId} day=${d.day} rows=${d.rows}/>
              ${d.rows.map(e => html`
                <${Row} key=${e.id} bookId=${bookId} entry=${e}
                  onClick=${() => (e.src === 'message' ? null : setSheet({ id: e.id }))}/>`)}
            </div>`)}
        </div>` : html`<div class="settings-foot">这个钱包还没有流水。</div>`}

      ${sheet?.deposit ? html`
        <${DepositSheet} bookId=${bookId} onSubmit=${doDeposit} onClose=${() => setSheet(null)}/>` : null}
      ${sheet && !sheet.deposit ? html`
        <${EntrySheet} bookId=${bookId} entryId=${sheet.id} preset=${sheet.id ? null : sheet}
          onClose=${() => setSheet(null)}/>` : null}
    <//>`;
}

function DepositSheet({ bookId, onSubmit, onClose }) {
  const [amount, setAmount] = useState('');
  const mine = ledger.defaultFor(bookId, ledger.ME);
  return html`
    <${Sheet} open title="存入情侣账户" onClose=${onClose}>
      <div class="pad">
        <${Field} label="金额"
          desc=${mine ? `从「${mine.name}」转入。当前余额 ${ledger.money(bookId, ledger.balanceOf(bookId, mine.id))}` : ''}>
          <${Input} type="number" inputmode="decimal" value=${amount} placeholder="0" onInput=${setAmount}/>
        <//>
        <div class="pad-t">
          <${Button} full disabled=${!(Number(amount) > 0)}
            onClick=${() => { onSubmit(amount); onClose(); }}>存入<//>
        </div>
      </div>
      <div class="settings-foot">存入会作为一条消息出现在对话中，角色看得见。不需要对方批准。</div>
    <//>`;
}
