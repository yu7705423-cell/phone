import * as space from '../../space.js';

// 情侣空间那一段。
//
// 只写**还没了结的事**和几个数字：在一起多久、最近有什么日子要到、
// 哪些约定还欠着。礼物、地点、信的正文一概不重复 —— 它们本来就是消息，
// 历史里已经有一份，再抄一遍只是把同一段话交两次。
//
// 默认不注入。这一段每轮都占位置，得用户在空间里自己点开（见 CLAUDE.md 第 13 条）。
export const meta = {
  id: 'space',
  label: '情侣空间',
  desc: '在一起多少天、快到的纪念日、还没完成的约定。需在空间里单独开启',
};

const dayText = ({ item, left }) =>
  left === 0 ? `Today is ${item.title}` : `${item.title} is ${left} days away`;

export function build({ chat }) {
  if (!chat) return '';
  const s = space.summary(chat.id);
  if (!s) return '';

  const lines = [];
  if (s.days) lines.push(`This is day ${s.days} of your relationship.`);
  s.soon.forEach(x => lines.push(dayText(x) + '.'));
  if (s.open.length) {
    lines.push(`Promises not yet fulfilled: ${s.open.join('；')}。`);
  }
  if (!lines.length) return '';

  lines.push('The above concerns the two of you. Mention an item only when the'
    + ' conversation touches it; there is no need to raise it every turn.');
  return `\n\n[你们之间]\n${lines.join('\n')}`;
}
