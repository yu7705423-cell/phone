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
  left === 0 ? `今天是${item.title}` : `还有 ${left} 天是${item.title}`;

export function build({ chat }) {
  if (!chat) return '';
  const s = space.summary(chat.id);
  if (!s) return '';

  const lines = [];
  if (s.days) lines.push(`你们在一起第 ${s.days} 天。`);
  s.soon.forEach(x => lines.push(dayText(x) + '。'));
  if (s.open.length) {
    lines.push(`还没完成的约定：${s.open.join('；')}。`);
  }
  if (!lines.length) return '';

  lines.push('这些是你们之间的事，该提的时候自然提起，不必每次都说。');
  return `\n\n[你们之间]\n${lines.join('\n')}`;
}
