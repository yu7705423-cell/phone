// 时间戳：整行的、粘在句子前面的、粘在后面的、夹在中间的，都得摘干净。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
const split = raw => page.evaluate(async ([x]) => {
  const r = await import('/src/system/ai/reply.js');
  const parts = r.splitReply(x);
  return { texts: parts.map(p => p.text), stamp: parts[0]?.stamp || '' };
}, [raw]);

// ---- 整行（原来就能的，不能退化）----
let r = await split('[时间：2026-01-01 周三 14:30]\n你好');
check(JSON.stringify(r.texts) === JSON.stringify(['你好']) && r.stamp === '2026-01-01 周三 14:30',
  `整行的照旧摘得掉：${JSON.stringify(r)}`);
r = await split('[2026-01-01 周三 14:30]\n你好');
check(r.texts.length === 1 && r.stamp === '2026-01-01 周三 14:30', '整行、没有标签的也照旧');

// ---- 粘在第一句前面（用户撞见的那种）----
r = await split('[時間：2026-09-20 周日 04:06]写真の日付がバラバラなんだよ');
check(JSON.stringify(r.texts) === JSON.stringify(['写真の日付がバラバラなんだよ']),
  `粘在句子前面也摘得掉：${JSON.stringify(r.texts)}`);
check(r.stamp === '2026-09-20 周日 04:06', `时刻记下来了：${r.stamp}`);

r = await split('【时间：14:30】今天天气不错');
check(JSON.stringify(r.texts) === JSON.stringify(['今天天气不错']), '全角方括号也认');
r = await split('（时间：14:30）今天天气不错');
check(JSON.stringify(r.texts) === JSON.stringify(['今天天气不错']), '带标签时圆括号也认');
r = await split('[14:30]今天天气不错');
check(JSON.stringify(r.texts) === JSON.stringify(['今天天气不错']), '没标签的方括号也认');

// ---- 粘在后面、夹在中间 ----
r = await split('今天天气不错[时间：14:30]');
check(JSON.stringify(r.texts) === JSON.stringify(['今天天气不错']), '粘在句子后面也摘');
r = await split('我刚[时间：14:30]到家');
check(JSON.stringify(r.texts) === JSON.stringify(['我刚到家']), '夹在中间也摘');

// ---- 一轮里写了好几个：只记第一个，全都摘掉 ----
r = await split('[时间：14:30]到家了\n[时间：14:31]在吃饭');
check(JSON.stringify(r.texts) === JSON.stringify(['到家了', '在吃饭']), '每条都写了也全摘掉');
check(r.stamp === '14:30', `只记第一个：${r.stamp}`);

// ---- 不该摘的别摘 ----
r = await split('（14:30）我是这么说的');
check(/14:30/.test(r.texts[0]), '光秃秃的圆括号不摘（正文里人也会这么写）');
r = await split('[时间：等一下再说]好的');
check(/等一下再说/.test(r.texts.join('')), '带标签但不像时刻的留着，那是它说的话');
r = await split('那是[1998]年的事');
check(/1998/.test(r.texts[0]), '光一个年份不算时刻');
r = await split('[引用：上一句]\n我说的');
check(r.texts.length === 1 && r.texts[0] === '我说的', '引用标记没被当成时刻吃掉');
r = await split('[图片：一只猫]');
check(await page.evaluate(async ([x]) =>
  (await import('/src/system/ai/reply.js')).splitReply(x)[0]?.type, ['[图片：一只猫]']) === 'image',
  '图片标记没被当成时刻吃掉');

// ---- 日文那一轮，完整跑一遍 ----
await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.set({ translateFormats: '（{译文}）' }));
r = await split(`[時間：2026-09-20 周日 04:06]写真の日付がバラバラなんだよ
（照片的日期全是乱的）
誰が撮ったかも書いてないやつが三十枚くらいある
（还有三十张左右没写谁拍的）`);
check(r.texts.length === 2 && r.texts[0] === '写真の日付がバラバラなんだよ',
  `日文那一轮：两条，时间戳没混进第一句（${JSON.stringify(r.texts)}）`);
const trs = await page.evaluate(async ([x]) =>
  (await import('/src/system/ai/reply.js')).splitReply(x).map(p => p.translation), [`[時間：2026-09-20 周日 04:06]写真の日付がバラバラなんだよ
（照片的日期全是乱的）
誰が撮ったかも書いてないやつが三十枚くらいある
（还有三十张左右没写谁拍的）`]);
check(trs[0] === '照片的日期全是乱的' && trs[1] === '还有三十张左右没写谁拍的',
  `译文照样收进气泡：${JSON.stringify(trs)}`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
