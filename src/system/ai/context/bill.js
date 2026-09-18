import * as ledger from '../../ledger.js';

// 「你的钱」那一段。
//
// 存在的唯一理由和 geo.js 里那个距离一样：**这几个数字不能让模型编。**
// 问它「你还有多少钱」，它会给一个听起来很像的数，而且每次都不一样，
// 于是账上明明只剩两百，它照样能掏出一笔大的。
//
// 所以余额在本地按流水折好，连同币种一起写进去，再明说一句别改。
// 和点数、金额、时间一样：数字不是模型的活。
//
// 只写数字，不写「所以你该省着点」之类的话 —— 那是判断，不是事实
//（CLAUDE.md 第 16 条）。钱少了怎么办，由角色自己按人设决定。

export const meta = {
  id: 'bill',
  label: '账户余额',
  desc: '角色与对方的账户余额、共同账户、本月支出。需在记账中将账本关联到该对话',
};

export function build({ chat }) {
  const c = chat ? ledger.context(chat.id) : null;
  if (!c) return '';

  const lines = [];
  // 不用所有格：名字是角色卡里的，可能是任何语言，「我's」读起来很怪
  if (c.self) lines.push(`Your balance: ${c.self}${c.selfName ? ` (${c.selfName})` : ''}.`);
  if (c.other) lines.push(`Balance of ${c.otherName}: ${c.other}.`);
  if (c.joint) lines.push(`Joint account: ${c.joint}.`);
  if (!lines.length) return '';
  lines.push(`Your spending this month: ${c.month}.`);
  lines.push('These figures are computed by the system from the recorded entries.'
    + ' Write them exactly as given when an amount comes up. Do not substitute'
    + ' another figure, and do not estimate one yourself.');
  if (c.strict) {
    lines.push('An amount you send is deducted from the balance above.'
      + ' A payment larger than the balance does not go through.');
  }
  return `\n\n[你的钱]\n${lines.join('\n')}`;
}
