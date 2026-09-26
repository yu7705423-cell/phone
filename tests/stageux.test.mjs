// 线下正文页的几处顺手（4.281）
//   一、还没有正文：给「让角色开场」「我先写」两条开头
//   二、写一段：「放上去，让角色接着写」一步到位，一次请求
//   三、底栏右端是写着字的「角色写」，写着时是「停止」
//   四、菜单里「重写最后一段」「删掉最后一段」
//   五、翻页版式上右键也出这一段的菜单
//   六、长篇那一页同一套
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
let calls = 0;
await ctx.route('**/relay.example.com/**', async route => {
  calls += 1;
  const body = JSON.parse(route.request().postData() || '{}');
  const text = `第${calls}段。雨还没停，他站在檐下。`;
  if (body.stream) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n` });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const scene = await import('/src/system/scene.js');
  const work = await import('/src/system/work.js');
  const a = svc.newChatPreset({ name: '甲', provider: 'openai' });
  svc.updateChatPreset(a.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm1' });
  svc.setActiveChat(a.id);
  const c = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const sc = scene.create({ chatId: chat.id, title: '旧书店', place: '旧书店', castIds: [c.id], opening: 'me' });
  const w = work.create({ chatId: chat.id, kind: work.SAGA, title: '雨落之前', charAs: { name: '沈砚' }, meAs: { name: '林一' }, opening: 'me' });
  const cp = work.addChapter(w.id, { title: '到站' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', `/scene/${sc.id}`);
  return { sc: sc.id, cp: cp.id, chat: chat.id };
});
await page.waitForTimeout(900);
const beats = () => ev(async id => (await import('/src/system/scene.js')).beatsOf(id).map(b => b.role), ids.sc);

// 一
ok('一、没有正文：两条开头都在', await page.locator('.sg-empty button', { hasText: '让角色开场' }).count() === 1
  && await page.locator('.sg-empty button', { hasText: '我先写' }).count() === 1);
await page.locator('.sg-empty button', { hasText: '让角色开场' }).click();
await page.waitForTimeout(900);
ok('一、点「让角色开场」：一次请求，落了一段角色写的', calls === 1 && JSON.stringify(await beats()) === '["char"]', JSON.stringify([calls, await beats()]));
ok('一、有了正文之后开头那两条没了', await page.locator('.sg-empty').count() === 0);

// 三
ok('三、底栏右端是「角色写」', await page.locator('.sg-bar .sg-go', { hasText: '角色写' }).count() === 1);

// 二
await page.locator('.sg-write').click();
await page.waitForTimeout(400);
await page.locator('.fullsheet textarea, .sheet textarea').first().fill('我把伞收起来，靠在门边。');
const andWrite = page.locator('button', { hasText: '放上去，让角色接着写' });
ok('二、写一段的页上有「放上去，让角色接着写」', await andWrite.count() === 1);
await andWrite.click();
await page.waitForTimeout(1000);
ok('二、一步到位：我的一段加角色的一段，一次请求', calls === 2 && JSON.stringify(await beats()) === '["char","me","char"]', JSON.stringify([calls, await beats()]));

// 四
await page.locator('button[aria-label="菜单"]').click();
await page.waitForTimeout(400);
ok('四、菜单里有重写与删掉最后一段', await page.locator('.sheet .list-item', { hasText: '重写最后一段' }).count() === 1
  && await page.locator('.sheet .list-item', { hasText: '删掉最后一段' }).count() === 1);
await page.locator('.sheet .list-item', { hasText: '重写最后一段' }).click();
await page.waitForTimeout(1000);
const vers = await ev(async id => { const s = await import('/src/system/scene.js'); const list = s.beatsOf(id); return s.versionsOf(list[list.length - 1]).length; }, ids.sc);
ok('四、重写最后一段：又一次请求，最后一段有了两版', calls === 3 && vers === 2, JSON.stringify([calls, vers]));
await page.locator('button[aria-label="菜单"]').click();
await page.waitForTimeout(400);
await page.locator('.sheet .list-item', { hasText: '删掉最后一段' }).click();
await page.waitForTimeout(400);
await page.locator('.modal button', { hasText: '删除' }).click();
await page.waitForTimeout(500);
ok('四、删掉最后一段', JSON.stringify(await beats()) === '["char","me"]', JSON.stringify(await beats()));

// 五
if (await page.locator('.sg-tap').count()) {
  await page.locator('.sg-tap').dispatchEvent('contextmenu');
  await page.waitForTimeout(400);
  ok('五、右键出这一段的菜单', await page.locator('.sheet', { hasText: '从这一段分叉' }).count() === 1);
  await page.keyboard.press('Escape');
} else ok('五、翻页版式', true);

// 六
await ev(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('us', `/read/${id}`); }, ids.cp);
await page.waitForTimeout(900);
ok('六、长篇：没有正文时有「让沈砚开场」与「我先写」', await page.locator('.sg-empty button', { hasText: '开场' }).count() === 1
  && await page.locator('.sg-empty button', { hasText: '我先写' }).count() === 1);
ok('六、长篇：底栏是「角色写」', await page.locator('.sg-bar .sg-go', { hasText: '角色写' }).count() === 1);

console.log(`\n${R.filter(x => x.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(x => x.pass) && !errs.length ? 0 : 1);
