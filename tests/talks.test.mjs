// 角色手机里的聊天：列表两步生成、和 NPC 对得上、和你的那段是真的、进去才生成正文。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/status of 500/.test(t)) errors.push('CONSOLE: ' + t.slice(0, 200));
});

let calls = [];
let failNext = null;
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(`${BASE}`)) return route.continue();
  if (!u.includes('/v1/messages') && !u.includes('/chat/completions')) return route.abort();
  const sys = String(route.request().postDataJSON?.()?.system || '');
  const kind = /List the conversations/.test(sys) ? 'list'
    : /Write the conversation between/.test(sys) ? 'one' : 'other';
  calls.push({ kind, sys });
  if (failNext === kind) { failNext = null; return route.fulfill({ status: 500, body: 'x' }); }
  let body;
  if (kind === 'list') {
    const n = Number((sys.match(/- (\d+) conversations/) || [])[1] || 3);
    // 头两个用已知的人名，后面用没建过卡的名字
    const names = ['妈妈', '小林', '房东', '同事A', '同事B', '快递', '牙医', '旧同学'];
    body = JSON.stringify({ chats: Array.from({ length: n }, (_, i) => ({
      name: names[i % names.length], preview: `最后一句 ${i}` })) });
  } else if (kind === 'one') {
    const n = Number((sys.match(/- (\d+) lines/) || [])[1] || 4);
    body = JSON.stringify({ lines: Array.from({ length: n }, (_, i) => ({
      from: i % 2 ? 'char' : 'other', text: `第 ${i} 句` })) });
  } else body = '{}';
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: body }] }) });
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const card = await import('/src/system/ai/tasks/card.js');
  svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文' });
  // 两个已经建了卡的 NPC，和角色有关系
  const mom = db.characters.create({ name: '妈妈', persona: '母亲', isNpc: true, relations: [] });
  // 给妈妈一张真头像：会话列表上那张图要真的出得来（存的是图片 id，
  // 直接塞进 <img src> 是出不来的）
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  cv.getContext('2d').fillRect(0, 0, 64, 64);
  const ab = await new Promise(r => cv.toBlob(r, 'image/png'));
  db.characters.update(mom.id,
    { avatar: await db.images.put(new File([ab], 'm.png', { type: 'image/png' }), 256) });
  const lin = db.characters.create({ name: '小林', persona: '同学', isNpc: true, relations: [] });
  card.link(mom.id, a.id, '女儿', '母亲');
  card.link(lin.id, a.id, '同学', '同学');
  // 和用户的一段真对话
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'assistant', authorId: a.id,
    kind: 'text', content: '真实的最后一句', status: 'done' });
  // 锁屏挡着每一页（见 lock.mjs），这一份测的不是锁，先解开
  (await import('/src/system/theirs.js')).open(a.id);
  return { a: a.id, mom: mom.id, lin: lin.id, chat: chat.id, me: me.id };
});
await page.waitForTimeout(400);

const go = async route => {
  await page.evaluate(async ([r]) => {
    const n = await import('/src/system/nav.js');
    n.openApp('theirs', r);
    if (r === '/') n.popToRoot();
  }, [route]);
  await page.waitForTimeout(700);
};
const txt = () => page.evaluate(() => document.body.innerText);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
const rows = () => page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).chatsOf(id)
    .map(c => ({ name: c.name, npcId: c.npcId, filled: c.filled, n: (c.lines || []).length })), [ids.a]);

// ---- 1 只有和你那一段时，聊天这一格就已经在了 ----
await go(`/home/${ids.a}`);
check(/聊天/.test(await txt()), '只有和你那段真对话时，主屏上也有聊天这一格');
await go(`/chats/${ids.a}`);
let body = await txt();
check(/与你/.test(body) && /真实的最后一句/.test(body), '「与你」那一组读的是真数据');
check(/这一段是真实的对话记录/.test(body), '写明了那一段是真的');

// ---- 2 生成列表：一次请求，只出列表不出正文 ----
await go(`/make/${ids.a}`);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('聊天'));
  [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '生成').click();
});
await page.waitForTimeout(1200);
check(JSON.stringify(calls.map(c => c.kind)) === JSON.stringify(['list']),
  `只发了列表这一个请求：${JSON.stringify(calls.map(c => c.kind))}`);
let r = await rows();
check(r.length === 6, `生成了 6 条会话（${r.length}）`);
check(r.every(x => !x.filled && x.n === 0), '正文都还没有，等点进去再生成');

// ---- 3 NPC 联动：名字对得上的接上了 ----
const mom = r.find(x => x.name === '妈妈');
const lin = r.find(x => x.name === '小林');
const other = r.find(x => x.name === '房东');
check(mom?.npcId === ids.mom && lin?.npcId === ids.lin, '名字对得上已有 NPC 的接上了');
check(other && !other.npcId, '对不上的只留名字，不凭空造 NPC');
const listSys = calls[0].sys;
// relationsOf 给的是「对方在这个角色眼里是什么」：妈妈是它的母亲
check(/妈妈（母亲）/.test(listSys) && /小林（同学）/.test(listSys),
  `生成列表时把这个角色认识的人发过去了：${(listSys.match(/- .*/g) || []).slice(0, 3).join(' ')}`);

// ---- 4 点进去才生成正文 ----
calls = [];
await go(`/chats/${ids.a}`);
check(/点击后生成/.test(await txt()), '列表上写明了点进去才生成');
// 头像存的是图片 id，不过一道 useImage 是出不来的
const listAv = await page.evaluate(() => [...document.querySelectorAll('.list-item')]
  .filter(e => e.innerText.startsWith('妈妈'))
  .map(e => e.querySelector('.avatar')?.tagName));
check(listAv.includes('IMG'), `会话列表上那张头像是真的图（${JSON.stringify(listAv)}）`);
const oneId = await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).chatsOf(id).find(c => c.name === '妈妈').id, [ids.a]);
await go(`/chat/${oneId}`);
await page.waitForTimeout(1400);
check(JSON.stringify(calls.map(c => c.kind)) === JSON.stringify(['one']),
  `进来只发了这一段的请求：${JSON.stringify(calls.map(c => c.kind))}`);
body = await txt();
check(/第 0 句/.test(body) && /第 1 句/.test(body), '正文出来了');
check(await page.evaluate(() => !!document.querySelector('.page img.avatar')),
  '会话页上对方那张头像也是真的图');
const oneSys = calls[0].sys;
check(/母亲/.test(oneSys), '把对方的人设也发过去了（NPC 接上了才有）');
check(/最后一句/.test(oneSys), '把列表里那最后一句发过去了');

// ---- 5 再进来不重复生成 ----
calls = [];
await go(`/chats/${ids.a}`);
await go(`/chat/${oneId}`);
await page.waitForTimeout(1200);
check(calls.length === 0, `已经有正文的不再生成（这次 ${calls.length} 次请求）`);
r = await rows();
check(r.find(x => x.name === '妈妈').n === 12, '正文存下来了');

// ---- 6 生成失败：说清楚，给得出再试一次 ----
const twoId = await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).chatsOf(id).find(c => c.name === '小林').id, [ids.a]);
calls = []; failNext = 'one';
await go(`/chat/${twoId}`);
await page.waitForTimeout(1500);
body = await txt();
check(/再试一次/.test(body), '失败时给得出再试一次');
check((await rows()).find(x => x.name === '小林').n === 0, '失败时没写进半截内容');
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '再试一次')?.click();
});
await page.waitForTimeout(1400);
check((await rows()).find(x => x.name === '小林').n === 12, '再试一次成了');

// ---- 7 「重新生成」是另一次请求，而且先问一声 ----
calls = [];
await page.evaluate(() => {
  [...document.querySelectorAll('.nav-text')].find(b => b.innerText.trim() === '重新生成')?.click();
});
await page.waitForTimeout(600);
check(/整段替换/.test(await txt()), '这一段已经有内容，先问一声再动手');
check(calls.length === 0, '没确认之前不发请求');
await page.evaluate(() => {
  [...document.querySelectorAll('.overlay button')]
    .find(b => b.innerText.trim() === '重新生成')?.click();
});
await page.waitForTimeout(1400);
check(calls.length === 1, '「重新生成」再花一次请求，不是白按');

// ---- 8 列表里删得掉 ----
await go(`/chats/${ids.a}`);
const n0 = (await rows()).length;
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '删除 房东')?.click();
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  [...document.querySelectorAll('.overlay button')].find(b => b.innerText.trim() === '删除')?.click();
});
await page.waitForTimeout(600);
check((await rows()).length === n0 - 1, '列表里逐条删得掉');

// ---- 9 再生成一次是追加，已有的不重复 ----
calls = [];
await go(`/make/${ids.a}`);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('聊天'));
  [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '生成').click();
});
await page.waitForTimeout(1300);
check(/Already in the list/.test(calls[0].sys) && /妈妈/.test(calls[0].sys),
  '第二次把已有的会话发过去了，让它别重复');
r = await rows();
check(r.filter(x => x.name === '妈妈').length === 1, '重名的没有进来第二遍');

// ---- 10 锁屏也挡得住会话页 ----
await page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  t.setLock(id, { code: '1234', why: 'w', hints: ['a'] });
  t.relock(id);
}, [ids.a]);
await go(`/chat/${oneId}`);
check(/位密码/.test(await txt()), '会话页也被锁屏挡住（它认得出属于哪台手机）');

// ---- 11 备份带得走 ----
await page.evaluate(async ([id]) => (await import('/src/system/theirs.js')).open(id), [ids.a]);
const rt = await page.evaluate(async ([id]) => {
  const b = await import('/src/system/backup.js');
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/theirs.js');
  const before = t.chatsOf(id).length;
  const blob = await b.build();
  db.phoneChats.all().forEach(x => db.phoneChats.remove(x.id));
  await b.restore(blob);
  const back = t.chatsOf(id);
  return { before, after: back.length, lines: back.find(c => c.name === '妈妈')?.lines.length || 0 };
}, [ids.a]);
check(rt.after === rt.before && rt.lines === 12,
  `备份来回一趟，会话与正文都在（${JSON.stringify(rt)}）`);

await go(`/chat/${oneId}`);
await page.screenshot({ path: `${OUT}/talk.png`, fullPage: true });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
