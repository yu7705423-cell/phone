// 自动调接口的地方（续）：接口一直失败时，每一处各打出去几次（ARCHITECTURE 4.241）
//
// 用户要求：「每日自动的全都是失败了那当天就显示失败，就算重新调用也必须第二天，当天绝对不允许自动多次」，
// 并且要有一道机械检查 —— scripts/check-autocost.mjs 要求每个自动任务在这里（或 autocost.test.mjs）有一项。
//
// 数法：应用自己的调用账本（system/ai/usage.js，每个真正发请求的出口记一笔），按任务名分开数，
// 后台别的任务混进来也分得清。
import { BASE, EXE, chromium } from './_env.mjs';

// 这份测试替哪几个自动任务作证（scripts/check-autocost.mjs 核对）
const COVERS = {
  'day.plan': '当日日程：失败当天写明失败，同一天不再自动排',
  'daily:day': '当日日程：换个页面（那条记录还没同步过来）也不再自动排',
  'health.day': '身体状态：失败当天写明失败，开关关了又开也不再自动生成',
  'daily:health': '身体状态：换个页面（角色身上的日期还是旧的）也不再自动生成',
  'closet.daily': '每日穿搭：失败当天写明失败，开关关了又开也不再自动选',
  'daily:closet': '每日穿搭：换个页面（角色身上的日期还是旧的）也不再自动选',
  'char.snap': '自己存照片（间隔填 0）：失败之后同一天不再存',
  'daily:snap': '自己存照片（间隔填 0）：失败之后同一天不再存',
  'chat.proactive': '主动消息：失败之后下一轮巡检不再立刻重发',
  'char.alt': '开小号：失败之后下一轮巡检不再立刻重开',
  'memory.bond': '关系底色：失败之后下一条消息不再重压',
  'moment.create': '角色发朋友圈：失败一次只打一次，之后不自动再发',
  'moment.comment': '朋友圈评论：每位看得见的角色最多一次，失败不重试',
  'moment.reply': '朋友圈回复：失败只打一次',
  'inner.voice': '心声：失败只打一次，不重试',
  'chat.vision-describe': '随回复描述图片：失败之后重新生成回复不再描述',
  'call.summary': '通话小结：挂断一次只总结一次，失败不重试',
  'work.summary': '长篇小结：收篇一次只总结一次，失败不重试',
  'review.write': '看完自动写评：失败只打一次，不重试',
  'due:read': '一起读：开口失败之后，要再翻够间隔才再试（从前每翻一页试一次）',
  'read.ahead': '自动续读：失败一次就停下，不再自动续',
  'embed': '向量：补向量失败不重试',
  'rerank': '重排：一轮最多一次，失败不重试',
};
void COVERS;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

// 模型接口一律失败。只有「图片描述」那一段要回复成功、描述失败
let mode = 'fail';
await ctx.route('**/relay.example.com/**', async route => {
  const all = route.request().postData() || '';
  const describe = /Describe this image/.test(all);
  if (mode === 'fail' || (mode === 'describe-fail' && describe)) {
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' });
  }
  const body = JSON.parse(all || '{}');
  if (body.stream) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: '好。' } }] })}\n\ndata: [DONE]\n\n` });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '好。' } }] }) });
});
await ctx.route('**/img.example.com/**', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"down"}}' }));

const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);
const ev = (fn, a) => page.evaluate(fn, a);
const wait = ms => page.waitForTimeout(ms);
// 账本里这一类最近打出去几次
const n = label => ev(async l => {
  const u = await import('/src/system/ai/usage.js');
  return u.since(3600000).filter(x => x.label === l).reduce((a, x) => a + x.n, 0);
}, label);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const acc = await import('/src/system/accounts.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const ip = svc.newImagePreset({ name: '生图' });
  svc.updateImagePreset(ip.id, { baseUrl: 'https://img.example.com/v1', apiKey: 'k', model: 'img' });
  svc.setActiveImage(ip.id);
  db.settings.set({ retryMax: 0, chatFallback: false, memoryEnabled: true });
  const me = acc.currentId();
  const mk = (name, extra = {}) => {
    const c = db.characters.create({ name, persona: '说中文。', ...extra });
    const chat = db.chats.create({ characterIds: [c.id], personaId: me, lastMessageAt: Date.now() });
    return { char: c.id, chat: chat.id };
  };
  return { me, a: mk('阿岚'), b: mk('阿澈'), c: mk('阿雪'), d: mk('阿木'), e: mk('阿青') };
});
await ev(async () => { const n = await import('/src/system/nav.js'); n.unlock(); });

// ---- 当日日程 ----
const day = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const t = await import('/src/system/ai/tasks/day.js');
  const store = await import('/src/system/day.js');
  db.characters.update(o.char, { dayOn: true });
  await t.ensureToday(o.char);
  const rec = store.today(o.char);
  await t.ensureToday(o.char);
  // 换一个页面：那条记录在这个页面里还没有（模拟另一个页面的内存）
  store.remove(rec.id);
  await t.ensureToday(o.char);
  return { failed: !!rec.planFailed };
}, ids.a);
const dayN = await n('当日日程');
ok('当日日程：失败当天写明失败，同一天不再自动排', day.failed && dayN === 1, `打出去 ${dayN} 次，${JSON.stringify(day)}`);
ok('当日日程：换个页面（那条记录还没同步过来）也不再自动排', dayN === 1, `打出去 ${dayN} 次`);

// ---- 身体状态 ----
const health = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const t = await import('/src/system/ai/tasks/health.js');
  db.characters.update(o.char, { healthAuto: true });
  await t.ensureToday(o.char);
  const err = db.characters.get(o.char).healthAutoError;
  db.characters.update(o.char, { healthAuto: false });
  db.characters.update(o.char, { healthAuto: true });
  await t.ensureToday(o.char);
  const n1 = 0;
  // 换一个页面：角色身上的日期还是旧的
  db.characters.update(o.char, { healthAutoAt: '' });
  await t.ensureToday(o.char);
  return { err, n1 };
}, ids.a);
const healthN = await n('角色身体状态');
ok('身体状态：失败当天写明失败，开关关了又开也不再自动生成', !!health.err && healthN === 1, `打出去 ${healthN} 次，${JSON.stringify(health)}`);
ok('身体状态：换个页面（角色身上的日期还是旧的）也不再自动生成', healthN === 1, `打出去 ${healthN} 次`);

// ---- 每日穿搭 ----
const closet = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const cl = await import('/src/system/closet.js');
  const t = await import('/src/system/ai/tasks/closet.js');
  cl.create({ owner: o.char, group: 'top', sub: 'T 恤', name: '白色 T 恤' });
  db.characters.update(o.char, { closetDaily: true });
  await t.ensureDaily(o.char);
  const err = db.characters.get(o.char).closetDailyError;
  db.characters.update(o.char, { closetDaily: false });
  db.characters.update(o.char, { closetDaily: true });
  await t.ensureDaily(o.char);
  db.characters.update(o.char, { closetDailyAt: '' });
  await t.ensureDaily(o.char);
  return { err };
}, ids.a);
const closetN = await n('角色每日穿搭');
ok('每日穿搭：失败当天写明失败，开关关了又开也不再自动选', !!closet.err && closetN === 1, `打出去 ${closetN} 次，${JSON.stringify(closet)}`);
ok('每日穿搭：换个页面（角色身上的日期还是旧的）也不再自动选', closetN === 1, `打出去 ${closetN} 次`);

// ---- 巡检：自己存照片、主动消息、开小号 ----
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const pro = await import('/src/system/ai/proactive.js');
  // 阿澈：自己存照片，间隔填 0（不限）
  db.characters.update(o.b.char, { snap: true, snapDays: 0 });
  // 阿雪：主动消息，免打扰关掉
  db.characters.update(o.c.char, { proactive: true, proactiveMinutes: 60, proactiveQuietFrom: 0, proactiveQuietTo: 0 });
  // 阿木：开小号，概率 1，聊够三十条
  db.characters.update(o.d.char, { proactive: true, proactiveMinutes: 60, proactiveQuietFrom: 0, proactiveQuietTo: 0, charAlt: true, charAltChance: 1 });
  for (let i = 0; i < 32; i++) db.messages.create({ chatId: o.d.chat, role: i % 2 ? 'char' : 'user', authorId: i % 2 ? o.d.char : 'me', kind: 'text', content: `第 ${i} 句`, status: 'done', createdAt: Date.now() - (40 - i) * 1000 });
  pro.scheduleIn(o.c.char, 1000);
  pro.scheduleIn(o.d.char, 1000);
}, ids);
await wait(1300);
await ev(async () => (await import('/src/system/ai/proactive.js')).tick());
await wait(2500);
await ev(async () => { const s = await import('/src/system/ai/tasks/snap.js'); s.forget(Object.keys(JSON.parse(localStorage.getItem('phone.snap.at') || '{}'))[0]); });
await ev(async o => { const s = await import('/src/system/ai/tasks/snap.js'); s.forget(o); }, ids.b.char);
await ev(async () => (await import('/src/system/ai/proactive.js')).tick());
await wait(2500);
await ev(async () => (await import('/src/system/ai/proactive.js')).tick());
await wait(1500);
const snapN = await n('角色自己存照片');
ok('自己存照片（间隔填 0）：失败之后同一天不再存', snapN === 1, `打出去 ${snapN} 次`);
const proN = await n('角色主动发消息');
ok('主动消息：失败之后下一轮巡检不再立刻重发', proN === 1, `打出去 ${proN} 次`);
const altN = await n('角色开设小号');
ok('开小号：失败之后下一轮巡检不再立刻重开', altN === 1, `打出去 ${altN} 次`);
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  db.characters.update(o.c.char, { proactive: false });
  db.characters.update(o.d.char, { proactive: false, charAlt: false });
  db.characters.update(o.b.char, { snap: false });
}, ids);

// ---- 关系底色 ----
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const bond = await import('/src/system/bond.js');
  db.settings.set({ bondAuto: true });
  db.memories.create({ charId: o.char, personaId: o.me, content: '一起去看过海', rank: 'S', category: 'event', source: 'manual' });
  await bond.refresh(o.char, o.me).catch(() => {});
  await bond.refresh(o.char, o.me).catch(() => {});
  db.settings.set({ bondAuto: false });
}, { ...ids.e, me: ids.me });
const bondN = await n('关系底色');
ok('关系底色：失败之后下一条消息不再重压', bondN === 1, `打出去 ${bondN} 次`);

// ---- 朋友圈 ----
const mo = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const t = await import('/src/system/ai/tasks/moments.js');
  await t.createMoment(o.a.char).catch(() => {});
  const mine = db.moments.create({ authorId: 'me', text: '今天的晚霞', images: [], likes: [], comments: [], visibleTo: [o.a.char, o.b.char] });
  const r = await t.reactToMine(mine.id);
  await t.replyComment(mine.id, o.a.char, '你也看到了吗').catch(() => {});
  return { failed: r.failed.length };
}, ids);
await ev(async () => (await import('/src/system/ai/proactive.js')).tick());
await wait(1500);
ok('角色发朋友圈：失败一次只打一次，之后不自动再发', await n('角色发朋友圈') === 1, String(await n('角色发朋友圈')));
ok('朋友圈评论：每位看得见的角色最多一次，失败不重试', await n('朋友圈评论') === 2 && mo.failed === 2, `${await n('朋友圈评论')} ${JSON.stringify(mo)}`);
ok('朋友圈回复：失败只打一次', await n('朋友圈回复') === 1, String(await n('朋友圈回复')));

// ---- 心声 ----
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const inner = await import('/src/system/ai/tasks/inner.js');
  db.chats.update(o.chat, { innerMode: 'apart' });
  const m = db.messages.create({ chatId: o.chat, role: 'char', authorId: o.char, kind: 'text', content: '到家了', status: 'done' });
  await inner.attach(o.chat, [m]);
  db.chats.update(o.chat, { innerMode: '' });
}, ids.e);
await wait(1000);
ok('心声：失败只打一次，不重试', await n('心声') === 1, String(await n('心声')));

// ---- 随回复描述图片 ----
mode = 'describe-fail';
const vis = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const engine = await import('/src/system/ai/engine.js');
  svc.setVision({ mode: 'chat' });
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const img = await db.images.put(new File([blob], 'p.png', { type: 'image/png' }));
  const m = db.messages.create({ chatId: o.chat, role: 'user', authorId: 'me', kind: 'image', imageId: img, content: '[图片]', status: 'done' });
  const chat = db.chats.get(o.chat), char = db.characters.get(o.char);
  await engine.streamReply({ chat, char });
  await new Promise(r => setTimeout(r, 1500));
  const after1 = db.messages.get(m.id).vision;
  await engine.streamReply({ chat, char });   // 重新生成这一轮
  await new Promise(r => setTimeout(r, 1500));
  svc.setVision({ mode: 'off' });
  return { after1 };
}, ids.e);
mode = 'fail';
const visN = await n('发给角色的图写成描述');
ok('随回复描述图片：失败之后重新生成回复不再描述', visN === 1 && vis.after1 === 'error', `打出去 ${visN} 次，${JSON.stringify(vis)}`);

// ---- 通话小结 ----
await ev(async o => {
  const c = await import('/src/system/call.js');
  c.ring(o.chat);
  c.accept();
  await new Promise(r => setTimeout(r, 1200));
  c.say('你到家了吗');
  await new Promise(r => setTimeout(r, 1200));
  c.hangUp();
}, ids.a);
await wait(3000);
ok('通话小结：挂断一次只总结一次，失败不重试', await n('通话小结') === 1, String(await n('通话小结')));

// ---- 长篇小结 ----
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const work = await import('/src/system/work.js');
  const scene = await import('/src/system/scene.js');
  const task = await import('/src/system/ai/tasks/work.js');
  db.settings.set({ workSummary: true });
  const w = work.create({ chatId: o.chat, kind: work.SAGA, title: '长夜' });
  const ch = work.addChapter(w.id, { title: '第一章' });
  scene.addBeat({ sceneId: ch.id, role: scene.CHAR, authorId: o.char, text: '雨下了一夜。' });
  await task.wrap(ch.id).catch(() => {});
  db.settings.set({ workSummary: false });
}, ids.a);
await wait(1000);
ok('长篇小结：收篇一次只总结一次，失败不重试', await n('长篇小结') === 1, String(await n('长篇小结')));

// ---- 一起读、自动续读、看完自动写评 ----
const bookId = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const book = await import('/src/system/book.js');
  db.settings.set({ readGap: 3 });
  const text = Array.from({ length: 400 }, (_, i) => `第 ${i} 段。` + '窗外的雨一直没有停。'.repeat(8)).join('\n');
  const row = await book.add({ title: '雨季', text });
  const n = await import('/src/system/nav.js');
  n.openApp('theater', `/together/${o.chat}/${row.id}`);
  return row.id;
}, ids.a);
await wait(1500);
const replyBefore = await n('聊天回复');
for (let i = 0; i < 5; i++) {
  await page.locator('[aria-label="下一页"]').click();
  await wait(1200);
}
const readN = (await n('聊天回复')) - replyBefore;
ok('一起读：开口失败之后，要再翻够间隔才再试（从前每翻一页试一次）', readN === 1, `翻 5 页打出去 ${readN} 次`);
await ev(async ([b, c]) => {
  const ahead = await import('/src/system/readahead.js');
  ahead.begin(b, c, 0);
  ahead.setAlways(b, true);
}, [bookId, ids.a.char]);
await wait(3000);
await page.keyboard.press('Escape');
await wait(300);
await page.locator('[aria-label="上一页"]').click().catch(() => {});
await wait(1500);
const aheadState = await ev(async b => (await import('/src/system/readahead.js')).stateOf(b)?.always, bookId);
ok('自动续读：失败一次就停下，不再自动续', await n('一起读') === 1 && aheadState === false, `打出去 ${await n('一起读')} 次，always=${aheadState}`);
await ev(async ([b, c]) => {
  const { db } = await import('/src/system/db/index.js');
  const review = await import('/src/system/review.js');
  db.settings.set({ reviewAuto: true });
  await review.writeOnFinish({ kind: review.BOOK, subjectId: b, charId: c, at: 0 });
  db.settings.set({ reviewAuto: false });
}, [bookId, ids.a.char]);
await wait(1000);
ok('看完自动写评：失败只打一次，不重试', await n('书评影评') === 1, String(await n('书评影评')));
await ev(async () => { (await import('/src/system/read.js')).stop(); (await import('/src/system/nav.js')).goHome(); });

// ---- 向量与重排 ----
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const memvec = await import('/src/system/ai/memvec.js');
  svc.setEmbed({ baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'e' });
  svc.setRerank({ baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'r' });
  db.settings.set({ memoryVector: true });
  const m = db.memories.create({ charId: o.char, personaId: o.me, content: '喜欢下雨天', rank: 'A', category: 'fact', source: 'manual' });
  memvec.touch(m.id);
}, { ...ids.c, me: ids.me });
await wait(4500);
ok('向量：补向量失败不重试', await n('向量') === 1, String(await n('向量')));
const rr = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  db.settings.set({ memoryVector: false, rerankOn: true, rerankCandidates: 0 });
  for (const t of ['下雨天会想起你', '雨夜一起散步', '下雨的时候不出门']) {
    db.memories.create({ charId: o.char, personaId: o.me, content: t, rank: 'B', category: 'fact', keywords: ['下雨', '雨'], source: 'manual' });
  }
  db.messages.create({ chatId: o.chat, role: 'user', authorId: 'me', kind: 'text', content: '今天又下雨了', status: 'done' });
  await engine.streamReply({ chat: db.chats.get(o.chat), char: db.characters.get(o.char) }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  db.settings.set({ rerankOn: false });
  return true;
}, { ...ids.c, me: ids.me });
const rerankN = await n('重排');
ok('重排：一轮最多一次，失败不重试', rr && rerankN <= 1, `打出去 ${rerankN} 次`);

// ---- 更新当天：旧版本今天已经跑过（新加的 localStorage 记号还是空的），新版本不再跑 ----
const before = { day: await n('当日日程'), health: await n('角色身体状态'), closet: await n('角色每日穿搭') };
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const store = await import('/src/system/day.js');
  const hs = await import('/src/system/health.js');
  const cl = await import('/src/system/closet.js');
  localStorage.removeItem('phone.daily.tried');
  const c = db.characters.create({ name: '旧版本跑过的', dayOn: true, healthAuto: true, closetDaily: true });
  cl.create({ owner: c.id, group: 'top', sub: 'T 恤', name: '灰色 T 恤' });
  // 旧版本今天留下的：日程那条记录、身体状态与穿搭的日期标记
  store.save(c.id, { date: store.dateKey(c), items: [], planFailed: '旧版本失败' });
  db.characters.update(c.id, { healthAutoAt: hs.dateKey(), healthAutoError: '旧版本失败', closetDailyAt: cl.today(), closetDailyError: '旧版本失败' });
  await (await import('/src/system/ai/tasks/day.js')).ensureToday(c.id);
  await (await import('/src/system/ai/tasks/health.js')).ensureToday(c.id);
  await (await import('/src/system/ai/tasks/closet.js')).ensureDaily(c.id);
}, {});
await wait(1000);
const after = { day: await n('当日日程'), health: await n('角色身体状态'), closet: await n('角色每日穿搭') };
ok('更新当天：旧版本今天已经试过的，新版本不再自动试', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const fails = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fails}/${R.length} 通过`);
process.exit(fails ? 1 : 0);
