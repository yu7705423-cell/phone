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

// 注入到 prompt 里的每一句都按 CLAUDE.md 第 14 条写：书面语、中性、祈使。
// 这几句只陈述角色当前的状态，不带评价，也不替角色决定怎么表现。
const luckLine = n => {
  if (n >= 1.2) return '近期状态良好，情绪较为平稳。';
  if (n >= 0.4) return '近期状态尚可。';
  if (n > -0.4) return '';
  if (n > -1.2) return '近期状态欠佳，耐心较平时短。';
  return '近期状态持续不佳，较平时容易烦躁。';
};

export function build({ char }) {
  if (!char) return '';
  const b = day.brief(char.id);
  if (!b) return '';

  const lines = [`今天是 ${b.date}，你所在时区当前为${b.slot.label}。`];
  if (b.summary.length) lines.push(...b.summary);

  const now = [];
  if (b.nowItems.length) now.push(`当前时段的安排：${b.nowItems.join('；')}。`);
  if (b.meal) now.push(b.meal + '。');
  if (b.event) {
    const tone = events.toneOf(b.event.tone);
    now.push(`今天另外发生了一件事：${b.event.text}。`);
    if (tone && tone.id !== 'plain') {
      now.push(`该事件使你感到${tone.id === 'good' ? '愉快' : '不快'}。`);
    }
  }
  if (now.length) lines.push('', ...now);

  const luck = luckLine(b.luck);
  if (luck) lines.push(luck);

  lines.push('',
    '以上为你本人的安排，不是待办清单。聊到相关内容时再提及，不要在开始时复述全部安排。',
    '安排可以更改，也可以临时取消，但不要当作从未安排过。',
    '尚未到来的时段，你只知道打算做什么，不知道完成情况。');

  return `\n\n[你今天]\n${lines.join('\n')}`;
}
