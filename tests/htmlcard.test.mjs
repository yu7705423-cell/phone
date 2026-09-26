// HTML 卡片（ARCHITECTURE 4.250）
//
//   一、模板：字段从占位符读出（普通、列表带子字段、列表只有 {{.}}、条件区块）
//   二、角色写的那一段读成值：列表一行一项、子字段按｜、续行接到上一个字段
//   三、渲染：值一律转义；字数上限截断；长文本包成框内滚动；占位符不许进网址与 <style>
//   四、清洗：脚本、事件属性、外部链接、meta、表单拿掉；页内 # 链接留着；CSP 里 script-src 'none'
//   五、提示词：没挂卡片或没扫到关键词时一个字都没有；扫到了带上名字、说明、字段与字数，模板不进
//   六、角色发卡片：整段摘出来落成一条 card 消息，前后的话照常分条；正文存成角色那种写法
//   七、会话里画出来：盒子是 sandbox=""（不给脚本），上面一条细栏写着卡片名；模板删掉后退回纯文字
//   八、世界书 txt 导出再导回：卡片条目与模板原样还原
//   九、普通条目的注入不受影响，卡片条目不混进 [世界设定]
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
let reply = '好。';
await ctx.route('**/relay.example.com/**', async route => {
  reqs.push(JSON.parse(route.request().postData() || '{}'));
  return route.fulfill({ status: 200, contentType: 'text/event-stream',
    body: [...reply].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const TPL = `<style>.t{padding:8px}.t h1{font-size:18px}</style>
<div class="t">
  <img src="{{char_avatar}}" alt="{{片名}}">
  <h1>{{片名}}</h1>
  <p class="note">{{留言}}</p>
  {{#地点}}<span class="where">{{地点}}</span>{{/地点}}
  {{^地点}}<span class="nowhere">未写地点</span>{{/地点}}
  <ul>{{#评论}}<li><b>{{昵称}}</b>{{内容}}</li>{{/评论}}</ul>
  <div class="pics">{{#配图}}<i>{{.}}</i>{{/配图}}</div>
</div>`;

// ---- 一至四：内核 ----
const core = await ev(async tpl => {
  const h = await import('/src/system/htmlcard.js');
  const fields = h.fieldsOf(tpl);
  const card = { html: tpl, fields: { 留言: { max: 6, long: true, lines: 3 }, '评论.内容': { max: 4 } } };
  const values = h.parseValues([
    '片名：<script>alert(1)</script>夜行',
    '留言：第一行很长很长的一句话',
    '接着的第二行',
    '评论：路人甲｜这是哪家店呀',
    '评论：路人乙｜同城吗',
    '配图：夜里的街｜一杯咖啡',
    '不认识的：这一行接到配图后面',
  ].join('\n'), fields);
  const filled = h.fill(card, values, { char_avatar: 'data:image/png;base64,AAAA' });
  const probs = h.problemsOf('<img src="https://x.com/?q={{地址}}"><style>.a{background:url({{图}})}</style><a href="{{链接}}">x</a><div class="{{心情}}">{{正文}}</div>');
  const probsImg = h.problemsOf('<div class="{{心情}}" title="{{标题}}">{{正文}}</div>', { images: true });
  const leaked = h.fill({ html: '<img src="https://x.com/?q={{地址}}">' }, { 地址: '家' });
  const dirty = h.sanitize('<div onclick="x()">a</div><script>bad()</script><a href="https://evil.com/?a=1">out</a>'
    + '<a href="#back">in</a><meta http-equiv="refresh" content="0;url=https://evil.com"><form action="https://evil.com"><input name="k"></form>'
    + '<img src="https://evil.com/p.png"><img src="data:image/png;base64,AAAA"><iframe src="https://evil.com"></iframe>');
  const doc = h.docOf(card, values, {}, { dark: true });
  return { fields, values, filled, probs, probsImg, leaked, dirty, doc };
}, TPL);

ok('一、字段：普通、条件、列表带子字段、列表只有 {{.}}，按出现顺序',
  JSON.stringify(core.fields) === JSON.stringify([
    { name: '片名', list: false, sub: [] }, { name: '留言', list: false, sub: [] }, { name: '地点', list: false, sub: [] },
    { name: '评论', list: true, sub: ['昵称', '内容'] }, { name: '配图', list: true, sub: [] }]), JSON.stringify(core.fields));
ok('二、角色写的那一段：列表一行一项、子字段按｜、没有子字段的列表一行里｜也分项',
  core.values.评论?.length === 2 && core.values.评论[1].昵称 === '路人乙' && core.values.评论[1].内容 === '同城吗'
  && core.values.配图?.length === 2 && core.values.配图[0] === '夜里的街'
  && core.values.配图[1] === '一杯咖啡\n不认识的：这一行接到配图后面', JSON.stringify(core.values));
ok('二、认不出字段名的行接到上一个字段后面（长文本换行）',
  core.values.留言 === '第一行很长很长的一句话\n接着的第二行', JSON.stringify(core.values.留言));
ok('三、角色写的值一律转义：<script> 只是文字', !/<script>alert/.test(core.filled) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;夜行/.test(core.filled), core.filled.slice(0, 300));
ok('三、字数上限：超出截断加省略号（列表子字段也按自己的上限）',
  /第一行很长很/.test(core.filled) && !/第一行很长很长/.test(core.filled) && /这是哪家…/.test(core.filled), core.filled);
ok('三、长文本包成框内滚动的一块，高度按设的行数', /<span class="eira-long" style="max-height:4\.5em">/.test(core.filled), core.filled);
ok('三、条件区块：没写地点时显示「为空」那一段', /nowhere/.test(core.filled) && !/class="where"/.test(core.filled));
ok('三、头像地址（应用给的 data:）可以写进 src', /src="data:image\/png;base64,AAAA"/.test(core.filled));
ok('三、占位符写进网址、<style>、href 的都报出来，而且真的不填',
  core.probs.length === 3 && !/家/.test(core.leaked), JSON.stringify(core.probs) + ' ' + core.leaked);
ok('三、开了外部图片：连 class 里也不许有占位符，alt/title 可以',
  core.probsImg.length === 1 && /心情/.test(core.probsImg[0]), JSON.stringify(core.probsImg));
ok('四、清洗：事件属性、脚本、外部链接、meta、iframe、表单都拿掉',
  !/onclick|<script|evil\.com\/\?a|<meta|<iframe|<form|action=/.test(core.dirty), core.dirty);
ok('四、清洗：页内 # 链接、data: 图片留着；没开外部图片时 https 图片地址拿掉',
  /href="#back"/.test(core.dirty) && /src="data:image\/png/.test(core.dirty) && !/p\.png/.test(core.dirty), core.dirty);
ok('四、整页：CSP 在最前、script-src \'none\'、不许联网；深色模式挂 eira-dark',
  /^<!DOCTYPE html><meta http-equiv="Content-Security-Policy"/.test(core.doc) && /script-src 'none'/.test(core.doc)
  && /connect-src 'none'/.test(core.doc) && /class="eira-dark"/.test(core.doc), core.doc.slice(0, 400));

// ---- 五、六：聊天链路 ----
const ids = await ev(async tpl => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const book = db.lorebooks.create({ name: '卡片书', global: false, entries: [
    { id: 'e-plain', comment: '城市', keys: ['电影'], content: '城里只有一家老影院。', enabled: true, constant: false,
      priority: 100, order: 0, part: 'before', depth: 0, probability: 100 },
    { id: 'e-card', type: 'card', comment: '电影票', keys: ['电影'], content: 'A cinema ticket.', enabled: true, constant: false,
      priority: 100, order: 0, part: 'before', depth: 0, probability: 100,
      card: { html: tpl, fields: { 片名: { desc: 'film title', max: 12 }, 留言: { desc: 'one line on the back', long: true } }, width: 'bubble', ratio: '4:3' } },
  ] });
  const c = db.characters.create({ name: '阿岚', lorebookIds: [] });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id, book: book.id };
}, TPL);
const turn = (user, turnId) => ev(async ({ chat, char, user, turnId }) => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  db.messages.create({ chatId: chat, role: 'user', authorId: 'me', kind: 'text', content: user, status: 'done' });
  const raw = await e.streamReply({ chat: db.chats.get(chat), char: db.characters.get(char) });
  const made = await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId, instant: true });
  return made.map(m => ({ kind: m.kind, content: m.content, card: m.card || null }));
}, { ...ids, user, turnId });
const sysOf = () => String(reqs[reqs.length - 1]?.messages?.[0]?.content || '');

reply = '好。';
await turn('今晚有空吗', 't0');
ok('五、没挂这本书：提示词里没有卡片', !/\[卡片：card name\]/.test(sysOf()) && !/电影票/.test(sysOf()));

await ev(async o => (await import('/src/system/db/index.js')).db.characters.update(o.char, { lorebookIds: [o.book] }), ids);
await turn('今天天气不错', 't1');
ok('五、挂了书、没扫到关键词：提示词里没有卡片', !/电影票/.test(sysOf()), sysOf().slice(-600));

reply = '票买好了\n[卡片：电影票]\n片名：夜行\n留言：散场后在门口等你\n不许迟到\n[/卡片]\n你到哪了';
const made = await turn('我们去看电影吧', 't2');
const sys = sysOf();
ok('五、扫到关键词：带上写法、卡片名、说明、字段说明与字数',
  /\[卡片：card name\]/.test(sys) && /· 电影票: A cinema ticket\./.test(sys) && /片名 \(up to 12 characters\): film title/.test(sys)
  && /评论 \(list, each item: 昵称｜内容\)/.test(sys), sys.slice(sys.indexOf('[卡片]'), sys.indexOf('[卡片]') + 900));
ok('五、模板一个字都不进 prompt', !/class="t"/.test(sys) && !/\{\{片名\}\}/.test(sys));
ok('九、同一关键词的普通条目照常进 [世界设定]，卡片条目不混进去',
  /城里只有一家老影院/.test(sys) && !/\[世界设定\][^[]*A cinema ticket/.test(sys), '');
ok('六、卡片整段落成一条 card 消息，前后的话照常分条',
  JSON.stringify(made.map(m => m.kind)) === '["text","card","text"]', JSON.stringify(made));
const cm = made.find(m => m.kind === 'card');
ok('六、按字段读出值，续行接进留言', cm?.card?.values?.片名 === '夜行' && cm.card.values.留言 === '散场后在门口等你\n不许迟到'
  && cm.card.entryId === 'e-card', JSON.stringify(cm?.card));
ok('六、正文存成角色那种写法（历史里它读到的就是这一段）',
  cm?.content === '[卡片：电影票]\n片名：夜行\n留言：散场后在门口等你\n不许迟到\n[/卡片]', JSON.stringify(cm?.content));

reply = '[卡片：电影票]\n片名：晚场\n留言：记得带伞\n这句是正文';
const loose = await turn('电影几点', 't3');
ok('六、漏写收尾：只收像字段的几行，后面的话不被吞进卡片',
  JSON.stringify(loose.map(m => m.kind)) === '["card","text"]' && loose[1].content === '这句是正文', JSON.stringify(loose));

// ---- 七：画出来 ----
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(1500);
const look = await ev(() => {
  const c = document.querySelector('.ph-card');
  const f = c?.querySelector('iframe');
  return { n: document.querySelectorAll('.ph-card').length, bar: c?.querySelector('.hc-bar')?.textContent || '',
    sandbox: f?.getAttribute('sandbox'), hasFrame: !!f, doc: f?.getAttribute('srcdoc') || '',
    w: c ? Math.round(c.getBoundingClientRect().width) : 0 };
});
ok('七、会话里画成卡片：细栏写着「卡片 · 电影票」', look.n === 2 && /卡片 · 电影票/.test(look.bar), JSON.stringify({ ...look, doc: '' }));
ok('七、盒子是 sandbox=""：不给脚本，更不给 allow-same-origin', look.hasFrame && look.sandbox === '', String(look.sandbox));
ok('七、盒子里是填好的卡片', /夜行|晚场/.test(look.doc) && /script-src 'none'/.test(look.doc), look.doc.slice(0, 200));
ok('七、宽度按卡片设置（气泡宽 270px）', look.w === 270, String(look.w));
const frameText = await page.frameLocator('.ph-card iframe').first().locator('h1').textContent().catch(() => '');
ok('七、卡片真的渲染出来了', /夜行|晚场/.test(frameText), frameText);

await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  db.lorebooks.update(o.book, b => ({ entries: b.entries.filter(e => e.id !== 'e-card') }));
}, ids);
await page.waitForTimeout(500);
const gone = await ev(() => ({ frame: !!document.querySelector('.ph-card iframe'), text: document.querySelector('.ph-card')?.textContent || '' }));
ok('七、模板删掉后：退回纯文字，角色写的值还在', !gone.frame && /模板已不存在/.test(gone.text) && /夜行|晚场/.test(gone.text), JSON.stringify(gone));

// ---- 八：txt 导出再导回 ----
// 导出走真的 exportBooks，截下它交出去的那份文件
const round2 = await ev(async tpl => {
  const lf = await import('/src/system/lorefile.js');
  const { db } = await import('/src/system/db/index.js');
  const b = db.lorebooks.create({ name: '往返', entries: [
    { id: 'x', type: 'card', comment: '小票', keys: ['买'], content: 'A receipt.', enabled: true, constant: false,
      priority: 100, order: 0, part: 'before', depth: 0, probability: 100,
      card: { html: tpl + '\n## 不是小标题\n# 也不是', fields: { 片名: { max: 3 } }, width: 'full', ratio: 'long', images: true, sampleText: '片名：甲' } }] });
  let text = '';
  const orig = URL.createObjectURL;
  const blobs = [];
  URL.createObjectURL = blob => { blobs.push(blob); return orig.call(URL, blob); };
  try { await lf.exportBooks([b], { format: 'txt' }); } finally { URL.createObjectURL = orig; }
  text = blobs.length ? await blobs[0].text() : '';
  const d = lf.fromText(text, '');
  const e = d.entries[0];
  return { text: text.slice(0, 400), type: e?.type, name: e?.comment, content: e?.content, card: e?.card, same: e?.card?.html === b.entries[0].card.html };
}, TPL);
ok('八、txt 导出：卡片条目写明「类型：卡片」，模板编码后夹在两行标记之间',
  /类型：卡片/.test(round2.text) && /----- 卡片模板开始 -----/.test(round2.text), round2.text);
ok('八、导回来：类型、名称、说明、模板（含 ## 与 # 开头的行）、字段设置、尺寸原样还原',
  round2.type === 'card' && round2.name === '小票' && round2.content === 'A receipt.' && round2.same
  && round2.card?.fields?.片名?.max === 3 && round2.card?.width === 'full' && round2.card?.ratio === 'long' && round2.card?.images === true,
  JSON.stringify({ ...round2, text: '', card: { ...round2.card, html: '' } }));

// ---- 世界书里：新建卡片、编辑页预览 ----
await ev(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('lorebook', `/book/${o.book}`); }, ids);
await page.waitForTimeout(700);
await page.locator('.nav-text', { hasText: '加条目' }).click();
await page.waitForTimeout(300);
await page.locator('.list-item, [class*="list-item"]', { hasText: 'HTML 卡片' }).first().click();
await page.waitForTimeout(600);
const made2 = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const b = db.lorebooks.get(o.book);
  return b.entries.filter(e => e.type === 'card').map(e => e.id);
}, ids);
ok('世界书：「加条目」里可以选 HTML 卡片，建出一条卡片条目并进入卡片编辑页',
  made2.length === 1 && (await page.locator('textarea.tb-code').count()) === 1, JSON.stringify(made2));
await page.locator('textarea.tb-code').fill('<div class="x"><b>{{标题}}</b><p>{{内容}}</p></div>');
await page.waitForTimeout(400);
await page.locator('.hc-preview').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const editor = await ev(() => ({
  fields: [...document.querySelectorAll('.hc-field-name')].map(x => x.textContent),
  frame: !!document.querySelector('.hc-preview iframe'),
}));
ok('编辑页：从模板读出字段，逐个可设说明与字数；预览在盒子里', JSON.stringify(editor.fields) === '["标题","内容"]' && editor.frame, JSON.stringify(editor));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(r => !r.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
