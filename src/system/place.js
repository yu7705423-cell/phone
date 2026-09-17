import { messages, chats } from './db/index.js';

// 位置。发出去的是一个**虚拟定位** —— 不读设备的 GPS，也不查任何地图接口，
// 就是一个地点名加一行地址。这个项目里的定位本来就是演出来的：
// 用户想说自己在哪儿，角色想说自己在哪儿，双方都只需要这两行字。
//
// 真去接定位反而不对：用户的真实坐标不该为了一句台词交出去，
// 角色那边更是压根没有坐标可言。

export function content(place, address) {
  const p = String(place || '').trim();
  const a = String(address || '').trim();
  return `[位置：${p}${a ? ' ' + a : ''}]`;
}

// 模型写的那一行拆成两段：第一个空白之前是地点名，后面是地址。
// 中文地名里一般没有空格，所以整行没空白就当成只写了地点名。
export function parse(body) {
  const t = String(body || '').trim();
  if (!t) return null;
  const i = t.search(/[\s　]/);
  return i < 0
    ? { place: t, address: '' }
    : { place: t.slice(0, i).trim(), address: t.slice(i).trim() };
}

export function send({ chatId, role, authorId, place, address = '', extra = {} }) {
  const p = String(place || '').trim().slice(0, 40);
  if (!p) throw new Error('请填写地点名称');
  const a = String(address || '').trim().slice(0, 80);
  const msg = messages.create({
    chatId, role, authorId, kind: 'location',
    place: p, address: a, content: content(p, a),
    status: 'done', ...extra,
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}
