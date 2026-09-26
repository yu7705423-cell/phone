// 译文配到哪一条（ARCHITECTURE 4.275）：交替着写时配紧挨着的那一条，攒在末尾时按顺序配
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const page = await browser.newPage();
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const r = await page.evaluate(async () => {
  const rp = await import('/src/system/ai/reply.js');
  const view = raw => rp.splitReply(raw).filter(p => p.type === 'text').map(p => [p.text, p.translation || '']);
  // 用户贴来的那一轮：头两条正文共用一条译文
  const inter = `……。
誰これ。
[译文：……这谁。]
夜中に由に話しかけてくるやつがいるのか。
[译文：半夜有人给由发消息？]
[表情：（凑近）（盯）看你：]
しかも群で由の写真見て加えたって。
[译文：而且说是在群里看到由发的图才加的。]
「小心眼の彼氏」って何。
[译文："小心眼的男朋友"是什么。]`;
  // 攒在末尾一起写的那种
  const batched = `一。
二。
三。
[译文：one.]
[译文：two.]
[译文：three.]`;
  // 译文写在原文上面
  const above = `[译文：hello.]
你好。`;
  return { inter: view(inter), batched: view(batched), above: view(above) };
});

ok('交替着写：译文配紧挨着的那一条，后面不错位',
  r.inter[1][0] === '誰これ。' && r.inter[1][1] === '……这谁。'
  && r.inter[2][1] === '半夜有人给由发消息？' && r.inter[3][1] === '而且说是在群里看到由发的图才加的。' && r.inter[4][1] === '"小心眼的男朋友"是什么。',
  JSON.stringify(r.inter));
ok('合成一条译文的那两条，前一条没有译文', r.inter[0][0] === '……。' && r.inter[0][1] === '', JSON.stringify(r.inter[0]));
ok('攒在末尾：按顺序一一对上', r.batched.map(x => x[1]).join('|') === 'one.|two.|three.', JSON.stringify(r.batched));
ok('译文写在原文上面：挂到下一条', r.above[0][1] === 'hello.', JSON.stringify(r.above));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
