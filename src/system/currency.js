import { settings } from './db/index.js';

// 货币。只影响显示和角色写金额时的量级，不做任何汇率换算 ——
// 一段对话里两个人用的是同一种钱，换算没有意义。
//
// 小数位是跟着币种走的：日元韩元本来就不写小数，写成 88.00 一眼就假。
export const LIST = [
  { code: 'CNY', symbol: '¥',   name: '人民币',   digits: 2 },
  { code: 'USD', symbol: '$',   name: '美元',     digits: 2 },
  { code: 'EUR', symbol: '€',   name: '欧元',     digits: 2 },
  { code: 'GBP', symbol: '£',   name: '英镑',     digits: 2 },
  { code: 'JPY', symbol: '¥',   name: '日元',     digits: 0 },
  { code: 'KRW', symbol: '₩',   name: '韩元',     digits: 0 },
  { code: 'HKD', symbol: 'HK$', name: '港币',     digits: 2 },
  { code: 'TWD', symbol: 'NT$', name: '新台币',   digits: 2 },
  { code: 'SGD', symbol: 'S$',  name: '新加坡元', digits: 2 },
  { code: 'RUB', symbol: '₽',   name: '卢布',     digits: 2 },
  { code: 'none', symbol: '',   name: '不显示符号', digits: 2 },
];

const DEFAULT = LIST[0];

export function get(code = settings.get().currency) {
  return LIST.find(c => c.code === code) || DEFAULT;
}
export function current() { return get(); }
export function set(code) { settings.set({ currency: get(code).code }); }

export function digits(code) { return get(code).digits; }

// 落库前把金额收到这个币种该有的位数上。
// 日元不留小数，人民币留两位 —— 这一步在存之前做，
// 不然界面上四舍五入过的数字和库里那个对不上。
export function round(n, code) {
  const p = 10 ** digits(code);
  const v = Math.round(Number(n) * p) / p;
  return Number.isFinite(v) ? v : 0;
}

export function format(n, code) { return round(n, code).toFixed(digits(code)); }

// 带符号的写法，只用于界面。上下文里给模型看的一律是纯数字，
// 省得它把符号当成金额的一部分再抄回来。
//
// code 是那条转账**当时**用的币种。换了设置不该把已经发出去的钱改成另一种 ——
// 那笔钱是按当时那个币种谈的，改了显示等于事后篡改。
export function display(n, code) {
  const c = get(code);
  return c.symbol ? `${c.symbol}${format(n, c.code)}` : format(n, c.code);
}

// 写进 prompt 的那一句：告诉角色这段对话用的是什么钱
export function label() {
  const c = current();
  return c.code === 'none' ? '' : `${c.name}（${c.symbol || c.code}）`;
}
