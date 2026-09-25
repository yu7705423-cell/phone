// 线上旁白（ARCHITECTURE 4.221）。
//
//   会话「互动」里开关；关着提示词里一个字都没有，开着带上写法
//   一次回复里可以有好几行 [旁白：…]，各自落在写它的位置，不算作消息，不弹通知
//   会话里画成居中的一行小字，不是气泡；颜色默认是灰，「聊天背景」里可以改
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

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
});
const turn = (text, turnId) => ev(async ({ chat, char, text, turnId }) => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  db.messages.create({ chatId: chat, role: 'user', authorId: 'me', kind: 'text', content: '到了吗', status: 'done' });
  const raw = await e.streamReply({ chat: db.chats.get(chat), char: db.characters.get(char) });
  const made = await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId, instant: true });
  return made.map(m => ({ kind: m.kind, content: m.content, narration: m.narration || '' }));
}, { ...ids, text, turnId });
const sysOf = () => String(reqs[reqs.length - 1]?.messages?.[0]?.content || '');

// 关着
reply = '到了。';
await turn('', 't0');
ok('关着：提示词里没有旁白的写法', !/\[旁白：text\]/.test(sysOf()), '');

// 在「互动」里打开
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/extras/${o.chat}`); }, ids);
await page.waitForTimeout(800);
await page.locator('.list-item, [class*="list-item"]', { hasText: '开启旁白' }).locator('.switch, [role="switch"], input[type="checkbox"]').first().click();
await page.waitForTimeout(300);
const on = await ev(async o => (await import('/src/system/db/index.js')).db.chats.get(o.chat).narration, ids);
ok('会话「互动」里可以打开旁白', on === true, String(on));

// 开着，一次回复里好几行旁白
reply = '[旁白：他把手机扣在桌上，笑了一下。]\n到了。\n[旁白：窗外的雨还没停。]\n你呢\n[旁白：他又看了一眼门口。]';
const made = await turn('', 't1');
ok('开着：提示词里带上旁白的写法', /\[旁白：text\], is shown between the messages as narration/.test(sysOf()), sysOf().slice(-900));
ok('一次回复里三行旁白，各自落在写它的位置', JSON.stringify(made.map(m => m.kind)) === '["narration","text","narration","text","narration"]', JSON.stringify(made));
ok('旁白的正文照原样留着标记，历史里角色读到的就是它', made[0].content === '[旁白：他把手机扣在桌上，笑了一下。]' && made[0].narration === '他把手机扣在桌上，笑了一下。', JSON.stringify(made[0]));

// 画出来
await ev(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(900);
const look = await ev(() => {
  const rows = [...document.querySelectorAll('.ph-narration')];
  const r = rows[0];
  return { n: rows.length, text: r?.textContent, bubble: !!r?.closest('.bubble') || !!r?.querySelector('.bubble'),
    avatar: !!r?.querySelector('.ph-face, .avatar'), color: r ? getComputedStyle(r).color : '', align: r ? getComputedStyle(r).textAlign : '' };
});
ok('会话里画成居中的一行小字：没有气泡、没有头像', look.n === 3 && look.text === '他把手机扣在桌上，笑了一下。' && !look.bubble && !look.avatar && look.align === 'center', JSON.stringify(look));
await ev(async o => (await import('/src/system/chatlook.js')).setLook(o.chat, { narr: '#ff3b30' }), ids);
await page.waitForTimeout(400);
const red = await ev(() => getComputedStyle(document.querySelector('.ph-narration')).color);
ok('「聊天背景」里改了颜色：旁白换成那个颜色', red === 'rgb(255, 59, 48)', `${look.color} -> ${red}`);

// 旁白颜色的入口在「聊天背景」里
await page.locator('[aria-label="更多"]').first().click();
await page.waitForTimeout(400);
await page.getByText('聊天背景', { exact: true }).first().click();
await page.waitForTimeout(600);
const sheet = await ev(() => [...document.querySelectorAll('.sheet')].map(x => x.textContent).join(' '));
ok('「聊天背景」里有旁白文字颜色这一栏', /旁白文字颜色/.test(sheet), sheet.slice(0, 200));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
