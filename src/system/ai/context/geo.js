import * as geo from '../../geo.js';

// 「你们隔多远」那一句。
//
// 这一段存在的唯一理由是**那个数字不能让模型编**。问它两地多远，
// 它会给一个听起来很像的数，而且每次都不一样。所以距离在本地按
// haversine 算好，连同单位一起写进去，再明说一句别改。
//
// 和点数、金额、时间一样：数字不是模型的活。
export const meta = {
  id: 'geo',
  label: '两人距离',
  desc: '双方位置与算好的直线距离。需在会话的「共享位置」中开启',
};

export function build({ chat }) {
  if (!chat) return '';
  const s = geo.summary(chat.id);
  if (!s) return '';

  const lines = [];
  const mine = s.me.place || '未命名的地点';
  const hers = s.char.place || '未命名的地点';
  lines.push(`对方在${mine}，你在${hers}。`);
  if (s.text) {
    lines.push(`两地直线距离 ${s.text}。`);
    lines.push('该距离由系统计算得出。提及距离时照此书写，不要改写为其他数值，也不要自行估算。');
  } else {
    lines.push('当前只有地名，没有坐标，无法得出具体距离。不要给出一个具体数值。');
  }
  return `\n\n[你们隔多远]\n${lines.join('\n')}`;
}
