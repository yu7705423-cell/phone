import * as day from '../../day.js';
import * as events from '../../events.js';
import * as trip from '../../trip.js';
import * as weather from '../../weather.js';

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
  if (n >= 1.2) return 'You have been in good form lately, and fairly even-tempered.';
  if (n >= 0.4) return 'You have been in reasonable form lately.';
  if (n > -0.4) return '';
  if (n > -1.2) return 'You have been in poor form lately, with less patience than usual.';
  return 'You have been in poor form for a while, and are more easily irritated than usual.';
};

export function build({ char }) {
  if (!char) return '';
  // **出行期间这一段整个让开。** 人在京都，而这里写着「今天要去邮局」——
  // 那是它在家时排的日程，出行那几天照写就是错的。
  // 这几天的安排由「这次出行」那一段给（见 context/trip.js）。
  // 出行一结束自己就回来了：阶段是按日期算的，没有谁要去收拾。
  if (trip.goingFor(char.id)) return '';
  const b = day.brief(char.id);
  if (!b) return '';

  const lines = [`Today is ${b.date}. In your time zone it is currently ${b.slot.label}.`];
  // 当天的天气预报（排日程时一起查的，见 tasks/day.js）。是预报，不是此刻的实况
  if (b.weather) lines.push(weather.promptLine(b.weather));
  if (b.summary.length) lines.push(...b.summary);

  const now = [];
  if (b.nowItems.length) now.push(`Planned for the current slot: ${b.nowItems.join('；')}。`);
  if (b.meal) now.push(b.meal + '。');
  if (b.event) {
    const tone = events.toneOf(b.event.tone);
    now.push(`One other thing happened today: ${b.event.text}。`);
    if (tone && tone.id !== 'plain') {
      now.push(tone.id === 'good'
        ? 'It left you pleased.'
        : 'It left you out of sorts.');
    }
  }
  if (now.length) lines.push('', ...now);

  const luck = luckLine(b.luck);
  if (luck) lines.push(luck);

  lines.push('',
    'For slots that have not yet arrived, you know what you intend to do, not how'
    + ' it turned out.');

  return `\n\n[你今天]\n${lines.join('\n')}`;
}
