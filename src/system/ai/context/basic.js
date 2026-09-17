// 角色人设 / 用户信息 / 时间情境
import { isAlt } from '../../accounts.js';
import * as clock from '../../time.js';

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
    if (persona.name) bits.push(`昵称：${persona.name}`);
    if (persona.description) bits.push(persona.description.trim());
    let out = bits.length ? `\n\n[对方是谁]\n${bits.join('\n')}` : '';

    // 小号：只说「刚认识」这一个事实，绝口不提大号。
    // 试过详细解释「你认识另一个人但别把他俩联系起来」，反而是在提醒模型去联想。
    // 角色自己的记忆照常带着 —— 就像真人认识新朋友：自己的过去都在，
    // 只是对眼前这个人一片空白。
    if (isAlt(persona.id)) {
      out += '\n\n[你和这个人的关系]\n你们是刚认识的，还不熟。';
    }
    return out;
  },
};

export const time = {
  meta: { id: 'time', label: '时间情境', desc: '现在几点、两边的时差、距上次聊天多久' },
  build({ messages, char }) {
    if (!clock.enabled()) return '';
    const n = clock.now();
    const cz = clock.charZone(char);
    const uz = clock.userZone();
    const lines = [`你那边现在是 ${clock.format(n, cz)}。`];

    // 两人不在一个时区才说时差。同城还唠叨一句反而是噪音。
    const d = clock.zoneDiff(cz, uz, n);
    if (d !== 0) {
      lines.push(`对方在${clock.zoneLabel(uz)}，那边现在是 ${clock.clockOnly(n, uz)}，`
        + `比你${d > 0 ? '晚' : '早'} ${clock.diffText(d)}。想想那个点他在干嘛。`);
    }

    const last = [...(messages || [])].reverse().find(m => m.createdAt);
    if (last) lines.push(clock.gapText(last.createdAt));

    return `\n\n[现在几点]\n${lines.join('\n')}`;
  },
};
