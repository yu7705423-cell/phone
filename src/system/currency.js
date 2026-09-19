import { settings } from './db/index.js';

// 货币。币种影响显示和角色写金额时的量级。
//
// 一段对话里两个人用的是同一种钱，所以**存进去的一律是这段对话的币种**。
// 换算只发生在输入那一步：你习惯按人民币想，对方那边记的是日元，
// 于是填人民币、按汇率折过去，落库的是折算之后的数。
//
// 汇率**自己填**，不联网去取。取汇率要么要接口要么要爬页面，
// 都得联网、都会失败，而这件事本来不需要联网 —— 你心里那个数才是你要用的数。
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


// ---- 汇率 ----
//
// 一对币种一个数：`rates['CNY>JPY'] = 20.5` 表示 1 人民币折 20.5 日元。
// 反向不单独存，取的时候取倒数 —— 两个方向分开存，改了一边忘了另一边，
// 折出来的数就对不上。

const pairKey = (from, to) => `${get(from).code}>${get(to).code}`;

const table = () => settings.get().rates || {};

/** 1 单位 from 折多少 to。没填过返回 null，界面据此提示去填。 */
export function rateOf(from, to) {
  const a = get(from).code;
  const b = get(to).code;
  if (a === b) return 1;
  const t = table();
  const direct = Number(t[pairKey(a, b)]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const back = Number(t[pairKey(b, a)]);
  if (Number.isFinite(back) && back > 0) return 1 / back;
  return null;
}

export function setRate(from, to, v) {
  const n = Number(v);
  const a = get(from).code;
  const b = get(to).code;
  if (a === b) return;
  const next = { ...table() };
  const key = pairKey(a, b);
  if (Number.isFinite(n) && n > 0) {
    next[key] = n;
    delete next[pairKey(b, a)];   // 只留一个方向，免得两边打架
  } else {
    delete next[key];
  }
  settings.set({ rates: next });
}

/** 按汇率折过去，并收到目标币种该有的小数位上。填了汇率才算得出来。 */
export function convert(n, from, to) {
  const r = rateOf(from, to);
  if (r === null) return null;
  const v = Number(n) * r;
  return Number.isFinite(v) ? round(v, to) : null;
}

/** 填过汇率的那几对，设置里列出来。 */
export const pairs = () => Object.entries(table())
  .filter(([, v]) => Number(v) > 0)
  .map(([k, v]) => {
    const [from, to] = k.split('>');
    return { key: k, from, to, rate: Number(v),
      fromName: get(from).name, toName: get(to).name };
  });

export const dropRate = key => {
  const next = { ...table() };
  delete next[key];
  settings.set({ rates: next });
};
