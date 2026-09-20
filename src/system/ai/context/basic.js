// 角色人设 / 用户信息 / 时间情境
import { isAlt } from '../../accounts.js';
import * as clock from '../../time.js';
import * as trip from '../../trip.js';

export const character = {
  meta: { id: 'character', label: '角色人设', desc: '角色卡里写的设定' },
  build({ char }) {
    if (!char) return '';
    let out = '';
    if (char.persona) out += `\n\n[你是谁]\n${char.persona.trim()}`;
    if (char.scenario) out += `\n\n[当前情境]\n${char.scenario.trim()}`;
    if (char.exampleDialogue) out += `\n\n[你的说话方式示例]\n${char.exampleDialogue.trim()}`;
    return out;
  },
};

export const user = {
  meta: { id: 'user', label: '用户信息', desc: '我的昵称与人设；小号会额外说明关系' },
  build({ persona }) {
    if (!persona) return '';
    const bits = [];
    if (persona.name) bits.push(`Name: ${persona.name}`);
    if (persona.description) bits.push(persona.description.trim());
    let out = bits.length ? `\n\n[对方是谁]\n${bits.join('\n')}` : '';

    // 小号：只说「刚认识」这一个事实，绝口不提大号。
    // 试过详细解释「你认识另一个人但别把他俩联系起来」，反而是在提醒模型去联想。
    // 角色自己的记忆照常带着 —— 就像真人认识新朋友：自己的过去都在，
    // 只是对眼前这个人一片空白。
    if (isAlt(persona.id)) {
      out += '\n\n[你和这个人的关系]\nYou have only just met. You do not know each other well.';
    }
    return out;
  },
};

// 距上次说话多久，要量到**上一轮结束**为止。
// 直接拿最后一条消息算的话，那一条往往就是用户刚发出的这一句，
// 于是永远是「刚刚还在聊」，哪怕两个人三天没说过话。
function lastBeforeThisTurn(messages) {
  const list = (messages || []).filter(m => m.createdAt);
  let i = list.length;
  while (i > 0 && list[i - 1].role === 'user') i--;
  return list[i - 1] || null;
}

export const time = {
  meta: { id: 'time', label: '时间情境', desc: '现在几点、两边的时差、距上次说话多久' },
  build({ messages, char }) {
    if (!clock.enabled()) return '';
    const n = clock.now();
    const cz = clock.charZone(char);
    // **一起出行的时候两个人在同一个地方，没有时差。** 用户这一头没有
    // 「所在地」这个概念，它跟的是设备时区；出行期间照那个算，会算出
    // 一个并不存在的时差，然后模型一本正经地说「你那边现在是半夜」。
    const away = trip.zoneAway(char);
    const uz = away || clock.userZone();
    // 角色**明确设过时区**才写地名。没设过时它跟的是你的设备时区，
    // 照着写就成了「你在中国」——一个日本角色会照这句话认下来。
    // 只给钟点，不替它认领一个地方。
    const named = !!(char && char.timezone);
    const lines = [named
      ? `You are in ${clock.zoneLabel(cz)}. It is now ${clock.format(n, cz)}.`
      : `It is now ${clock.format(n, cz)}.`];

    // 两人不在一个时区才说时差。同城还唠叨一句反而是噪音。
    //
    // 不用「早」「晚」：这两个字在中文里既能指时区的前后，也能指钟面上的
    // 先后，两种读法方向正好相反。两边的钟点都写出来，方向自明。
    const d = clock.zoneDiff(cz, uz, n);
    if (d !== 0) {
      lines.push(`The other party is in ${clock.zoneLabel(uz)}, where it is now `
        + `${clock.clockOnly(n, uz)}, ${clock.diffText(d)} from your own clock.`);
    }

    const last = lastBeforeThisTurn(messages);
    if (last) lines.push(clock.gapText(last.createdAt));

    return `\n\n[现在几点]\n${lines.join('\n')}`;
  },
};
