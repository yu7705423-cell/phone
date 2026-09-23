// 说日语的角色那一轮：時間 认得出、译文各占一行也收得进气泡。
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
const setForms = v => page.evaluate(async ([x]) =>
  (await import('/src/system/db/index.js')).settings.set({ translateFormats: x }), [v]);
const reply = t => page.evaluate(async ([x]) => {
  const r = await import('/src/system/ai/reply.js');
  const parts = r.splitReply(x);
  return { parts: parts.map(p => ({ text: p.text, tr: p.translation || null })) };
}, [t]);

// 用户实际收到的那一轮，原样贴进来
const RAW = `[時間：2026-09-20 周日 04:06]
写真の日付がバラバラなんだよ
（照片的日期全是乱的）
誰が撮ったかも書いてないやつが三十枚くらいある
（还有三十张左右没写谁拍的）
一枚ずつ確認してる
（一张一张在确认）`;

// ---- 1 没配格式时：時間 也该被摘掉（这一条和翻译无关）----
await setForms('');
let r = await reply(RAW);
check(!r.parts.some(p => /時間/.test(p.text)),
  `[時間：…] 被摘掉了，没当正文渲染出去（${JSON.stringify(r.parts[0])}）`);
const stamp = await page.evaluate(async ([x]) => {
  const raw = (await import('/src/system/ai/reply.js'));
  // splitReply 里摘下来的时刻拿不到，这里单独验一下正则
  return /^[[【(（]?\s*(?:时间|時間|time)\s*[:：]/.test('[時間：2026-09-20 周日 04:06]');
}, [RAW]);
check(stamp, '時間 这个写法在标签里认得出');
check(r.parts.length === 6, `没配格式时是 6 条（原文译文各占一条）：${r.parts.length}`);

// ---- 2 配上「译文单独成行」----
await setForms('（{译文}）');
r = await reply(RAW);
check(r.parts.length === 3, `配上之后合成 3 条：${r.parts.length}`);
check(r.parts[0].text === '写真の日付がバラバラなんだよ'
  && r.parts[0].tr === '照片的日期全是乱的', `第一条对了：${JSON.stringify(r.parts[0])}`);
check(r.parts[2].text === '一枚ずつ確認してる'
  && r.parts[2].tr === '一张一张在确认', `最后一条对了：${JSON.stringify(r.parts[2])}`);
check(r.parts.every(p => p.tr), '三条都带上了译文');

// ---- 3 没有原文在前的那种，不乱挂 ----
r = await reply('（孤零零一句译文）');
check(r.parts.length === 0, '开头就是一行译文时丢掉，不凭空造一条消息');

// ---- 4 同一行那一类照旧 ----
await setForms('{原文}（{译文}）');
r = await reply('他说（He said）');
check(r.parts.length === 1 && r.parts[0].text === '他说' && r.parts[0].tr === 'He said',
  '同一行那一类没受影响');
r = await reply(RAW);
check(r.parts.length === 6, '只配了同一行那类时，各占一行的那种仍然不认（不越权）');

// ---- 5 两类一起配 ----
await setForms('{原文}（{译文}）\n（{译文}）');
r = await reply(RAW);
check(r.parts.length === 3 && r.parts[0].tr === '照片的日期全是乱的', '两类一起配也对');
r = await reply('他说（He said）');
check(r.parts.length === 1 && r.parts[0].tr === 'He said', '同时同一行那类照样管用');

// ---- 6 只有 {原文} 的模板不认 ----
const kinds = await page.evaluate(async () => {
  const t = await import('/src/system/ai/translate.js');
  return {
    onlySrc: t.compileFormat('{原文}（）'),
    pair: t.compileFormat('{原文}（{译文}）')?.kind,
    line: t.compileFormat('（{译文}）')?.kind,
    reversed: t.compileFormat('{译文}（{原文}）'),
  };
});
check(kinds.onlySrc === null, '只有 {原文} 的不认（那等于什么都没说）');
check(kinds.pair === 'pair' && kinds.line === 'line', '两类各自认得出');
check(kinds.reversed === null, '记号反过来写的不认');

// ---- 7 内置那条 [译文：…] 照旧 ----
await setForms('');
r = await reply('他说\n[译文：He said]');
check(r.parts.length === 1 && r.parts[0].tr === 'He said', '内置的带标签写法照旧管用');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
