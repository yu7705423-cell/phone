// 角色人设 / 用户信息 / 时间情境

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
  meta: { id: 'user', label: '用户信息', desc: '我的昵称与人设' },
  build({ persona }) {
    if (!persona) return '';
    const bits = [];
    if (persona.name) bits.push(`昵称：${persona.name}`);
    if (persona.description) bits.push(persona.description.trim());
    return bits.length ? `\n\n[对方是谁]\n${bits.join('\n')}` : '';
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
