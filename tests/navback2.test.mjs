// 悬浮返回键：点一下退回上一级，双击回主界面，长按打开多任务；主界面上不显示。
//
// 单击要等一下再办：立刻就退的话，退到主界面这个键就没了，双击的第二下落在底下的
// 应用图标上，平白打开一个应用。这里专门查「双击之后没有误开应用」。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const chatId = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ navStyle: 'back' });
  const c = db.characters.create({ name: '阿岚' });
  return db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() }).id;
});
const state = () => page.evaluate(async () => {
  const { nav } = await import('/src/system/nav.js');
  const s = nav.get();
  return { screen: s.screen, app: s.appId, depth: s.appId ? (s.stacks[s.appId] || []).length : 0, switcher: !!s.switcher };
});
const openChat = async () => {
  await page.evaluate(async id => {
    const n = await import('/src/system/nav.js');
    n.unlock(); n.goHome(); n.openApp('chat', '/'); n.push(`/chat/${id}`);
  }, chatId);
  await page.waitForTimeout(600);
};

await page.evaluate(async () => (await import('/src/system/nav.js')).unlock());
await page.waitForTimeout(400);
ok('主界面上不显示返回键', (await page.locator('.navback').count()) === 0);

// 点一下：退回上一级
await openChat();
let before = await state();
await page.locator('.navback').click();
await page.waitForTimeout(500);
let after = await state();
ok('点一下：退回上一级，仍在应用里', after.screen === 'app' && after.depth === before.depth - 1, JSON.stringify([before, after]));

// 双击：回主界面，第二下不误开应用
await openChat();
const box = await page.locator('.navback').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(80);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(900);
after = await state();
ok('双击：回到主界面', after.screen === 'home', JSON.stringify(after));
ok('双击之后没有误开哪个应用', after.screen === 'home' && !after.switcher, JSON.stringify(after));

// 退到应用根页再点一下：退回主界面，也不误开
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.openApp('chat', '/'); n.popToRoot(); });
await page.waitForTimeout(500);
await page.locator('.navback').click();
await page.waitForTimeout(900);
after = await state();
ok('在应用根页点一下：回到主界面', after.screen === 'home', JSON.stringify(after));

// 长按：多任务
await openChat();
const b2 = await page.locator('.navback').boundingBox();
await page.mouse.move(b2.x + 10, b2.y + 10);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(500);
after = await state();
ok('长按：打开多任务', after.switcher === true, JSON.stringify(after));
ok('长按抬手那一下不再退一级', after.screen === 'app' && after.depth === 2, JSON.stringify(after));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
