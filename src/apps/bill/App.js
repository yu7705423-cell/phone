import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState, Button } from '../../ui/index.js';
import { Money, Row, DayHead, dayKey } from './parts.js';
import { EntrySheet } from './EntrySheet.js';
import { BooksPage } from './BooksPage.js';
import { AccountsPage } from './AccountsPage.js';
import { RulesPage } from './RulesPage.js';
import { SpendPage } from './SpendPage.js';

const { db, nav, ledger } = phone;

// 记账。
//
// **账本的切换放在这一页顶上**，不进设置（CLAUDE.md 第 5 条）：
// 想换本账的人正在看账，不该让他退出去翻设置再走回来。

function Home() {
  useStore(db.books.store);
  useStore(db.entries.store);
  useStore(db.settings.store);
  const [sheet, setSheet] = useState(null);

  // 第一次打开时建一本。不走迁移 —— 不用记账的人不该凭空多一本账。
  // 顺手把到期的固定入账补上：不起定时器，谁打开谁补（见 ledger.runRules）
  useEffect(() => { const b = ledger.ensure(); if (b) ledger.runRules(b.id); }, []);

  const bookId = ledger.currentId();
  const book = ledger.get(bookId);
  if (!book) {
    return html`
      <${Page} title="记账">
        <${EmptyState} icon="wallet" title="还没有账本"
          action=${html`<${Button} size="sm" onClick=${() => nav.push('/books')}>新建账本<//>`}/>
      <//>`;
  }

  const st = ledger.stats(bookId);
  const rows = ledger.recent(bookId).filter(e => !e.pending);
  const pend = ledger.pendingOf(bookId);
  const days = [];
  for (const e of rows) {
    const k = dayKey(e.at);
    if (!days.length || days[days.length - 1].day !== k) days.push({ day: k, rows: [] });
    days[days.length - 1].rows.push(e);
  }

  return html`
    <${Page} title="记账"
      right=${html`<button class="nav-text press" onClick=${() => setSheet({})}>记一笔</button>`}>

      <${List}>
        <${ListItem} title=${book.name} arrow multiline
          subtitle=${`${book.kind === 'real' ? '真实账本' : '虚拟账本'} · 共 ${ledger.all().length} 本`}
          left=${html`<${Icon} name=${book.kind === 'real' ? 'wallet' : 'sparkle'} size=${19}/>`}
          onClick=${() => nav.push('/books')}/>
      <//>

      <div class="pad-x pad-t">
        <div class="bl-card">
          <div class="bl-card-head">本月 · ${st.month}</div>
          <div class="bl-card-row">
            <div><span class="bl-lab">支出</span><${Money} bookId=${bookId} amount=${-st.expense} size="lg"/></div>
            <div><span class="bl-lab">收入</span><${Money} bookId=${bookId} amount=${st.income} size="lg"/></div>
          </div>
          <div class="bl-card-foot">
            结余 ${ledger.money(bookId, st.net)}　·　全部账户合计 ${ledger.money(bookId, ledger.totalOf(bookId))}
          </div>
        </div>
      </div>

      <${List}>
        <${ListItem} title="固定入账" arrow multiline
          subtitle=${(() => {
            const rs = ledger.rulesOf(bookId).filter(r => r.active !== false);
            return rs.length
              ? rs.map(r => `每月 ${r.day} 日 ${ledger.money(bookId, r.amount)}`).join('　')
              : '还没有设置。可设置每月固定的收入或支出';
          })()}
          left=${html`<${Icon} name="calendar" size=${18}/>`}
          onClick=${() => nav.push('/rules')}/>
        <${ListItem} title="账户" arrow multiline
          subtitle=${ledger.accountsOf(bookId).map(a =>
            `${a.name} ${ledger.money(bookId, ledger.balanceOf(bookId, a.id))}`).join('　') || '还没有账户'}
          left=${html`<${Icon} name="database" size=${18}/>`}
          onClick=${() => nav.push('/accounts')}/>
      <//>

      ${pend.length ? html`
        <${List} title=${`待确认 · ${pend.length} 笔`}>
          ${pend.map(e => html`
            <${ListItem} key=${e.id} multiline
              title=${e.note || ledger.categoryOf(e.category).label}
              subtitle=${`${ledger.accountOf(bookId, e.accountId)?.name || ''} · 来自对话，确认后计入余额`}
              left=${html`<${Icon} name="notes" size=${18}/>`}
              right=${html`
                <div class="bl-pend">
                  <${Money} bookId=${bookId} amount=${e.amount}/>
                  <div class="bl-pend-act">
                    <button class="chip press" onClick=${ev => { ev.stopPropagation(); ledger.confirm(e.id); }}
                      >确认</button>
                    <button class="chip press" onClick=${ev => { ev.stopPropagation(); ledger.drop(e.id); }}
                      >删除</button>
                  </div>
                </div>`}
              onClick=${() => setSheet({ id: e.id })}/>`)}
        <//>
        <div class="settings-foot">
          以上条目由对话总结时提取，尚未计入余额与本月收支。确认后生效，删除后不再出现。
        </div>` : null}

      <${List}>
        <${ListItem} title="支出构成" arrow multiline
          subtitle=${st.byCategory.length
            ? `本月${st.byCategory.slice(0, 3).map(c => `${c.label} ${ledger.money(bookId, c.amount)}`).join('　')}`
            : '按分类查看每个月的支出构成、占比与笔数'}
          left=${html`<${Icon} name="filter" size=${18}/>`}
          onClick=${() => nav.push('/spend')}/>
      <//>

      ${rows.length ? html`
        <div class="bl-list">
          ${days.map(d => html`
            <div key=${d.day}>
              <${DayHead} bookId=${bookId} day=${d.day} rows=${d.rows}/>
              ${d.rows.map(e => html`
                <${Row} key=${e.id} bookId=${bookId} entry=${e}
                  onClick=${() => setSheet({ id: e.id })}/>`)}
            </div>`)}
        </div>`
      : html`
        <${EmptyState} icon="notes" title="还没有记过账"
          desc="点击右上角记下第一笔。收支会按账户累加，余额随流水变化。"/>`}

      ${sheet ? html`
        <${EntrySheet} bookId=${bookId} entryId=${sheet.id}
          onClose=${() => setSheet(null)}/>` : null}
    <//>`;
}

export default function BillApp({ route }) {
  if (route === '/books') return html`<${BooksPage}/>`;
  if (route === '/accounts') return html`<${AccountsPage}/>`;
  if (route === '/rules') return html`<${RulesPage}/>`;
  if (route === '/spend') return html`<${SpendPage}/>`;
  return html`<${Home}/>`;
}
