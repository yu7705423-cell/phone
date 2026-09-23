import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const R = [];
const ok = (name, cond, extra) => { R.push({ name, pass: !!cond, extra }); console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${cond ? '' : '   << ' + (extra ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const nav = await import('/src/system/nav.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '小明' });
  const char = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [char.id], personaId: me.id, lastMessageAt: Date.now() });
  const t = Date.now();
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '在吗', status: 'done', createdAt: t });
  const second = db.messages.create({ chatId: chat.id, role: 'char', authorId: char.id, kind: 'text', content: '阿岚：*抬头* 在的', status: 'done', createdAt: t + 1 });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '吃了吗', status: 'done', createdAt: t + 2 });
  nav.goHome(); nav.openApp('chat', `/chat/${chat.id}`);
  return { chat: chat.id, char: char.id, second: second.id };
});
await page.waitForTimeout(600);

ok('会话里有 3 条消息', await page.locator('.msg').count() === 3, await page.locator('.msg').count());

// 长按第二条
const target = page.locator(`#msg-${ids.second}`);
const box = await target.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const longPress = async () => {
  await page.touchscreen.tap(cx, cy);   // 先确保有交互
};
await target.dispatchEvent('touchstart');
await page.waitForTimeout(700);
await target.dispatchEvent('touchend');
await page.waitForTimeout(400);

ok('长按弹出消息菜单', await page.locator('.sheet').count() > 0);
const menuText = await page.locator('.sheet').innerText().catch(() => '');
ok('菜单里有编辑/引用/多选/删除',
  ['编辑','引用','复制','多选','删除'].every(w => menuText.includes(w)), menuText.replace(/\n/g,' / '));
ok('这条有格式问题，菜单里出现「修格式」', menuText.includes('修正格式'), menuText.replace(/\n/g,' / '));
ok('菜单顶上摆着这条的原文', menuText.includes('抬头'), menuText.replace(/\n/g,' / '));

// 修格式 -> 全部修一遍
await page.getByText('修正格式', { exact: false }).first().click();
await page.waitForTimeout(350);
const fixText = await page.locator('.sheet').innerText().catch(() => '');
ok('修格式列出了名字前缀和星号两项',
  fixText.includes('移除开头的角色名') && fixText.includes('星号'), fixText.replace(/\n/g,' / '));
await page.getByText('全部修正', { exact: false }).first().click();
await page.waitForTimeout(400);
const fixed = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  return db.messages.get(id)?.content;
}, ids.second);
ok('改完变成「（抬头） 在的」', fixed === '（抬头） 在的', fixed);
ok('修完菜单收起来了', await page.locator('.sheet').count() === 0);

// 引用：长按第三条 -> 引用 -> 发送
const third = page.locator('.msg').nth(2);
await third.dispatchEvent('touchstart');
await page.waitForTimeout(700);
await third.dispatchEvent('touchend');
await page.waitForTimeout(350);
console.log('  [dump] msg 数=', await page.locator('.msg').count(), ' sheet 数=', await page.locator('.sheet').count());
console.log('  [dump] sheet 文字=', JSON.stringify(await page.locator('.sheet').innerText().catch(() => '(无)')));
await page.getByText('回复这一条', { exact: false }).first().click();
await page.waitForTimeout(350);
ok('输入框上面出现引用栏', await page.locator('.quote-bar').count() === 1);
await page.locator('.composer-input').fill('还没呢');
await page.waitForTimeout(150);
await page.locator('.send-btn').first().click();
await page.waitForTimeout(400);
const sent = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const list = db.messagesOf(id);
  const last = list[list.length - 1];
  return { content: last.content, quoteId: last.quoteId, quoteText: last.quoteText, quoteRole: last.quoteRole };
}, ids.chat);
ok('发出去的消息带着引用', sent.content === '还没呢' && !!sent.quoteId && sent.quoteText === '吃了吗', JSON.stringify(sent));
ok('引用栏发完就收了', await page.locator('.quote-bar').count() === 0);
ok('气泡上画出了引用块', await page.locator('.quote-ref').count() >= 1, await page.locator('.quote-ref').count());

// 多选删除
const first = page.locator('.msg').first();
await first.dispatchEvent('touchstart');
await page.waitForTimeout(700);
await first.dispatchEvent('touchend');
await page.waitForTimeout(350);
await page.getByText('选择多条消息后一并删除', { exact: false }).first().click();
await page.waitForTimeout(400);
ok('进入多选，底部换成选择栏', await page.locator('.select-bar').count() === 1);
ok('长按那条已经被选上', await page.locator('.msg.is-picked').count() === 1, await page.locator('.msg.is-picked').count());
ok('多选时输入框收起来', await page.locator('.composer-bar').count() === 0);
await page.locator('.msg').nth(1).click();
await page.waitForTimeout(250);
ok('再点一条变成 2 条', await page.locator('.msg.is-picked').count() === 2, await page.locator('.msg.is-picked').count());
await page.locator('.msg').nth(1).click();
await page.waitForTimeout(250);
ok('再点一次取消选中', await page.locator('.msg.is-picked').count() === 1);

const beforeN = await page.locator('.msg').count();
await page.locator('.select-bar').getByText('删除').click();
await page.waitForTimeout(300);
await page.locator('.modal').getByText('确定').click();
await page.waitForTimeout(450);
ok('删掉一条', await page.locator('.msg').count() === beforeN - 1, `${beforeN} -> ${await page.locator('.msg').count()}`);
ok('删完退出多选', await page.locator('.select-bar').count() === 0 && await page.locator('.composer-bar').count() === 1);

// 编辑
const anyMsg = page.locator('.msg').first();
await anyMsg.dispatchEvent('touchstart');
await page.waitForTimeout(700);
await anyMsg.dispatchEvent('touchend');
await page.waitForTimeout(350);
await page.getByText('编辑', { exact: true }).first().click();
await page.waitForTimeout(350);
ok('编辑弹出输入框', await page.locator('.modal textarea').count() === 1);
await page.locator('.modal textarea').fill('改过的内容');
await page.locator('.modal').getByText('保存').click();
await page.waitForTimeout(400);
const edited = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  return db.messagesOf(id)[0].content;
}, ids.chat);
ok('编辑写回去了', edited === '改过的内容', edited);

await browser.close();
let bad = 0;
for (const r of R) { if (!r.pass) bad++; console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.name}${r.pass ? '' : '   << ' + (r.extra ?? '')}`); }
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e => console.log('  ' + e)); }
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad || errs.length ? 1 : 0);
