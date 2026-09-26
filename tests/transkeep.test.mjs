// 译文点开之后，下一轮生成时不该自己收回去；「译文怎么显示」多一档：点开后下一轮收起（ARCHITECTURE 4.270）
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
let reply = '好。\n[译文：OK.]';
await ctx.route('**/relay.example.com/**', async route => route.fulfill({ status: 200, contentType: 'text/event-stream',
  body: [...reply].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' }));
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
  db.settings.set({ translateOpen: 'tap', paceMode: 'now' });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now(), translateTo: '英语', paceMode: 'now' });
  for (let i = 0; i < 3; i++) {
    db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: `问 ${i}`, status: 'done' });
    db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: `答 ${i}`, translation: `Answer ${i}`, status: 'done', turnId: `t${i}` });
  }
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
  return { chat: chat.id, char: c.id };
});
await page.waitForTimeout(1000);

const opened = () => ev(() => [...document.querySelectorAll('.bubble-trans')].filter(x => /Answer/.test(x.textContent)).map(x => x.textContent.trim()));
ok('译文默认收着', (await opened()).length === 0, JSON.stringify(await opened()));
// 点开「答 1」那一条
await page.locator('.bubble', { hasText: '答 1' }).first().click();
await page.waitForTimeout(400);
ok('点一下展开', JSON.stringify(await opened()) === '["Answer 1"]', JSON.stringify(await opened()));

// 下一轮：我发一句，角色回一句
const turn = async text => {
  await page.locator('.composer-input').fill(text);
  await page.locator('.ph-send').first().click();
  await page.waitForTimeout(1800);
};
await turn('再来');
ok('下一轮之后点开的那条还开着（默认「保持展开」）', JSON.stringify(await opened()) === '["Answer 1"]', JSON.stringify(await opened()));
await turn('再来一次');
ok('连着几轮也还开着', JSON.stringify(await opened()) === '["Answer 1"]', JSON.stringify(await opened()));

// 切到「下一轮收起」那一档
await ev(async () => (await import('/src/system/db/index.js')).db.settings.set({ translateOpen: 'turn' }));
await page.waitForTimeout(300);
await page.locator('.bubble', { hasText: '答 2' }).first().click();
await page.waitForTimeout(400);
ok('那一档下也点得开', (await opened()).includes('Answer 2'), JSON.stringify(await opened()));
await turn('又来');
ok('那一档下：下一轮之后收起', (await opened()).length === 0, JSON.stringify(await opened()));

// 设置页上有这一档
await ev(async o => { const n = await import('/src/system/nav.js'); n.openApp('chat', `/translate/${o.chat}`); }, ids);
await page.waitForTimeout(700);
const txt = await ev(() => document.body.innerText);
ok('翻译页上三档：点击展开、默认展开、点开后下一轮收起', /点击展开/.test(txt) && /默认展开/.test(txt) && /下一轮收起/.test(txt), txt.slice(0, 300));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
