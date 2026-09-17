// 粗略 token 估算。只用于预算截断,不追求精确。
export function estimate(text) {
  const s = String(text || '');
  if (!s) return 0;
  const cjk = (s.match(/[　-〿぀-ヿ一-鿿가-힯＀-￯]/g) || []).length;
  return Math.ceil(cjk * 0.9 + (s.length - cjk) * 0.28);
}

// 预算填 0 表示不限，全都要。见 CLAUDE.md 第 13 条。
const capOf = budget => (budget > 0 ? budget : Infinity);

// 按预算从尾部保留(用于对话历史)
export function takeLatestWithin(items, budget, textOf) {
  const cap = capOf(budget);
  const out = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const cost = estimate(textOf(items[i]));
    if (used + cost > cap && out.length) break;
    out.unshift(items[i]);
    used += cost;
  }
  return out;
}

// 按已排好的优先级从头部保留(用于世界书、记忆)
export function takeTopWithin(items, budget, textOf) {
  const cap = capOf(budget);
  const out = [];
  let used = 0;
  for (const it of items) {
    const cost = estimate(textOf(it));
    if (used + cost > cap) continue;
    out.push(it);
    used += cost;
  }
  return { items: out, used };
}
