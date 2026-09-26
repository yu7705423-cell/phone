// 内置卡片：六个平台的帖子样式（ARCHITECTURE 4.251）
//
//   一、每张模板：字段设置与模板里的占位符一一对上；没有填不进去的占位符；示例填完不剩 {{ }}；都带 @Eira；没有脚本
//   二、没挂也没开全局：一张都不进 prompt；开「全局生效」后扫到关键词才进；单张停用的不进；挂给角色也生效
//   三、角色发内置卡片：按内置那一张读字段，消息记着 builtin-cards；发帖人是角色本人时用角色头像
//   四、世界书里：列表最上面是「内置卡片」；可以复制一张到自己的书，复制出来的是普通卡片条目、可以改
//   五、区块里带别的字段时默认按列表读；字段设置 scalar 后按普通字段读
import { BASE, EXE, chromium, PNG_B64 } from './_env.mjs';

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

// ---- 一 ----
const kits = await ev(async () => {
  const h = await import('/src/system/htmlcard.js');
  const { BUILTIN } = await import('/src/system/cardkit.js');
  return BUILTIN.map(e => {
    const fields = h.fieldsOf(e.card.html, e.card.fields);
    const names = new Set(fields.flatMap(f => [f.name, ...f.sub.map(s => `${f.name}.${s}`)]));
    const cfgKeys = Object.keys(e.card.fields || {});
    const values = h.parseValues(e.card.sampleText, fields);
    const doc = h.docOf(e.card, values, h.sampleSys());
    return {
      name: e.comment, keys: e.keys, n: fields.length,
      stray: cfgKeys.filter(k => !names.has(k)),
      bare: fields.filter(f => !cfgKeys.includes(f.name)).map(f => f.name),
      problems: h.problemsOf(e.card.html, { images: !!e.card.images }),
      left: /\{\{|\}\}/.test(doc), eira: /@Eira/.test(doc), script: /<script/i.test(e.card.html),
      author: e.card.authorField && fields.some(f => f.name === e.card.authorField),
      filled: Object.keys(values).length,
    };
  });
});
ok('一、内置 8 张：微博、小红书、Instagram、X、豆瓣广播、豆瓣小组、豆瓣影评、知乎',
  JSON.stringify(kits.map(k => k.name)) === '["微博","小红书","Instagram","X","豆瓣广播","豆瓣小组","豆瓣影评","知乎"]', JSON.stringify(kits.map(k => k.name)));
for (const k of kits) {
  ok(`一、${k.name}：字段设置与占位符一一对上，没有填不进去的占位符`,
    !k.stray.length && !k.bare.length && !k.problems.length, JSON.stringify({ stray: k.stray, bare: k.bare, problems: k.problems }));
  ok(`一、${k.name}：示例填完不剩占位符、带 @Eira、没有脚本、发帖人字段存在`,
    !k.left && k.eira && !k.script && k.author && k.filled >= 3, JSON.stringify(k));
}

// ---- 二、三 ----
const ids = await ev(async png => {
  const { db, images } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
  const img = await images.put(blob);
  const c = db.characters.create({ name: '林深', avatar: img.id || img, lorebookIds: [] });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
}, PNG_B64);
const turn = (user, turnId) => ev(async ({ chat, char, user, turnId }) => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  db.messages.create({ chatId: chat, role: 'user', authorId: 'me', kind: 'text', content: user, status: 'done' });
  const raw = await e.streamReply({ chat: db.chats.get(chat), char: db.characters.get(char) });
  const made = await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId, instant: true });
  return made.map(m => ({ kind: m.kind, card: m.card || null }));
}, { ...ids, user, turnId });
const sysOf = () => String(reqs[reqs.length - 1]?.messages?.[0]?.content || '');

reply = '好。';
await turn('刚刷到一条微博', 't0');
ok('二、没挂也没开全局：内置卡片不进 prompt', !/· 微博:/.test(sysOf()));

// 上一轮那句「微博」还在扫描窗口里，先清掉
const clear = () => ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  db.messages.where(m => m.chatId === o.chat).forEach(m => db.messages.remove(m.id));
}, ids);
await clear();
await ev(async () => (await import('/src/system/htmlcard.js')).setBuiltin({ global: true }));
await turn('今天天气不错', 't1');
ok('二、开了全局、没扫到关键词：不进', !/· 微博:/.test(sysOf()) && !/· 知乎:/.test(sysOf()));

await ev(async () => (await import('/src/system/htmlcard.js')).setBuiltin({ off: ['builtin-zhihu'] }));
reply = '[卡片：微博]\n昵称：林深\n时间：刚刚\n正文：下雨了\n配图：窗外\n热评：路人甲｜好看｜3\n[/卡片]';
const made = await turn('发条微博吧，顺便上知乎问问', 't2');
const sys = sysOf();
ok('二、扫到「微博」：微博卡片进 prompt（说明、字段、字数）', /· 微博: A Weibo post/.test(sys) && /正文 \(up to 500 characters\)/.test(sys)
  && /热评 \(list, each item: 昵称｜内容｜点赞\)/.test(sys), sys.slice(sys.indexOf('[卡片]'), sys.indexOf('[卡片]') + 600));
ok('二、单张停用的（知乎）不进', !/· 知乎:/.test(sys));
const card = made.find(m => m.kind === 'card')?.card;
ok('三、角色发内置卡片：按内置那一张读字段，记着 builtin-cards',
  card?.bookId === 'builtin-cards' && card.entryId === 'builtin-weibo' && card.values.热评?.[0]?.昵称 === '路人甲', JSON.stringify(card));

await ev(async () => (await import('/src/system/htmlcard.js')).setBuiltin({ global: false, off: [] }));
await ev(async o => (await import('/src/system/db/index.js')).db.characters.update(o.char, { lorebookIds: ['builtin-cards'] }), ids);
reply = '好。';
await turn('知乎上有个问题', 't3');
ok('二、关掉全局、挂给角色：照样生效', /· 知乎: A Zhihu answer/.test(sysOf()), '');

await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(1800);
const doc = await ev(() => document.querySelector('.ph-card iframe')?.getAttribute('srcdoc') || '');
ok('三、发帖人是角色本人：头像用角色的（data: 地址），不是首字', /<img src="data:image\/jpeg;base64,/.test(doc) && !/class="wb-av-ini"/.test(doc), doc.slice(-600));

// ---- 四 ----
await ev(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('lorebook', '/'); });
await page.waitForTimeout(700);
const first = await ev(() => document.querySelector('.list-item, [class*="list-item"]')?.textContent || '');
ok('四、世界书列表最上面是「内置卡片」', /内置卡片/.test(first), first);
await ev(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('lorebook', '/builtin/builtin-x'); });
await page.waitForTimeout(800);
ok('四、内置卡片页有预览', (await page.locator('.hc-preview iframe').count()) === 1);
await page.locator('button', { hasText: '复制到我的世界书' }).click();
await page.waitForTimeout(300);
await page.locator('.list-item, [class*="list-item"]', { hasText: '新建一本' }).click();
await page.waitForTimeout(700);
const copied = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const b = db.lorebooks.all().find(x => x.name === '我的卡片');
  const e = b?.entries?.[0];
  return { e: e ? { type: e.type, name: e.comment, builtin: !!e.builtin, html: /x-row/.test(e.card?.html || ''), id: e.id } : null,
    editor: document.querySelectorAll('textarea.tb-code').length };
});
ok('四、复制出来：新建「我的卡片」，是普通卡片条目（不带内置标记），进入编辑页可改',
  copied.e && copied.e.type === 'card' && copied.e.name === 'X' && !copied.e.builtin && copied.e.html && copied.e.id !== 'builtin-x' && copied.editor === 1, JSON.stringify(copied));

// ---- 五 ----
const amb = await ev(async () => {
  const h = await import('/src/system/htmlcard.js');
  const tpl = '{{#评分}}<b>{{星级}}</b>{{评分}}{{/评分}}';
  return { a: h.fieldsOf(tpl), b: h.fieldsOf(tpl, { 评分: { scalar: true } }) };
});
ok('五、区块里带别的字段：默认按列表；设 scalar 后按普通字段，里面的字段各算各的',
  JSON.stringify(amb.a) === '[{"name":"评分","list":true,"sub":["星级"]}]'
  && JSON.stringify(amb.b) === '[{"name":"评分","list":false,"sub":[]},{"name":"星级","list":false,"sub":[]}]', JSON.stringify(amb));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(r => !r.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
