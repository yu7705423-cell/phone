// 去重用的形。标点、空白、大小写都抹掉 —— 「今天下雨了」和「今天下雨了。」是同一条。
// 事件库和食谱库都靠它比对，两边必须是同一个定义，否则同一句话在一边算重在另一边不算。
export function normalize(text) {
  return String(text || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}
