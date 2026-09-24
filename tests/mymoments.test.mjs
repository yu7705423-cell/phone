// 角色看得见用户自己发的朋友圈。
//
//   一、聊天请求里带上最近几条（时间、文字、几张图、配的歌、这个角色点过赞评过什么），条数可调，0 为全给
//   二、自己的动态上可以请某个角色评论：调一次接口，写一条评论并点赞
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const sent = [];
await page.route('https://relay.example.com/**', async r => {
  const body = JSON.parse(r.request().postData() || '{}');
  sent.push(body);
  const sys = body.messages?.[0]?.content || '';
  // 评论任务回 JSON，聊天回一句话
  const content = /Leave one comment/.test(sys) ? JSON.stringify({ text: '海边真好看' }) : '好';
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '中转', provider: 'openai', baseUrl: 'https://relay.example.com/v1', apiKey: 'sk', model: 'm' });
  svc.setActiveChat(p.id);
  db.settings.set({ streamMode: 'once', retryMax: 0 });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '你看到我发的了吗', status: 'done' });
  const now = Date.now();
  for (let i = 1; i <= 5; i++) {
    db.moments.create({ authorId: 'me', text: `第${i}条动态`, images: i === 5 ? ['img_a', 'img_b'] : [], likes: [], comments: [], createdAt: now - (6 - i) * 3600e3 });
  }
  db.moments.create({ authorId: c.id, text: '角色自己的动态', images: [], likes: [], comments: [], createdAt: now });
  return { chat: chat.id, char: c.id };
});

const systemOf = () => page.evaluate(async ({ chat, char }) => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  const ch = db.chats.get(chat);
  const { system, volatile } = engine.buildChatSystem(ch, db.characters.get(char), db.messagesOf(chat));
  return system + '\n' + (volatile || '');
}, ids);

// ---- 一 ----
let sys = await systemOf();
ok('聊天里带上了「对方的朋友圈」', /\[对方的朋友圈\]/.test(sys), sys.slice(-600));
ok('默认最近 3 条，最新的在前', /第5条动态[\s\S]*第4条动态[\s\S]*第3条动态/.test(sys) && !/第2条动态/.test(sys));
ok('写明几张图', /第5条动态.*\[图片 2 张\]/.test(sys));
ok('角色自己的动态不在这一块里', !/角色自己的动态/.test(sys));
await page.evaluate(async () => (await import('/src/system/db/index.js')).db.settings.set({ momentsCount: 0 }));
sys = await systemOf();
ok('条数填 0：全部带上', /第1条动态/.test(sys) && /第5条动态/.test(sys));

// 真正发出去的请求里也有
await page.evaluate(async ({ chat, char }) => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  return engine.streamReply({ chat: db.chats.get(chat), char: db.characters.get(char) });
}, ids);
const wire = JSON.stringify(sent.at(-1)?.messages || []);
ok('发给接口的请求里有你的朋友圈', /对方的朋友圈/.test(wire) && /第5条动态/.test(wire));

// ---- 二、请角色评论 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', '/moments'); });
await page.waitForTimeout(900);
const card = page.locator('.mo-card', { hasText: '第5条动态' }).first();
await card.locator('.mo-act').nth(1).click();
await page.waitForTimeout(500);
ok('自己的动态：评论弹窗里有「请角色评论」', /请角色评论/.test(await page.locator('.sheet').last().innerText()));
await page.locator('.mo-ask .btn', { hasText: '阿岚' }).click();
for (let i = 0; i < 25; i++) {
  const got = await page.evaluate(async () => (await import('/src/system/db/index.js')).db.moments.all().find(m => m.text === '第5条动态'));
  if ((got?.comments || []).length) break;
  await page.waitForTimeout(200);
}
const mo = await page.evaluate(async () => (await import('/src/system/db/index.js')).db.moments.all().find(m => m.text === '第5条动态'));
ok('角色写了评论', mo.comments?.some(c => c.authorId === ids.char && c.text === '海边真好看'), JSON.stringify(mo.comments));
ok('也点了赞', (mo.likes || []).includes(ids.char));
sys = await systemOf();
ok('之后的聊天里写明这个角色点过赞、评论过什么', /第5条动态.*\[你已点赞\].*\[你的评论：海边真好看\]/.test(sys));

// 角色的动态上没有这一栏
await page.locator('.sheet .overlay, .overlay').first().click({ position: { x: 200, y: 8 } }).catch(() => {});
await page.waitForTimeout(400);
await page.locator('.mo-card', { hasText: '角色自己的动态' }).first().locator('.mo-act').nth(1).click();
await page.waitForTimeout(400);
ok('角色的动态上没有「请角色评论」', !/请角色评论/.test(await page.locator('.sheet').last().innerText()));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
