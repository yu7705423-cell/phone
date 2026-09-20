/**
 * 把「明天七点」这种话算成一个时刻。
 *
 * 人不会说「二〇二六年九月三十日七时整」。聊天里说的永远是「明天七点」
 * 「后天早上」「周四下午三点半」—— 相对的、省略的、带时段词的。
 * 待办从对话里来，那一头就是这种话，所以这一层负责把它折算成绝对时刻。
 *
 * ---- 按真实时间算，不按对话里的时间 ----
 *
 * 时间感知那一套（system/time.js）可以把对话固定在某个时刻，甚至停在
 * 某一夜不再推进。但**闹钟要在真实世界里响**：把「明天七点」按一个停住的
 * 故事时间去折算，算出来的是一个永远不会到的时刻，或者早就过去的时刻。
 * 所以这里一律拿真实的现在当基准。界面上写清楚这一条。
 *
 * ---- 认不出来就说认不出来 ----
 *
 * 宁可回 null，也不要猜一个时刻出来。一个猜错的闹钟比没有闹钟糟：
 * 没有闹钟你知道自己得记着，猜错的那个让你以为有人替你记着。
 */

// 中文数字。到二十四够用了 —— 再大的数不会用汉字说时刻
const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  七: 7, 八: 8, 九: 9, 十: 10 };

/** 「十九」「二十三」「七」都认。认不出来返回 NaN。 */
export function cnNum(text) {
  const t = String(text || '').trim();
  if (!t) return NaN;
  if (/^\d+$/.test(t)) return Number(t);
  if (!/^[零〇一二两三四五六七八九十]+$/.test(t)) return NaN;
  // 十 / 十三 / 二十 / 二十三
  const at = t.indexOf('十');
  if (at < 0) {
    let n = 0;
    for (const ch of t) { const d = DIGIT[ch]; if (d === undefined) return NaN; n = n * 10 + d; }
    return n;
  }
  const high = at === 0 ? 1 : DIGIT[t.slice(0, at)];
  const low = at === t.length - 1 ? 0 : DIGIT[t.slice(at + 1)];
  if (high === undefined || low === undefined) return NaN;
  return high * 10 + low;
}

const NUM = '[0-9零〇一二两三四五六七八九十]+';

// 时段词。给的是「这个词覆盖哪几个钟头」与「省略数字时默认几点」。
//
// 它只用来把十二小时制的数字挪到正确的那一半：「下午三点」是 15 点。
// 不拿它替用户决定「早上」是几点起 —— 只有一个字都没说数字时才用默认值。
const SPANS = [
  { re: /凌晨|半夜|夜里/, from: 0, to: 5, fallback: 3 },
  { re: /早上|早晨|清晨|上午|今早|明早/, from: 6, to: 11, fallback: 8 },
  { re: /中午|正午|午间/, from: 11, to: 13, fallback: 12 },
  { re: /下午|午后/, from: 13, to: 18, fallback: 15 },
  { re: /傍晚|黄昏/, from: 17, to: 19, fallback: 18 },
  { re: /晚上|夜晚|今晚|明晚|后晚/, from: 18, to: 23, fallback: 20 },
];

const WEEK = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * 认哪一天。回来的是当天零点，外加认出来的那一段文字。
 * 一个字都没提到日子就回 null —— 由调用方决定按「今天」还是不算数。
 */
function whichDay(text, now) {
  const base = startOfDay(now);
  const plus = n => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);

  // 具体日期：9月30日 / 9-30 / 2026-09-30
  let m = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(text);
  if (m) return { day: new Date(+m[1], +m[2] - 1, +m[3]), hit: m[0] };
  m = /(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*[日号]?/.exec(text);
  if (m) {
    const month = +m[1] - 1;
    let year = base.getFullYear();
    // 说的月份已经过去了，就是明年那一次
    if (month < base.getMonth()) year += 1;
    return { day: new Date(year, month, +m[2]), hit: m[0] };
  }

  m = new RegExp(`(${NUM})\\s*天(?:之)?后`).exec(text);
  if (m) { const n = cnNum(m[1]); if (Number.isFinite(n)) return { day: plus(n), hit: m[0] }; }

  if (/大后天/.test(text)) return { day: plus(3), hit: '大后天' };
  if (/后天|后晚/.test(text)) return { day: plus(2), hit: '后天' };
  if (/明天|明早|明晚|明日/.test(text)) return { day: plus(1), hit: '明天' };
  if (/今天|今早|今晚|今夜|今日/.test(text)) return { day: base, hit: '今天' };

  // 周四 / 下周四 / 这周四 / 下礼拜二
  m = /(下下|下|这|本)?\s*(?:周|星期|礼拜)\s*([日天一二三四五六])/.exec(text);
  if (m) {
    const want = WEEK[m[2]];
    const cur = base.getDay();
    let add = (want - cur + 7) % 7;
    // 不带「下」的「周四」指的是这一周里还没到的那个；已经过了就是下一周
    if (!m[1] || m[1] === '这' || m[1] === '本') { if (add === 0) add = 7; }
    else if (m[1] === '下') add += 7;
    else add += 14;
    return { day: plus(add), hit: m[0] };
  }
  return null;
}

/** 认几点几分。认不出小时就回 null。 */
function whichTime(text) {
  // 7:30 / 19:05
  let m = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(text);
  if (m) return { hour: +m[1], min: +m[2], hit: m[0], explicit: true };

  // 七点 / 7点半 / 十九点一刻 / 八点五分
  m = new RegExp(`(${NUM})\\s*[点時时]\\s*(半|一刻|三刻|(?:${NUM})\\s*分?)?`).exec(text);
  if (m) {
    const hour = cnNum(m[1]);
    if (!Number.isFinite(hour)) return null;
    let min = 0;
    const tail = (m[2] || '').trim();
    if (tail === '半') min = 30;
    else if (tail === '一刻') min = 15;
    else if (tail === '三刻') min = 45;
    else if (tail) { const n = cnNum(tail.replace(/分$/, '')); if (Number.isFinite(n)) min = n; }
    return { hour, min, hit: m[0], explicit: true };
  }
  return null;
}

/**
 * 主入口。回来的是：
 *
 *   at        绝对时刻（毫秒）。只说了日子没说点钟时，是那天零点
 *   hasTime   有没有说到点钟。没有就不该拿去排闹钟 —— 闹钟要一个准确时刻
 *   hit       认出来的那一段原文，界面上回显给用户看，让他判断认对没有
 *
 * 一个字都认不出来回 null。
 */
export function parse(text, { now = Date.now() } = {}) {
  const src = String(text || '');
  if (!src.trim()) return null;
  const base = new Date(now);

  const day = whichDay(src, base);
  const time = whichTime(src);
  const span = SPANS.find(s => s.re.test(src)) || null;

  if (!day && !time && !span) return null;

  let hour = time ? time.hour : (span ? span.fallback : 0);
  const min = time ? time.min : 0;

  // 十二小时制归位：「下午三点」是 15 点。说了 15 点就不再加，
  // 说了「下午十二点」按 12 点算（12 加 12 是第二天零点，那不是他的意思）
  if (span && time && hour < 12 && hour + 12 <= span.to && hour < span.from) hour += 12;
  // 「晚上十一点」这种：加 12 超出去了，但本来就落在时段里，不动
  if (hour > 23 || hour < 0) return null;

  let at = day ? new Date(day.day) : startOfDay(base);
  at.setHours(hour, min, 0, 0);

  // 只说了点钟没说哪天，而那个点钟今天已经过去了 —— 说的是明天。
  // 「七点」在晚上八点说出口，没有人是指十三小时之前
  if (!day && at.getTime() <= now) at = new Date(at.getTime() + 86400000);

  const hit = [day?.hit, span && !time ? src.match(span.re)?.[0] : '', time?.hit]
    .filter(Boolean).join('');
  return { at: at.getTime(), hasTime: !!(time || span), hit };
}

const p2 = n => String(n).padStart(2, '0');

/** 折算出来的时刻写成人看的样子，回显在输入框下面。 */
export function show(ms, now = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = startOfDay(new Date(now));
  const days = Math.round((startOfDay(d) - today) / 86400000);
  const day = days === 0 ? '今天' : days === 1 ? '明天' : days === 2 ? '后天'
    : days === -1 ? '昨天'
      : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return `${day} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
