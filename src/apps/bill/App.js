import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState, Button } from '../../ui/index.js';
import { Money, Row, DayHead, dayKey } from './parts.js';
import { EntrySheet } from './EntrySheet.js';
import { BooksPage } from './BooksPage.js';
import { AccountsPage } from './AccountsPage.js';

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

  // 第一次打开时建一本。不走迁移 —— 不用记账的人不该凭空多一本账
  useEffect(() => { ledger.ensure(); }, []);

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
        <${ListItem} title="账户" arrow multiline
          subtitle=${ledger.accountsOf(bookId).map(a =>
            `${a.name} ${ledger.money(bookId, ledger.balanceOf(bookId, a.id))}`).join('　') || '还没有账户'}
          left=${html`<${Icon} name="database" size=${18}/>`}
          onClick=${() => nav.push('/accounts')}/>
      <//>

      ${st.byCategory.length ? html`
        <${List} title="本月支出分类">
          ${st.byCategory.map(c => html`
            <${ListItem} key=${c.id} title=${c.label}
              right=${html`<${Money} bookId=${bookId} amount=${-c.amount}/>`}/>`)}
        <//>` : null}

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
  return html`<${Home}/>`;
}
