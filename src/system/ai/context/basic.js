// 角色人设 / 用户信息 / 时间情境
import { rootOf, isAlt } from '../../accounts.js';

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

    // 小号：角色还是那个角色，记得大号那边发生过的事，
    // 但眼前这个人对它来说是个陌生人，不能表现得像早就认识。
    if (isAlt(persona.id)) {
      const main = rootOf(persona.id);
      out += `\n\n[你和这个人的关系]\n你不认识${persona.name || '这个人'}，这是第一次说上话。`
        + `\n你自己的经历、性格、记得的事都还在 —— 包括你和${main?.name || '另一个人'}之间发生过的一切。`
        + `\n但你没有任何理由把眼前这个人和${main?.name || '那个人'}联系起来。`
        + `\n记忆里标着「关于某某」的条目说的是别人，不是眼前这个人，别张口就提。`
        + `\n像对一个陌生人那样说话：有分寸、有距离，该有的好奇也有。`;
    }
    return out;
  },
};

export const time = {
  meta: { id: 'time', label: '时间情境', desc: '现在几点、距上次聊天多久' },
  build({ settings, messages }) {
    if (settings.injectTime === false) return '';
    const now = new Date();
    const weekday = '日一二三四五六'[now.getDay()];
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    let gap = '';
    const last = [...(messages || [])].reverse().find(m => m.createdAt);
    if (last) {
      const min = Math.floor((Date.now() - last.createdAt) / 60000);
      if (min < 1) gap = '你们刚刚还在聊。';
      else if (min < 60) gap = `距离你们上次聊天过去了${min}分钟。`;
      else if (min < 1440) gap = `距离你们上次聊天过去了${Math.floor(min / 60)}小时。`;
      else gap = `距离你们上次聊天过去了${Math.floor(min / 1440)}天。`;
    }
    return `\n\n现在是星期${weekday} ${hh}:${mm}。${gap ? '\n' + gap : ''}`;
  },
};
