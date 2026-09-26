// 面板「更多」最上面的「世界书与文风」；首字下沉去掉（4.282）
//   一、panel.order() 把 lore 放在最前面：新用户与已经排过顺序的老用户都是；默认收在更多里
//   二、更多里第一行就是它；点开：这个角色的世界书开关（关掉一本真的从角色卡上摘掉）、逐条开关
//   三、同一页新建一份文风预设：进预设库，并勾上写进这段会话线下时的文风
//   四、线下那张单子上也能新建文风
//   五、首字下沉没有了：设置页没有那一项，正文上没有 is-drop
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const r = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const panel = await import('/src/system/panel.js');
  const scene = await import('/src/system/scene.js');
  const out = {};
  out.freshFirst = panel.order()[0];
  out.inMore = panel.moreSet().has('lore');
  // 老用户：存过一份没有 lore 的顺序
  db.settings.set({ panelOrder: ['photo', 'voice', 'dice'], panelMore: ['dice'] });
  out.oldFirst = panel.order()[0];
  out.oldMore = panel.moreSet().has('lore');
  db.settings.set({ panelOrder: undefined, panelMore: undefined });
  const book = db.lorebooks.create({ name: '雨城设定', global: false, entries: [
    { id: 'e1', comment: '雨城', keys: ['雨'], content: '常年下雨。', enabled: true, constant: false, priority: 100, order: 0, part: 'before', depth: 0, probability: 100 }] });
  const c = db.characters.create({ name: '阿岚', lorebookIds: [book.id] });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '在吗', status: 'done' });
  const sc = scene.create({ chatId: chat.id, title: '旧书店', castIds: [c.id], opening: 'me' });
  scene.addBeat({ sceneId: sc.id, role: 'char', authorId: c.id, text: '雨还没停。他站在檐下，手里捏着一张票根，看着街对面的灯一盏一盏亮起来。' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', `/chat/${chat.id}`);
  return { ...out, book: book.id, char: c.id, chat: chat.id, sc: sc.id };
});
ok('一、新用户：世界书那一格排在最前面，收在更多里', r.freshFirst === 'lore' && r.inMore, JSON.stringify([r.freshFirst, r.inMore]));
ok('一、老用户存过顺序：补在最前面', r.oldFirst === 'lore', r.oldFirst);

// 二
await page.waitForTimeout(900);
await page.locator('.composer-side').first().click();
await page.waitForTimeout(400);
await page.locator('.panel-item').last().click();
await page.waitForTimeout(500);
const firstRow = await page.locator('.overlay .list-item').first().innerText();
ok('二、更多里第一行是「世界书与文风」', /世界书与文风/.test(firstRow), firstRow);
await page.locator('.overlay .list-item').first().click();
await page.waitForTimeout(600);
const sheet = page.locator('.sheet', { hasText: '世界书与文风' });
ok('二、点开是这个角色的世界书', await sheet.locator('.list-item', { hasText: '雨城设定' }).count() === 1);
await sheet.locator('.list-item', { hasText: '雨城设定' }).locator('.switch').click();
await page.waitForTimeout(300);
ok('二、关掉：从角色卡上摘掉', await ev(async id => !((await import('/src/system/db/index.js')).db.characters.get(id).lorebookIds || []).length, r.char));
await sheet.locator('.list-item', { hasText: '雨城设定' }).locator('.switch').click();
await page.waitForTimeout(300);
ok('二、再开：挂回去', await ev(async id => ((await import('/src/system/db/index.js')).db.characters.get(id).lorebookIds || []).length === 1, r.char));
await sheet.locator('.list-item', { hasText: '雨城设定' }).locator('button[aria-label="展开"]').click();
await page.waitForTimeout(300);
await sheet.locator('.lore-entries .list-item', { hasText: '雨城' }).locator('.switch').click();
await page.waitForTimeout(300);
ok('二、逐条开关写进书里', await ev(async id => (await import('/src/system/db/index.js')).db.lorebooks.get(id).entries[0].enabled === false, r.book));

// 三
await sheet.locator('.list-item', { hasText: '新建一份' }).click();
await page.waitForTimeout(400);
await page.locator('.fullsheet input, .sheet input').last().fill('极简测试');
await page.locator('.fullsheet textarea').last().fill('Write sparingly.');
await page.locator('.fullsheet button', { hasText: '保存' }).last().click();
await page.waitForTimeout(500);
const t3 = await ev(async id => {
  const tone = await import('/src/system/tone.js'); const { db } = await import('/src/system/db/index.js');
  const made = tone.list().find(t => t.name === '极简测试');
  return { made: !!made, on: made ? (db.chats.get(id).faceTones || []).includes(made.id) : false };
}, r.chat);
ok('三、新建的文风进了预设库，并勾上写进这段会话线下时的文风', t3.made && t3.on, JSON.stringify(t3));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// 四
await ev(async () => { const n = await import('/src/system/nav.js'); n.goHome(); });
await ev(async id => { const n = await import('/src/system/nav.js'); n.openApp('chat', `/chat/${id}`); }, r.chat);
await page.waitForTimeout(800);
await page.locator('.composer-side').first().click(); await page.waitForTimeout(300);
if (!await page.locator('.panel-item', { hasText: '线下' }).count()) { await page.locator('.panel-item').last().click(); await page.waitForTimeout(300); }
await page.locator('.overlay .list-item, .panel-item', { hasText: '线下' }).first().click();
await page.waitForTimeout(400);
await page.locator('.sheet .list-item', { hasText: '就在这里' }).click();
await page.waitForTimeout(500);
ok('四、线下那张单子上有「新建一份文风」', await page.locator('.fullsheet .list-item', { hasText: '新建一份文风' }).count() === 1, (await page.locator('.fullsheet').last().innerText().catch(() => 'no sheet')).slice(0, 200));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// 五
await ev(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/scene/${id}`); }, r.sc);
await page.waitForTimeout(800);
ok('五、正文上没有首字下沉', await page.locator('.is-drop').count() === 0 && await page.locator('.sg-text').count() >= 1);
await ev(async id => { const n = await import('/src/system/nav.js'); n.push(`/stage/settings/${id}`); }, r.sc);
await page.waitForTimeout(600);
ok('五、外观设置里没有首字下沉那一项', !/首字下沉/.test(await page.locator('.page').innerText()));

console.log(`\n${R.filter(x => x.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(x => x.pass) && !errs.length ? 0 : 1);
