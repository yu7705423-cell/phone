import { characters, chats } from '../../db/index.js';
import { template, fillTemplate } from '../templates.js';
import { runJSONTask } from '../engine.js';
import * as ledger from '../../ledger.js';
import * as currency from '../../currency.js';

// 角色的钱（ARCHITECTURE 4.278）。
//
// 角色有多少钱、每月固定进多少出多少，由模型按角色卡定，不由用户替它填。
// **用户点了才调，一次一个请求**（CLAUDE.md 第 15 条）；按钮上写着要调一次接口。
//
// 落下来的是三样：一笔起始余额（src 为 seed 的流水）、几条固定收支（rules，by 为 ai），
// 以及一段说明存在账本上（charMoney）。重新生成时把上一次的这三样整批换掉，
// 用户自己记的流水、自己建的固定入账一律不动。

const num = v => (Number.isFinite(Number(v)) ? Math.abs(Number(v)) : 0);
const str = v => String(v ?? '').trim();

function charOf(bookId) {
  const book = ledger.get(bookId);
  const chat = book?.chatId ? chats.get(book.chatId) : null;
  return chat ? characters.get((chat.characterIds || [])[0]) : null;
}

/** 生成并落账。回来的是写在账本上的那份说明 */
export async function generate(bookId) {
  const book = ledger.get(bookId);
  if (!book) throw new Error('账本不存在');
  const char = charOf(bookId);
  if (!char) throw new Error('这本账还没有关联对话');
  const acc = ledger.ensureChar(bookId);
  const out = await runJSONTask('char.money', {
    system: fillTemplate(template('task.char-money'), {
      charName: char.name,
      charPersona: [char.persona, char.description, char.scenario].filter(Boolean).join('\n\n') || '(no settings written)',
      currency: currency.get(book.currency).code,
    }),
    key: `char-money:${bookId}`,
    maxTokens: 900,
  });
  return apply(bookId, acc, out);
}

function apply(bookId, acc, out) {
  const rows = list => (Array.isArray(list) ? list : []).map(r => ({
    day: Math.max(1, Math.min(28, Math.round(Number(r?.day) || 1))),
    amount: num(r?.amount), note: str(r?.note).slice(0, 40),
  })).filter(r => r.amount > 0);
  const income = rows(out?.income);
  const expenses = rows(out?.expenses);
  // 上一次生成的整批换掉
  ledger.rulesOf(bookId).filter(r => r.by === 'ai').forEach(r => ledger.removeRule(bookId, r.id));
  ledger.seed(bookId, acc.id, num(out?.balance));
  income.forEach(r => ledger.addRule(bookId, { accountId: acc.id, day: r.day, amount: r.amount, category: 'salary', note: r.note || '收入', by: 'ai' }));
  expenses.forEach(r => ledger.addRule(bookId, { accountId: acc.id, day: r.day, amount: -r.amount, category: 'home', note: r.note || '固定支出', by: 'ai' }));
  const info = {
    summary: str(out?.summary).slice(0, 300),
    balance: num(out?.balance),
    income, expenses,
    at: Date.now(),
  };
  ledger.setCharMoney(bookId, info);
  return info;
}
