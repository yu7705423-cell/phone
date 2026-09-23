// 「明天七点」怎么折算成绝对时刻。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

// 基准固定成 2026-09-20（周日）10:00，好算
const got = await page.evaluate(async () => {
  const w = await import('/src/system/when.js');
  const now = new Date(2026, 8, 20, 10, 0, 0).getTime();   // 周日 10:00
  const f = s => {
    const r = w.parse(s, { now });
    if (!r) return null;
    const d = new Date(r.at);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}${r.hasTime ? '' : ' [无时刻]'}`;
  };
  const cases = ['明天七点', '明天早上七点', '明天下午三点', '明天晚上八点半',
    '后天', '大后天中午', '今天下午五点', '七点', '下午两点', '晚上十一点',
    '周四', '周日', '下周三上午十点', '三天后晚上九点', '9月30号八点',
    '2026-10-01 07:30', '19:45', '明天七点一刻', '八点五分', '凌晨三点',
    '中午十二点', '明天', '五天后', '下礼拜二下午',
    '今天天气不错', '我想你了', ''];
  const out = {};
  for (const c of cases) out[c || '(空)'] = f(c);
  out['_num'] = [w.cnNum('十九'), w.cnNum('二十三'), w.cnNum('七'), w.cnNum('十'), w.cnNum('二十')];
  out['_show'] = [w.show(new Date(2026, 8, 21, 7, 0).getTime(), now),
    w.show(new Date(2026, 8, 20, 18, 30).getTime(), now),
    w.show(new Date(2026, 9, 5, 9, 0).getTime(), now)];
  return out;
});

const want = {
  '明天七点': '2026-09-21 07:00',
  '明天早上七点': '2026-09-21 07:00',
  '明天下午三点': '2026-09-21 15:00',
  '明天晚上八点半': '2026-09-21 20:30',
  '后天': '2026-09-22 00:00 [无时刻]',
  '大后天中午': '2026-09-23 12:00',
  '今天下午五点': '2026-09-20 17:00',
  '七点': '2026-09-21 07:00',          // 今天 7 点已过 -> 明天
  '下午两点': '2026-09-20 14:00',      // 今天还没到
  '晚上十一点': '2026-09-20 23:00',
  '周四': '2026-09-24 00:00 [无时刻]', // 周日往后数到周四
  '周日': '2026-09-27 00:00 [无时刻]', // 今天就是周日 -> 下一个
  '下周三上午十点': '2026-09-30 10:00',
  '三天后晚上九点': '2026-09-23 21:00',
  '9月30号八点': '2026-09-30 08:00',
  '2026-10-01 07:30': '2026-10-01 07:30',
  '19:45': '2026-09-20 19:45',
  '明天七点一刻': '2026-09-21 07:15',
  '八点五分': '2026-09-21 08:05',      // 今天 8:05 已过
  '凌晨三点': '2026-09-21 03:00',
  '中午十二点': '2026-09-20 12:00',
  '明天': '2026-09-21 00:00 [无时刻]',
  '五天后': '2026-09-25 00:00 [无时刻]',
  '下礼拜二下午': '2026-09-29 15:00',
};
for (const [k, v] of Object.entries(want)) {
  check(got[k] === v, `${k} -> ${got[k]}${got[k] === v ? '' : `（要 ${v}）`}`);
}
// 「今天天气不错」里确实有「今天」，解析器如实报它 —— 但 hasTime 是假，
// 自动挂时刻那条路只认 hasTime 为真的，所以它不会变成一个闹钟
check(/无时刻/.test(got['今天天气不错'] || ''),
  `顺口说的「今天」只报日子、不报时刻（${got['今天天气不错']}）`);
check(got['我想你了'] === null, `「我想你了」不认（${got['我想你了']}）`);
check(got['(空)'] === null, '空的不认');
check(JSON.stringify(got._num) === JSON.stringify([19, 23, 7, 10, 20]), `中文数字（${got._num}）`);
check(JSON.stringify(got._show) === JSON.stringify(['明天 07:00', '今天 18:30', '2026-10-05 09:00']),
  `回显（${JSON.stringify(got._show)}）`);

// ---- 接到待办上：说了点钟的才挂时刻 ----
const wired = await page.evaluate(async () => {
  const t = await import('/src/system/todo.js');
  const db = await import('/src/system/db/index.js');
  const w = await import('/src/system/when.js');
  const mk = (text, chat) => {
    const r = t.propose({ text, chatId: chat, from: t.FROM_LOCAL });
    return r ? { text: r.text, at: r.remindAt } : null;
  };
  const a = mk('我想明天七点去跑步', 'c1');
  const b = mk('我想说今天天气不错', 'c2');
  const c = mk('我要买牛奶', 'c3');
  const soon = new Date(Date.now() + 3 * 3600000);
  const p2 = n => String(n).padStart(2, '0');
  const d = mk(`我要${p2(soon.getHours())}点去取快递`, 'c4');
  return {
    withTime: a && a.at > Date.now(),
    dayOnly: b && b.at === 0,
    none: c && c.at === 0,
    soonOk: d && d.at > Date.now(),
    shown: a ? w.show(a.at) : '',
  };
});
check(wired.withTime, `「我想明天七点去跑步」挂上了时刻（${wired.shown}）`);
check(wired.dayOnly, '「今天天气不错」只有日子，不挂时刻');
check(wired.none, '一个时间词都没有的不挂');
check(wired.soonOk, '几小时之后那种也挂得上');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
