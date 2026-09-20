import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState } from '../../ui/index.js';
import { Money } from './parts.js';

const { db, nav, ledger } = phone;

// 钱都花在哪儿了。
//
// 首页那张卡只给「本月支出多少」，一个总数看不出什么。这一页摊开：
// 哪一类吃掉了多少、占几成、花了多少笔。**占比和笔数缺一不可** ——
// 三千块是一次买掉的还是三十次凑出来的，是两回事。
//
// 月份自己翻。只列有流水的那几个月，翻到空月份没有意义。

export function SpendPage() {
  useStore(db.entries.store);
  useStore(db.books.store);
  const bookId = ledger.currentId();
  const book = ledger.get(bookId);
  const list = ledger.months(bookId);
  const [month, setMonth] = useState(list[0]);
  if (!book) return html`<${Page} title="支出" onBack=${nav.pop}/>`;

  const at = list.indexOf(month);
  const sp = ledger.spending(bookId, month);
  const st = ledger.stats(bookId, month);
  const pct = v => `${(v * 100).toFixed(v < 0.01 ? 1 : 0)}%`;

  return html`
    <${Page} title="支出" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="chip-row">
          ${list.map(m => html`
            <button key=${m} class=${`chip${m === month ? ' is-active' : ''}`}
              onClick=${() => setMonth(m)}>${m}</button>`)}
        </div>
      </div>

      <div class="pad-x pad-t">
        <div class="bl-card">
          <div class="bl-card-head">${month}</div>
          <div class="bl-card-row">
            <div><span class="bl-lab">支出</span>
              <${Money} bookId=${bookId} amount=${-sp.total} size="lg"/></div>
            <div><span class="bl-lab">收入</span>
              <${Money} bookId=${bookId} amount=${st.income} size="lg"/></div>
          </div>
          <div class="bl-card-foot">
            结余 ${ledger.money(bookId, st.net)}　·　共 ${sp.rows.reduce((n, r) => n + r.count, 0)} 笔支出
          </div>
        </div>
      </div>

      ${sp.rows.length ? html`
        <${List} title="按分类">
          ${sp.rows.map(r => html`
            <${ListItem} key=${r.id} multiline title=${r.label}
              subtitle=${html`
                <span class="sp-bar"><span style=${`width:${Math.max(2, r.share * 100)}%`}></span></span>
                ${`占 ${pct(r.share)} · ${r.count} 笔`}`}
              right=${html`<${Money} bookId=${bookId} amount=${-r.amount}/>`}/>`)}
        <//>
        <div class="settings-foot">
          仅统计已计入余额的支出。待确认的条目不计入，确认后出现在此处。
        </div>`
      : html`<${EmptyState} icon="wallet" title=${`${month} 没有支出`}
          desc=${at === 0 ? '这个月还没有记过支出。' : '这个月没有记过支出。'}/>`}
    <//>`;
}
