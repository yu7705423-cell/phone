import * as day from '../../day.js';
import * as events from '../../events.js';

// 「你今天」那一段。
//
// 分两层是这一段的全部要害：
//   **一整天的摘要**当天常驻 —— 她当然知道自己今天要干什么；
//   **具体到某个时段的事**和撞上的那件随机事件，**时段到了才出现**。
//   中午十二点就知道「今晚会停电」，那不叫过日子。
//
// 大运不写数字，只写倾向。写「今天运势 +1.4」，模型会拿它当设定念出来。
export const meta = {
  id: 'day',
  label: '今天',
  desc: '角色当天的日程、当前时段、撞上的事。需在角色卡中开启',
};

const luckLine = n => {
  if (n >= 1.2) return '最近顺得很，看什么都不太容易上火。';
  if (n >= 0.4) return '最近还算顺。';
  if (n > -0.4) return '';
  if (n > -1.2) return '最近不太顺，耐心比平时短一点。';
  return '最近一直在走背字，容易烦。';
};

export function build({ char }) {
  if (!char) return '';
  const b = day.brief(char.id);
  if (!b) return '';

  const lines = [`今天是 ${b.date}，你那边现在是${b.slot.label}。`];
  if (b.summary.length) lines.push(...b.summary);

  const now = [];
  if (b.nowItems.length) now.push(`这个时段你本来要做的：${b.nowItems.join('；')}。`);
  if (b.meal) now.push(b.meal + '。');
  if (b.event) {
    const tone = events.toneOf(b.event.tone);
    now.push(`今天还撞上一件事：${b.event.text}。`);
    if (tone && tone.id !== 'plain') now.push(`这件事${tone.id === 'good' ? '让你高兴' : '让你不痛快'}。`);
  }
  if (now.length) lines.push('', ...now);

  const luck = luckLine(b.luck);
  if (luck) lines.push(luck);

  lines.push('',
    '这些是你自己的安排，不是任务清单。聊起来该提的时候提，别一上来就报一遍。',
    '计划可以改，也可以临时不去，但不要当成从来没安排过。',
    '还没到的时段只知道要做什么，不知道做得怎么样。');

  return `\n\n[你今天]\n${lines.join('\n')}`;
}
