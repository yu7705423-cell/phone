// 只写文字发一张图：「图片」里多一项「输入图片内容」，不选图，写下画面发出去。
// 角色收到 [图片：…]，不走识图；气泡是一张文字图；连着几张不会叠成一摞；长按可改描述
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const c = db.characters.create({ name: '林晚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
  return { char: c.id, chat: chat.id };
});
await page.waitForTimeout(1000);

const send = async text => {
  await page.locator('.composer-side').first().tap();
  await page.waitForTimeout(300);
  await page.locator('.panel-item', { hasText: '图片' }).first().tap();
  await page.waitForTimeout(300);
  await page.locator('.sheet .list-item', { hasText: '输入图片内容' }).tap();
  await page.waitForTimeout(300);
  await page.locator('.modal textarea').fill(text);
  await page.locator('.modal-btn-primary', { hasText: '发送' }).tap();
  await page.waitForTimeout(400);
};
await send('窗外下着雨，桌上一杯没喝完的咖啡');
const msg = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.chat).find(m => m.kind === 'image'), ids);
ok('发出一条图片消息：没有图，正文是 [图片：描述]，不走识图', msg && !msg.imageId && msg.role === 'user'
  && msg.content === '[图片：窗外下着雨，桌上一杯没喝完的咖啡]' && msg.vision === 'done' && msg.media === 'text', JSON.stringify(msg));
let bub = await page.locator('.photo-text').allInnerTexts();
ok('气泡是一张文字图：小标「图片」，下面是描述；不是一直转圈', bub.length === 1 && /图片/.test(bub[0]) && /没喝完的咖啡/.test(bub[0])
  && await page.locator('.msg.is-mine .media-pending').count() === 0, JSON.stringify(bub));
await page.screenshot({ path: `${OUT}/typephoto.png` });

const hist = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  const imgs = await engine.imagesFor(db.messagesOf(o.chat));
  return { h: engine.buildHistory(db.chats.get(o.chat), db.characters.get(o.char), db.messagesOf(o.chat), {}).map(m => m.content).join('\n'), imgs };
}, ids);
ok('角色读到的是这段描述，不带图', /\[图片：窗外下着雨/.test(hist.h) && !hist.imgs, JSON.stringify(hist).slice(0, 200));

await send('第二张');
await send('第三张');
bub = await page.locator('.photo-text').count();
ok('连着三张文字图：各自单独摆，不叠成一摞', bub === 3 && await page.locator('.stack-card').count() === 0, bub);

// 空着不发
await page.locator('.composer-side').first().tap();
await page.waitForTimeout(300);
await page.locator('.panel-item', { hasText: '图片' }).first().tap();
await page.waitForTimeout(300);
await page.locator('.sheet .list-item', { hasText: '输入图片内容' }).tap();
await page.waitForTimeout(300);
await page.locator('.modal-btn-primary', { hasText: '发送' }).tap();
await page.waitForTimeout(300);
const n = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.chat).length, ids);
ok('什么都没写：不发', n === 3, n);

// 长按改描述
await page.locator('.msg', { has: page.locator('.photo-text', { hasText: '第三张' }) }).dispatchEvent('contextmenu');
await page.waitForTimeout(400);
await page.locator('.sheet .list-item', { hasText: '编辑' }).tap();
await page.waitForTimeout(300);
await page.locator('.modal textarea').fill('改过的画面');
await page.locator('.modal-btn-primary').tap();
await page.waitForTimeout(400);
const last = await page.evaluate(async o => (await import('/src/system/db/index.js')).messagesOf(o.chat).slice(-1)[0], ids);
ok('长按编辑：描述与角色读到的正文一起改', last.imageDesc === '改过的画面' && last.content === '[图片：改过的画面]'
  && /改过的画面/.test(await page.locator('.photo-text').last().innerText()), JSON.stringify(last));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
