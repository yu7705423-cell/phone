// 行内译文：自定义形状认得出、不乱认、拆出来收进气泡里。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

const setForms = v => page.evaluate(async ([x]) =>
  (await import('/src/system/db/index.js')).settings.set({ translateFormats: x }), [v]);
const split = t => page.evaluate(async ([x]) =>
  (await import('/src/system/ai/translate.js')).splitInline(x), [t]);
const reply = t => page.evaluate(async ([x]) =>
  (await import('/src/system/ai/reply.js')).splitReply(x)
    .map(p => ({ type: p.type, text: p.text, translation: p.translation || null })), [t]);

// ---- 1 一条都没配时什么都不认 ----
await setForms('');
check(await split('他说（He said）') === null, '没配的时候不拆，也不猜');
let parts = await reply('他说（He said）');
check(parts.length === 1 && parts[0].text === '他说（He said）' && !parts[0].translation,
  '没配时整行照旧当正文');

// ---- 2 原文（译文）----
await setForms('{原文}（{译文}）');
let r = await split('他说（He said）');
check(r && r.text === '他说' && r.translation === 'He said', `全角括号拆对了：${JSON.stringify(r)}`);
check(await split('他笑了（大概吧）') !== null, '正常句子也会被拆 —— 这是这套的代价，不是 bug');
r = await split('他笑了（大概吧）（He smiled）');
check(r && r.text === '他笑了（大概吧）' && r.translation === 'He smiled',
  `两个括号时取最后一个当译文：${JSON.stringify(r)}`);
check(await split('他说') === null, '不带括号的不动');
check(await split('（）') === null, '空括号不算');
check(await split('（He said）') === null, '只有括号没有原文不算');

// ---- 3 竖线、斜杠、方括号 ----
await setForms('{原文}｜{译文}\n{原文} / {译文}\n{原文}【{译文}】');
r = await split('晚安｜Good night');
check(r && r.text === '晚安' && r.translation === 'Good night', `全角竖线：${JSON.stringify(r)}`);
r = await split('晚安 / Good night');
check(r && r.text === '晚安' && r.translation === 'Good night', `斜杠：${JSON.stringify(r)}`);
r = await split('晚安【Good night】');
check(r && r.text === '晚安' && r.translation === 'Good night', `方括号：${JSON.stringify(r)}`);
check(await split('他说（He said）') === null, '没配的那种形状不认');

// ---- 4 半角括号里的正则元字符要被转义 ----
await setForms('{原文}({译文})');
r = await split('他说(He said)');
check(r && r.text === '他说' && r.translation === 'He said', `半角括号（元字符转义对了）：${JSON.stringify(r)}`);
await setForms('{原文} | {译文}');
r = await split('他说 | He said');
check(r && r.text === '他说' && r.translation === 'He said', `半角竖线（元字符转义对了）：${JSON.stringify(r)}`);

// ---- 5 写坏的模板被跳过，不炸 ----
// 三种写坏法：没有任何记号、只有 {原文}、{译文} 写了两次
await setForms('{原文}（{译文}）\n没有记号的一行\n{原文} 只有一个\n{译文}{译文}');
const bad = await page.evaluate(async () => {
  const t = await import('/src/system/ai/translate.js');
  const c = t.compiled();
  return { all: t.formats().length, pairs: c.pairs.length, lines: c.lines.length };
});
check(bad.all === 4 && bad.pairs === 1 && bad.lines === 0,
  `四条里只有一条能用，其余跳过（${JSON.stringify(bad)}）`);
check((await split('他说（He said）'))?.translation === 'He said', '能用的那条照常工作');

// ---- 6 整轮回复里：译文收进气泡，不占一条 ----
await setForms('{原文}（{译文}）');
parts = await reply('他说（He said）\n\n然后走开了（Then he left）');
check(parts.length === 2, `两条消息，译文没有各占一条（${parts.length}）`);
check(parts[0].text === '他说' && parts[0].translation === 'He said'
  && parts[1].text === '然后走开了' && parts[1].translation === 'Then he left',
  `两条都拆对了：${JSON.stringify(parts)}`);

// ---- 7 不能抢在别的标记前面 ----
parts = await reply('[引用：上一句]\n他说（He said）');
check(parts.length === 1 && parts[0].text === '他说' && parts[0].translation === 'He said',
  `引用行仍然是引用，没被当成行内译文吞掉（${JSON.stringify(parts)}）`);
parts = await reply('他说\n[译文：He said]');
check(parts.length === 1 && parts[0].translation === 'He said',
  '单独一行的老写法照旧管用');
parts = await reply('他说\n[心声：其实不想说]');
check(parts.length === 1 && parts[0].text === '他说',
  '心声行没被行内译文抢走');

// ---- 8 设置页 ----
await setForms('');
await page.evaluate(() => import('/src/system/nav.js').then(n => n.openApp('settings', '/translate')));
await page.waitForTimeout(900);
let body = await page.evaluate(() => document.body.innerText);
check(/行内译文的形状/.test(body), '设置页有这一项');
check(/\{原文\}（\{译文\}）/.test(body), '预设按钮在');
check(/试一试/.test(body), '有试一试那一栏');
// 按一下预设，再在试一试里粘一行
await page.evaluate(() => {
  [...document.querySelectorAll('.chip')].find(c => c.innerText.includes('（'))?.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(e => e.placeholder === '他说（He said）');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, '晚安（Good night）');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
body = await page.evaluate(() => document.body.innerText);
check(/原文：晚安/.test(body) && /译文：Good night/.test(body),
  '试一试当场显示拆分结果');
await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(e => e.placeholder === '他说（He said）');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, '一句普通的话');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
check(/不符合上面任何一种形状/.test(await page.evaluate(() => document.body.innerText)),
  '不匹配时也照实说');
// 整行译文那一类，试一试里也要说清楚
await setForms('（{译文}）');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(e => e.placeholder === '他说（He said）');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, '（照片的日期全是乱的）');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
body = await page.evaluate(() => document.body.innerText);
check(/整行为译文：照片的日期全是乱的/.test(body) && /归入上一条消息/.test(body),
  '整行译文那一类，试一试说明了它会归到上一条');

// 写坏一条，页面要点出来
await setForms('{原文}（{译文}）\n乱写的一行');
await page.waitForTimeout(500);
check(/无法识别，已忽略/.test(await page.evaluate(() => document.body.innerText)),
  '写坏的那行在页面上被点出来');

await page.screenshot({ path: `${OUT}/inline-trans.png`, fullPage: true });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
