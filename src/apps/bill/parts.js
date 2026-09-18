import { html } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Icon } from '../../ui/index.js';

const { ledger } = phone;

// 金额那一行。进账出账只靠正负号和颜色区分，不另画箭头 ——
// 一列数字里，颜色比图标看得快。
export function Money({ bookId, amount, size = 'md' }) {
  const n = Number(amount) || 0;
  const cls = n > 0 ? 'bl-in' : n < 0 ? 'bl-out' : '';
  const text = ledger.money(bookId, Math.abs(n));
  return html`<span class=${`bl-money bl-${size} ${cls}`}>${n > 0 ? '+' : n < 0 ? '−' : ''}${text}</span>`;
}

export function Row({ bookId, entry, onClick }) {
  const acc = ledger.accountOf(bookId, entry.accountId);
  const cat = ledger.categoryOf(entry.category);
  const sub = [acc?.name, entry.note].filter(Boolean).join(' · ');
  return html`
    <div class="bl-row press" onClick=${onClick}>
      <div class="bl-cat">${cat.label}</div>
      <div class="bl-main">
        <div class="bl-title ellipsis">${entry.note || cat.label}</div>
        ${sub ? html`<div class="bl-sub ellipsis">${sub}</div>` : null}
      </div>
      <${Money} bookId=${bookId} amount=${entry.amount}/>
    </div>`;
}

export function DayHead({ bookId, day, rows }) {
  const inSum = rows.filter(r => r.amount > 0).reduce((n, r) => n + r.amount, 0);
  const outSum = rows.filter(r => r.amount < 0).reduce((n, r) => n - r.amount, 0);
  return html`
    <div class="bl-day">
      <span>${day}</span>
      <span class="bl-day-sum">
        ${outSum ? `支出 ${ledger.money(bookId, outSum)}` : ''}
        ${outSum && inSum ? ' · ' : ''}
        ${inSum ? `收入 ${ledger.money(bookId, inSum)}` : ''}
      </span>
    </div>`;
}

export const OwnerDot = ({ owner }) => html`
  <${Icon} name=${owner === 'joint' ? 'users' : owner === 'char' ? 'heart' : 'user'} size=${16}/>`;

export const dayKey = at => {
  const d = new Date(at);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
