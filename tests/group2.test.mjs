// 群聊第二批：群里主动开口（群自己的开关、调度、免打扰、一次调用）、群头像上传
import { BASE, OUT, EXE, chromium, PNG_PATH } from './_env.mjs';
const fs = await import('node:fs/promises');
const PNG = Buffer.from((await fs.readFile(PNG_PATH,'utf-8')).trim(), 'base64');
await fs.writeFile(`${OUT}/g2face.png`, PNG);
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});

const reqs = [];
let streamReply = '小林：好久没人说话了\n阿树：我来接一句';
await ctx.route('**/relay.example.com/**', async route => {
  const req = route.request(); const u = req.url(); const body = req.postData() || '';
  if (u.includes('/chat/completions')) {
    const j = JSON.parse(body || '{}');
    reqs.push(j);
    const chunks = [...streamReply].map(ch => `data: ${JSON.stringify({ choices:[{ delta:{ content: ch } }] })}\n\n`);
    return route.fulfill({ status:200, contentType:'text/event-stream', body: chunks.join('') + 'data: [DONE]\n\n' });
  }
  return route.fulfill({ status:404, body:'' });
});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const svc=(await import('/src/system/ai/services.js'));
  const g=(await import('/src/system/group.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
  const a = db.characters.create({ name:'小林', persona:'花店店员。' });
  const b = db.characters.create({ name:'阿树', persona:'摄影师。' });
  const chat = g.create({ ids:[a.id, b.id], title:'周末小组' });
  db.messages.create({ chatId: chat.id, role:'user', authorId:'me', kind:'text', content:'晚安', status:'done' });
  db.messages.create({ chatId: chat.id, role:'char', authorId:a.id, kind:'text', content:'晚安', status:'done' });
  return { a: a.id, b: b.id, chat: chat.id };
});

// ---- 一、默认关，关着的时候 tick 不动它 ----
const off = await page.evaluate(async (o) => {
  const g=(await import('/src/system/group.js'));
  const db=(await import('/src/system/db/index.js'));
  const pro=(await import('/src/system/ai/proactive.js'));
  const cfg = g.proactiveOf(db.chats.get(o.chat));
  localStorage.setItem('phone.proactive.next', JSON.stringify({ [`g:${o.chat}`]: Date.now() - 1000 }));
  await pro.tick();
  await new Promise(r => setTimeout(r, 800));
  return { cfg, n: db.messagesOf(o.chat).length, next: pro.groupNextAt(o.chat) };
}, ids);
ok('默认关着', off.cfg.on === false, JSON.stringify(off.cfg));
ok('关着的群 tick 不发，落点清掉', off.n === 2 && reqs.length === 0 && !off.next, JSON.stringify(off));

// ---- 二、手动试一次：一次调用，按名字落成两个人，未读加上 ----
reqs.length = 0;
const once = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const pro=(await import('/src/system/ai/proactive.js'));
  const made = await pro.sendGroupProactive(o.chat);
  return { who: made.map(m => m.authorId), unread: db.chats.get(o.chat).unread };
}, ids);
ok('一次触发只调一次接口', reqs.length === 1, `${reqs.length} 次`);
ok('按名字落成两个人', once.who.length === 2 && once.who[0] === ids.a && once.who[1] === ids.b, JSON.stringify(once));
ok('未读加上了', once.unread === 2, JSON.stringify(once));
const msgs = reqs[0]?.messages || [];
const all = JSON.stringify(msgs);
ok('这一轮的说明在末尾（群里主动开口）', /\[群里主动开口\]/.test(all) && /has passed since anyone last spoke/.test(all), all.slice(-400));
ok('最后一条是 user，不让接口当成续写', msgs[msgs.length - 1]?.role === 'user' && /opening this time/.test(msgs[msgs.length - 1]?.content || ''),
  JSON.stringify(msgs[msgs.length - 1]));
ok('系统提示是群聊那一份', /\[成员：小林\]/.test(String(msgs[0]?.content || '')));

// ---- 三、开着、到点：tick 发出去；免打扰里不发，推到结束 ----
reqs.length = 0;
const due = await page.evaluate(async (o) => {
  const g=(await import('/src/system/group.js'));
  const db=(await import('/src/system/db/index.js'));
  const pro=(await import('/src/system/ai/proactive.js'));
  db.chats.update(o.chat, { unread: 0 });
  g.setProactive(o.chat, { on: true, minutes: 60, quietFrom: 0, quietTo: 0 });
  localStorage.setItem('phone.proactive.next', JSON.stringify({ [`g:${o.chat}`]: Date.now() - 1000 }));
  const before = db.messagesOf(o.chat).length;
  await pro.tick();
  // 气泡是一条条滴下来的，等两条都落下
  for (let i = 0; i < 60 && db.messagesOf(o.chat).length < before + 2; i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 500));
  return { grew: db.messagesOf(o.chat).length - before, next: pro.groupNextAt(o.chat) };
}, ids);
ok('开着、到点了：tick 替这个群开口', due.grew === 2 && reqs.length === 1, JSON.stringify(due));
ok('发完重新排了下一次', due.next > Date.now(), JSON.stringify(due));

reqs.length = 0;
const quiet = await page.evaluate(async (o) => {
  const g=(await import('/src/system/group.js'));
  const db=(await import('/src/system/db/index.js'));
  const pro=(await import('/src/system/ai/proactive.js'));
  const h = new Date().getHours();
  g.setProactive(o.chat, { quietFrom: h, quietTo: (h + 2) % 24 });
  localStorage.setItem('phone.proactive.next', JSON.stringify({ [`g:${o.chat}`]: Date.now() - 1000 }));
  const before = db.messagesOf(o.chat).length;
  await pro.tick();
  await new Promise(r => setTimeout(r, 600));
  return { grew: db.messagesOf(o.chat).length - before, next: pro.groupNextAt(o.chat), end: (h + 2) % 24 };
}, ids);
ok('免打扰里不发', quiet.grew === 0 && reqs.length === 0, JSON.stringify(quiet));
ok('落点推到免打扰结束', new Date(quiet.next).getHours() === quiet.end && new Date(quiet.next).getMinutes() === 0, JSON.stringify(quiet));

// ---- 四、界面：群资料里的开关与头像 ----
await page.evaluate(async (o) => {
  const g=(await import('/src/system/group.js'));
  g.setProactive(o.chat, { on: false, quietFrom: 0, quietTo: 8 });
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat', `/group/${o.chat}`);
}, ids);
await page.waitForTimeout(800);
await page.locator('.list-item', { hasText:'群里有人主动开口' }).locator('.switch').click();
await page.waitForTimeout(300);
const ui = await page.evaluate(async (o) => {
  const g=(await import('/src/system/group.js'));
  const db=(await import('/src/system/db/index.js'));
  const pro=(await import('/src/system/ai/proactive.js'));
  return { cfg: g.proactiveOf(db.chats.get(o.chat)), next: pro.groupNextAt(o.chat) };
}, ids);
ok('群资料里打开开关：写在这个群上，并排了下一次', ui.cfg.on === true && ui.next > Date.now(), JSON.stringify(ui));
ok('打开后出现间隔、免打扰与「立即试一次」', await page.locator('button', { hasText:'立即试一次' }).count() === 1
  && /免打扰/.test(await page.locator('.page').last().innerText()));

await page.locator('.group-head input[type=file]').setInputFiles(`${OUT}/g2face.png`);
await page.waitForTimeout(1200);
const face = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const p=(await import('/src/system/purge.js'));
  const id = db.chats.get(o.chat).avatar;
  return { id, used: !!id && p.usedImageIds().has(id), blob: !!id && !!(await db.images.blob(id)) };
}, ids);
ok('上传群头像：存进了群上，图片在库里', !!face.id && face.blob, JSON.stringify(face));
ok('群头像登进了引用表（清理无引用不会删）', face.used, JSON.stringify(face));
ok('群资料页换成了这张图', await page.locator('.group-head .group-face').count() === 0
  && await page.locator('.group-head img').count() >= 1);
await page.screenshot({ path:`${OUT}/group2-page.png` });

await page.evaluate(async () => { (await import('/src/system/nav.js')).popToRoot(); });
await page.waitForTimeout(600);
const row = page.locator('.msg-row', { hasText:'周末小组' });
ok('消息列表里用上传的群头像', await row.locator('.group-face').count() === 0 && await row.locator('img').count() >= 1);
await page.screenshot({ path:`${OUT}/group2-list.png` });

await page.evaluate(async (o) => {
  const n=await import('/src/system/nav.js');
  n.push(`/group/${o.chat}`);
}, ids);
await page.waitForTimeout(600);
await page.locator('button', { hasText:'改用成员头像' }).click();
await page.waitForTimeout(500);
const cleared = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  return { avatar: db.chats.get(o.chat).avatar, still: !!(await db.images.blob(o.id)) };
}, { ...ids, id: face.id });
ok('改用成员头像：群上清空，那张没人用的图删掉', !cleared.avatar && !cleared.still, JSON.stringify(cleared));
ok('又拼回成员头像', await page.locator('.group-head .group-face').count() === 1);

// 删群时群头像一起清
const dropped = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const p=(await import('/src/system/purge.js'));
  const g=(await import('/src/system/group.js'));
  const c = g.create({ ids:[o.a, o.b], title:'临时' });
  const blob = await (await fetch('data:image/png;base64,' + o.png)).blob();
  const id = await db.images.put(new File([blob], 'x.png', { type:'image/png' }));
  db.chats.update(c.id, { avatar: id });
  p.dropChat(c.id);
  await new Promise(r => setTimeout(r, 300));
  return !(await db.images.blob(id));
}, { ...ids, png: PNG.toString('base64') });
ok('删群时群头像一并删掉', dropped === true);

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
