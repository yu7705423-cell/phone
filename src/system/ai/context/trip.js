import * as trip from '../../trip.js';

// 这次出行那一段。
//
// **只在有一次活着的出行时才占位置。** 没有的时候一个字都不写 ——
// 「你们没有出行计划」对模型没有任何用处，只是每轮花掉几十个 token。
//
// 写的是**算得出来的那几个数**：哪一天、还有几天、第几天、几天几夜。
// 日期和天数和距离、点数、金额一样不是模型的活（见 events.js 那一条），
// 算好了摆进去，它不必自己推，也就不会推错。
//
// 票买了没、攒够没不写在这里：那是账本和票那两批的事，各有各的注入段，
// 在这儿再抄一遍就是同一件事交两次（和情侣空间不重复礼物正文同一个理由）。
//
// ---- 进行中的时候，这一段替掉「你今天」 ----
//
// 人在京都，而「你今天」那一段写着「今天要去邮局」—— 那是它在家时排的日程。
// 所以出行期间那一段整个让开（context/day.js 里那一句），今天的安排改由
// 这里给：攻略里排在第几天的那几条。
//
// **已经去过的标出来，不删掉。** 删掉的话它就不知道今天上午已经去过清水寺了，
// 下午还会再提一次。
//
// 一次出行只写一条。同时计划三次旅行是有的，但**眼下要紧的只有一次**
// （trip.currentOf 挑的那一次）；三条一起写进去，模型就开始把三个地方说混。
export const meta = {
  id: 'trip',
  label: '这次出行',
  desc: '眼下这一次出行：去哪儿、什么时候、到哪一步了。没有出行时不占位置',
};

export function build({ chat }) {
  if (!chat) return '';
  const t = trip.context(chat.id);
  if (!t) return '';

  const lines = [];
  const where = [t.place, t.venue].filter(Boolean).join(' ') || t.title;

  if (t.phase === trip.PHASES[trip.TALKING]) {
    lines.push(`The two of you are talking about ${t.kind} to ${where}.`);
    if (!t.agreed) lines.push('It has not been settled yet.');
  } else if (t.phase === trip.PHASES[trip.SOON]) {
    lines.push(`The two of you are going to ${where} on ${t.from}.`);
    if (t.until === 0) lines.push('That is today.');
    else if (t.until != null) lines.push(`That is ${t.until} days from now.`);
    if (t.days > 1) lines.push(`The trip lasts ${t.days} days.`);
  } else {
    lines.push(`The two of you are in ${where} together.`);
    if (t.dayIndex) lines.push(`Today is day ${t.dayIndex} of ${t.days}.`);
    if (t.plan && t.plan.length) {
      lines.push('Planned for today:');
      t.plan.forEach(p => lines.push(`- ${p}`));
    }
  }
  if (t.note) lines.push(t.note);

  return `\n\n[这次出行]\n${lines.join('\n')}`;
}
