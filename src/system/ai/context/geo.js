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
  const mine = s.me.place || 'an unnamed place';
  const hers = s.char.place || 'an unnamed place';
  lines.push(`The other party is at ${mine}; you are at ${hers}.`);
  if (s.text) {
    lines.push(`The straight-line distance between the two is ${s.text}.`);
    lines.push('This distance was computed by the system. Write it exactly as given'
      + ' when the distance comes up. Do not substitute another figure, and do not'
      + ' estimate one yourself.');
  } else {
    lines.push('Only place names are available, without coordinates, so no distance'
      + ' can be determined. Do not state a specific figure.');
  }
  return `\n\n[你们隔多远]\n${lines.join('\n')}`;
}
