// HTML 卡片生成器（ARCHITECTURE 4.252）
//
//   一、工具箱首页有「HTML 卡片生成器」
//   二、选好的项、尺寸（聊天里的宽高）、类名前缀、写法规则一起进请求；没填装饰图片时写明不许联网
//   三、模型分两段交回：说明 JSON 与模板；预览在不给脚本的盒子里，用示例值填好
//   四、「按要求修改」：把当前的说明、模板与修改要求一起发出去，结果替换当前的
//   五、存入世界书：连同说明、字段设置、关键词、尺寸一起存成卡片条目，进入卡片编辑页
//   六、点一次调一次接口：生成 1 次、修改 1 次，没有别的请求
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
const answer = (name, color) => `<card-meta>
{"name": "${name}", "description": "A cinema ticket.", "keywords": ["电影", "影院"],
 "fields": {"片名": {"desc": "film title", "max": 12, "long": false}, "留言": {"desc": "note on the back", "max": 0, "long": true}},
 "sample": "片名：夜行\\n留言：散场后门口见"}
</card-meta>
<card-html>
<style>.cq1-t{color:${color};padding:10px;min-height:100%}.eira-dark .cq1-t{color:#eee}</style>
<div class="cq1-t"><h1>{{片名}}</h1><p>{{留言}}</p></div>
</card-html>`;
let reply = answer('电影票', '#123456');
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  if (body.stream) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n` });
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(async () => {
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
});

await ev(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('tools', '/'); });
await page.waitForTimeout(800);
ok('一、工具箱首页有「HTML 卡片生成器」', /HTML 卡片生成器/.test(await page.locator('body').innerText()));

await ev(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('tools', '/cardgen'); });
await page.waitForTimeout(800);
const chip = t => page.locator('button.chip', { hasText: new RegExp(`^${t}$`) }).first();
await chip('电影票').click();
await chip('复古胶片').click();
await page.locator('button.cg-pal', { hasText: '夜空' }).click();
await chip('翻到背面').click();
await chip('整行宽').click();
await page.locator('textarea').first().fill('背面写一句话');
await page.locator('button', { hasText: /^生成$/ }).click();
await page.waitForTimeout(1500);

const sys = String(reqs[0]?.messages?.find(m => m.role === 'system')?.content || reqs[0]?.messages?.[0]?.content || '');
ok('二、选好的项进请求：卡片、风格、色板色值、特效、想法', /Card: 电影票/.test(sys) && /Style: 复古胶片/.test(sys)
  && /Palette: 夜空 #0b1d3a/.test(sys) && /Effects: 翻到背面/.test(sys) && /What it should be like: 背面写一句话/.test(sys), sys.slice(-500));
ok('二、尺寸是聊天里的宽高（整行宽 340，4:3 为 255）', /The card is 340 px wide and 255 px tall/.test(sys), '');
ok('二、类名前缀、Mustache 写法、不许进网址、深色样式都写明', /Every class name starts with c[a-z0-9]{4}-\./.test(sys)
  && /\{\{# list \}\}/.test(sys) && /never goes inside src, href, url\(\)/.test(sys) && /\.eira-dark/.test(sys), '');
ok('二、没填装饰图片：写明不从网络加载', /Nothing is loaded from the network: draw with CSS, inline SVG and data: URIs only\./.test(sys), '');

await page.locator('.hc-preview').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const preview = await ev(() => ({
  frame: document.querySelector('.hc-preview iframe')?.getAttribute('sandbox'),
  doc: document.querySelector('.hc-preview iframe')?.getAttribute('srcdoc') || '',
  text: document.body.innerText,
}));
ok('三、结果：名称、说明、字段；预览在不给脚本的盒子里，用示例值填好',
  /结果 · 电影票/.test(preview.text) && /片名、留言/.test(preview.text) && preview.frame === '' && /夜行/.test(preview.doc) && /script-src 'none'/.test(preview.doc),
  JSON.stringify({ frame: preview.frame, doc: preview.doc.slice(0, 120) }));

reply = answer('电影票', '#ff0000');
const change = page.locator('.field', { hasText: '修改' }).locator('textarea');
await change.fill('字改成红色');
await page.locator('button', { hasText: '按要求修改' }).click();
await page.waitForTimeout(1500);
const sys2 = String(reqs[1]?.messages?.[0]?.content || '');
ok('四、修改：当前模板、说明与修改要求一起发出', /Change request:\n字改成红色/.test(sys2) && /cq1-t\{color:#123456/.test(sys2) && /"name":"电影票"/.test(sys2), sys2.slice(-400));
await page.locator('.hc-preview').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const doc2 = await ev(() => document.querySelector('.hc-preview iframe')?.getAttribute('srcdoc') || '');
ok('四、修改后的结果替换当前的', /#ff0000/.test(doc2), doc2.slice(0, 200));

await page.locator('button', { hasText: '存入世界书' }).click();
await page.waitForTimeout(300);
await page.locator('.list-item, [class*="list-item"]', { hasText: '新建一本' }).click();
await page.waitForTimeout(900);
const saved = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const b = db.lorebooks.all().find(x => x.name === '我的卡片');
  const e = b?.entries?.[0];
  return e ? { type: e.type, name: e.comment, content: e.content, keys: e.keys, max: e.card.fields.片名?.max, long: e.card.fields.留言?.long,
    width: e.card.width, sample: e.card.sampleText, html: /#ff0000/.test(e.card.html), editor: document.querySelectorAll('textarea.tb-code').length } : null;
});
ok('五、存成卡片条目：说明、关键词、字段设置、尺寸、示例都在，进入卡片编辑页',
  saved && saved.type === 'card' && saved.name === '电影票' && saved.content === 'A cinema ticket.' && JSON.stringify(saved.keys) === '["电影","影院"]'
  && saved.max === 12 && saved.long === true && saved.width === 'full' && /夜行/.test(saved.sample) && saved.html && saved.editor === 1, JSON.stringify(saved));
ok('六、生成一次、修改一次，一共 2 次请求', reqs.length === 2, String(reqs.length));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(r => !r.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
