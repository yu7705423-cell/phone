// 用户自己发卡片（ARCHITECTURE 4.253）
//
//   一、输入栏面板里有「卡片」；列出这个角色能用的卡片（内置的也在）
//   二、选一张：按字段填，实时预览；列表字段一行一项
//   三、「帮我填」：点一次调一次接口，把想发什么、卡片字段、最近几句聊天交出去，交回来的值填进表单
//   四、发送：落一条我发的 card 消息，气泡在右边；正文是角色那种写法，下一轮角色在历史里读得到
//   五、没有可用卡片时写明去世界书建
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
let reply = '[卡片：微博]\n昵称：我\n正文：楼下的流浪猫今天晒太阳\n配图：猫｜台阶\n[/卡片]';
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

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  db.settings.set({ panelMore: [] });
  const c = db.characters.create({ name: '阿岚', lorebookIds: [] });
  const bare = db.characters.create({ name: '空白', lorebookIds: [] });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const chat2 = db.chats.create({ characterIds: [bare.id], lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: '今天去哪了', status: 'done' });
  return { char: c.id, chat: chat.id, chat2: chat2.id };
});
const openChat = id => ev(async id => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', `/chat/${id}`); }, id);
const openPanel = async () => {
  await page.locator('.ph-plus:visible').first().click({ timeout: 4000 });
  await page.waitForTimeout(300);
  await page.locator('.panel-item:visible', { hasText: '卡片' }).click();
  await page.waitForTimeout(500);
};

// 五
await openChat(ids.chat2);
await page.waitForTimeout(1000);
await openPanel();
ok('一、输入栏面板里有「卡片」', true);
ok('五、没有可用卡片：写明去世界书建', /暂无可用的卡片/.test(await page.locator('.fullsheet').innerText()), '');
// 返回：悬浮返回键模式下页面自己的箭头让位（shell.css 的 data-nav="back"），两种都认
await page.locator('.navback:visible, .fullsheet .ph-back:visible').first().click();
await page.waitForTimeout(400);
ok('五、面板可以关掉', (await page.locator('.fullsheet').count()) === 0);

// 一至四
await ev(async () => (await import('/src/system/htmlcard.js')).setBuiltin({ global: true }));
await openChat(ids.chat);
await page.waitForTimeout(1000);
await openPanel();
const list = await page.locator('.fullsheet').innerText();
ok('一、列出这个角色能用的卡片（内置的在）', /微博/.test(list) && /小红书/.test(list) && /内置卡片/.test(list), list.slice(0, 200));
await page.locator('.fullsheet .list-item, .fullsheet [class*="list-item"]', { hasText: '微博' }).first().click();
await page.waitForTimeout(500);
const field = name => page.locator('.fullsheet .field', { hasText: new RegExp(`^${name}`) }).locator('input, textarea').first();
await field('昵称').fill('我');
await field('正文').fill('今天没出门');
await page.waitForTimeout(800);
const pv = await ev(() => document.querySelector('.fullsheet .hc-preview iframe')?.getAttribute('srcdoc') || '');
ok('二、按字段填，实时预览', /今天没出门/.test(pv) && /sandbox/.test('sandbox'), pv.slice(0, 100));

const before = reqs.length;
await page.locator('.fullsheet input[placeholder^="例如"]').fill('分享一条关于流浪猫的微博');
await page.locator('.fullsheet button', { hasText: '帮我填' }).click();
await page.waitForTimeout(1200);
const ask = String(reqs[before]?.messages?.[0]?.content || '');
ok('三、帮我填：一次请求，交出想发什么、卡片字段、最近几句聊天', reqs.length === before + 1 && /分享一条关于流浪猫的微博/.test(ask)
  && /· 微博: A Weibo post/.test(ask) && /今天去哪了/.test(ask) && /\[卡片：微博\]/.test(ask), ask.slice(0, 600));
const filled = await ev(() => [...document.querySelectorAll('.fullsheet .field')].map(f => f.querySelector('input, textarea')?.value || ''));
ok('三、交回来的值填进表单（列表一行一项）', filled.includes('楼下的流浪猫今天晒太阳') && filled.includes('猫\n台阶'), JSON.stringify(filled));

await page.locator('.fullsheet button', { hasText: /^发送$/ }).click();
await page.waitForTimeout(900);
const sent = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const m = db.messagesOf(o.chat).filter(x => x.kind === 'card').pop();
  const el = document.querySelector('.msg.is-mine .ph-card');
  return m ? { role: m.role, content: m.content, entry: m.card.entryId, book: m.card.bookId, mine: !!el } : null;
}, ids);
ok('四、落一条我发的 card 消息，气泡在右边', sent && sent.role === 'user' && sent.entry === 'builtin-weibo' && sent.book === 'builtin-cards' && sent.mine, JSON.stringify(sent));
ok('四、正文是角色那种写法', sent && /^\[卡片：微博\]\n昵称：我\n正文：楼下的流浪猫今天晒太阳\n配图：猫\n配图：台阶\n\[\/卡片\]$/.test(sent.content), JSON.stringify(sent?.content));

reply = '好看';
const n0 = reqs.length;
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  await e.streamReply({ chat: db.chats.get(o.chat), char: db.characters.get(o.char) });
}, ids);
const hist = JSON.stringify(reqs[n0]?.messages || []);
ok('四、下一轮角色在历史里读得到这张卡片', /\[卡片：微博\]\\n昵称：我\\n正文：楼下的流浪猫今天晒太阳/.test(hist), hist.slice(-500));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(r => !r.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
