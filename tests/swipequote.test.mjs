// 三件小事（ARCHITECTURE 4.210）：
//   一、会话里左右滑一条消息就引用它。滑不够、竖着走、从边缘起手都不算
//   二、接口页顶上「切换模型」：只换模型，地址与密钥不动；最近用过的排在列表顶上
//   三、发表情的面板里，每个表情下面写着它的名字 —— 角色读到的就是这个
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('https://relay.example.com/**', r => r.fulfill({ status: 500, body: 'no' }));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '中转', provider: 'openai', baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-keep', model: 'model-a' });
  svc.setActiveChat(p.id);
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const t = Date.now() - 60000;
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: '明天去看海吗', status: 'done', createdAt: t });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '好啊', status: 'done', createdAt: t + 1000 });
  return { chat: chat.id, preset: p.id };
});
const go = async (app, route) => {
  await page.evaluate(async ([a, r]) => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp(a, r); }, [app, route]);
  await page.waitForTimeout(800);
};

// 在一条消息上按一串点划一下（合成的 TouchEvent，和真机一样走 touchstart / move / end）
const swipe = (text, pts) => page.evaluate(async ({ text, pts }) => {
  const row = [...document.querySelectorAll('.msg')].find(m => m.innerText.includes(text));
  const b = row.querySelector('.bubble').getBoundingClientRect();
  const y0 = b.top + b.height / 2;
  const touch = (x, y) => new Touch({ identifier: 1, target: row, clientX: x, clientY: y });
  const fire = (type, x, y) => row.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true,
    touches: type === 'touchend' ? [] : [touch(x, y)], changedTouches: [touch(x, y)],
  }));
  fire('touchstart', pts[0][0], y0 + pts[0][1]);
  for (const [x, dy] of pts.slice(1)) { fire('touchmove', x, y0 + dy); await new Promise(r => setTimeout(r, 16)); }
  const [lx, ly] = pts[pts.length - 1];
  fire('touchend', lx, y0 + ly);
}, { text, pts });
const quoted = () => page.evaluate(() => document.querySelector('.quote-bar')?.innerText || '');

await go('chat', `/chat/${ids.chat}`);
await swipe('明天去看海吗', [[200, 0], [190, 0], [175, 1], [160, 2]]);
await page.waitForTimeout(300);
ok('滑得不够：不引用', !(await quoted()));
await swipe('明天去看海吗', [[200, 0], [210, 2], [240, 60], [250, 140]]);
await page.waitForTimeout(300);
ok('竖着走得更多：是在翻消息，不引用', !(await quoted()));
await swipe('明天去看海吗', [[200, 0], [190, 0], [170, 1], [140, 2], [110, 2]]);
await page.waitForTimeout(300);
ok('往左滑够了：引用这一条', /明天去看海吗/.test(await quoted()), await quoted());
ok('松手之后那一行回到原位', await page.evaluate(() => ![...document.querySelectorAll('.msg')].some(m => m.classList.contains('is-swiping'))));
await page.locator('[aria-label="不引用了"]').click();
await page.waitForTimeout(200);
await swipe('好啊', [[150, 0], [160, 0], [190, 1], [230, 2]]);
await page.waitForTimeout(300);
ok('往右滑也行（自己那一条）', /好啊/.test(await quoted()), await quoted());
ok('还在这段会话里（没被当成边缘返回）', await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute()) === `/chat/${ids.chat}`);

// ---- 表情面板 ----
await page.evaluate(async () => {
  const st = await import('/src/system/stickers.js');
  st.addFromUrl({ name: '委屈巴巴', url: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' });
});
await page.locator('[aria-label="表情"]').click();
await page.waitForTimeout(400);
ok('发表情的面板里，表情下面写着描述词', (await page.locator('.stk-panel .stk-cap').allInnerTexts()).includes('委屈巴巴'),
  JSON.stringify(await page.locator('.stk-panel .stk-cap').allInnerTexts()));

// ---- 切换模型 ----
await go('settings', '/api');
const row = page.locator('.list-item', { hasText: 'model-a' }).first();
ok('接口页顶上一行：主用正在用的模型', await row.count() === 1 && /主用/.test(await row.innerText()));
await row.click();
await page.waitForTimeout(500);
await page.locator('.sheet input').first().fill('model-b');
await page.locator('.sheet button', { hasText: '用输入框里的名字' }).click();
await page.waitForTimeout(400);
let p = await page.evaluate(async id => (await import('/src/system/ai/services.js')).chatPresets().find(x => x.id === id), ids.preset);
ok('换成了新模型', p.model === 'model-b', p.model);
ok('地址与密钥没动', p.baseUrl === 'https://relay.example.com/v1' && p.apiKey === 'sk-keep', JSON.stringify(p));
ok('换下来的那个记进最近用过', JSON.stringify(p.recentModels) === '["model-b","model-a"]', JSON.stringify(p.recentModels));
await page.locator('.list-item', { hasText: 'model-b' }).first().click();
await page.waitForTimeout(500);
const chip = page.locator('.model-recent .chip', { hasText: 'model-a' });
ok('再打开：最近用过的列在顶上', await chip.count() === 1);
await chip.click();
await page.waitForTimeout(400);
p = await page.evaluate(async id => (await import('/src/system/ai/services.js')).chatPresets().find(x => x.id === id), ids.preset);
ok('点一下就切回去', p.model === 'model-a', p.model);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
