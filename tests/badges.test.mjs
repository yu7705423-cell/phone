// 互动标识：连续互发与余烬、隐藏成就、限定、成长档位、增量统计、角色颁发、让角色知道、提醒、界面、年度回顾
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const reqs = [];
let reply = '好的。';
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  if (body.stream) {
    return route.fulfill({ status:200, contentType:'text/event-stream',
      body: [...reply].map(ch => `data: ${JSON.stringify({ choices:[{ delta:{ content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
  }
  return route.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ choices:[{ message:{ content: '这一年我们说了很多话。' } }] }) });
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
  const acc=(await import('/src/system/accounts.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
  const me = acc.current();
  const T = (off, h = 12, mi = 0, s = 0) => { const d = new Date(); d.setHours(h, mi, s, 0); d.setDate(d.getDate() + off); return d.getTime(); };
  const mk = (name, extra = {}) => {
    const c = db.characters.create({ name, persona:'x', ...extra });
    const chat = db.chats.create({ characterIds:[c.id], personaId: me.id, title:'' });
    return { c, chat };
  };
  const say = (chat, role, c, at, extra = {}) => db.messages.create({ chatId: chat.id, role, authorId: role === 'user' ? 'me' : c.id,
    kind:'text', content:'嗯', status:'done', createdAt: at, ...extra });

  // A：连着四天互发，到昨天为止；今天还没互发
  const A = mk('阿岚');
  for (let d = -4; d <= -1; d++) { say(A.chat, 'user', A.c, T(d, 10)); say(A.chat, 'char', A.c, T(d, 11)); }
  // B：三天互发，前天断了，昨天是角色先开口 -> 救火
  const Bc = mk('阿树');
  for (let d = -5; d <= -3; d++) { say(Bc.chat, 'user', Bc.c, T(d, 10)); say(Bc.chat, 'char', Bc.c, T(d, 11)); }
  say(Bc.chat, 'char', Bc.c, T(-1, 9)); say(Bc.chat, 'user', Bc.c, T(-1, 10));
  // C：同样断了一天，昨天是我先开口 -> 从 1 重新数
  const Cc = mk('小林');
  for (let d = -5; d <= -3; d++) { say(Cc.chat, 'user', Cc.c, T(d, 10)); say(Cc.chat, 'char', Cc.c, T(d, 11)); }
  say(Cc.chat, 'user', Cc.c, T(-1, 9)); say(Cc.chat, 'char', Cc.c, T(-1, 10));

  // D：成就与限定
  const D = mk('小雨', { birthday: '1999年3月8日' });
  const dc = D.chat, c = D.c;
  say(dc, 'user', c, T(-400, 12));                               // 相识四百天
  say(dc, 'user', c, T(-30, 3, 10)); say(dc, 'char', c, T(-30, 3, 40));         // 凌晨三点
  for (let i = 0; i < 10; i++) say(dc, 'user', c, T(-29, 14, 0, i * 3));          // 一分钟十条
  db.messages.create({ chatId: dc.id, role:'user', authorId:'me', kind:'sticker', stickerId:'stk1', content:'[表情：猫]', status:'done', createdAt: T(-28, 15, 0, 5) });
  db.messages.create({ chatId: dc.id, role:'char', authorId:c.id, kind:'sticker', stickerId:'stk1', content:'[表情：猫]', status:'done', createdAt: T(-28, 15, 0, 40) });
  db.messages.create({ chatId: dc.id, role:'user', authorId:'me', kind:'call', outcome:'done', seconds: 3700, direction:'out', content:'[通话]', status:'done', createdAt: T(-27, 20) });
  db.messages.create({ chatId: dc.id, role:'char', authorId:c.id, kind:'transfer', amount: 520, content:'[转账]', status:'done', createdAt: T(-26, 20) });
  for (let i = 0; i < 5; i++) {
    db.messages.create({ chatId: dc.id, role:'user', authorId:'me', kind:'letter', content:'[信]', status:'done', createdAt: T(-25, 10, i) });
    db.messages.create({ chatId: dc.id, role:'char', authorId:c.id, kind:'letter', content:'[信]', status:'done', createdAt: T(-25, 11, i) });
  }
  for (let i = 0; i < 10; i++) db.messages.create({ chatId: dc.id, role:'user', authorId:'me', kind:'notice', settledKind:'pact', settledId:'x' + i, content:'[约定已完成]', status:'done', createdAt: T(-24, 10, i) });
  for (let d = -20; d <= -14; d++) {
    say(dc, 'user', c, T(d, 8), { content:'早安' }); say(dc, 'char', c, T(d, 8, 5), { content:'早上好呀' });
    say(dc, 'user', c, T(d, 23), { content:'晚安' }); say(dc, 'char', c, T(d, 23, 5), { content:'晚安晚安' });
  }
  // 情人节（去年）与角色生日（去年 3 月 8 日）当天互发
  const y = new Date().getFullYear() - 1;
  say(dc, 'user', c, new Date(y, 1, 14, 12).getTime()); say(dc, 'char', c, new Date(y, 1, 14, 13).getTime());
  say(dc, 'user', c, new Date(y, 2, 8, 12).getTime()); say(dc, 'char', c, new Date(y, 2, 8, 13).getTime());
  return { A: A.chat.id, Ac: A.c.id, B: Bc.chat.id, C: Cc.chat.id, D: dc.id, Dc: c.id, me: me.id, year: y };
});

// ---- 一、连续互发、余烬、救火 ----
const st = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const b=(await import('/src/system/badges.js'));
  [o.A, o.B, o.C, o.D].forEach(id => b.sync(id));
  const s = id => b.streakOf(db.chats.get(id));
  return { A: s(o.A), B: s(o.B), C: s(o.C), Bun: db.chats.get(o.B).unlocked, Aun: db.chats.get(o.A).unlocked, fresh: b.fresh.get().items.length };
}, ids);
ok('连着四天互发、今天还没互发：快熄灭状态，4 天，火苗', st.A.state === 'risk' && st.A.n === 4 && st.A.form?.form === 'spark', JSON.stringify(st.A));
ok('三天就解锁了火苗那一档', !!st.Aun['streak-3'], JSON.stringify(st.Aun));
ok('断一天、第二天角色先开口并互发：接上，4 天，并解锁「救火」', st.B.n === 4 && !!st.Bun.rescue, JSON.stringify(st.B) + JSON.stringify(st.Bun));
ok('断一天、第二天是我先开口：从 1 重新数', st.C.n === 1, JSON.stringify(st.C));
ok('第一次补算出来的不放解锁动画', st.fresh === 0, String(st.fresh));

// ---- 二、成就、限定、档位 ----
const d = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const b=(await import('/src/system/badges.js'));
  const chat = db.chats.get(o.D);
  return { un: Object.keys(chat.unlocked || {}), lim: Object.keys(chat.limited || {}),
    tiers: b.tiersOf(chat).map(t => [t.id, t.value, t.level]), lv: b.levelOf(chat), label: b.labelOf('night3') };
}, ids);
for (const id of ['night3', 'burst', 'collide', 'firstCall', 'longCall', '520', 'letters5', 'pact10', 'greet7']) {
  ok(`解锁「${id}」`, d.un.includes(id), JSON.stringify(d.un));
}
ok('去年情人节与角色生日当天互发：各得一枚当年的限定', d.lim.includes(`valentine:${ids.year}`) && d.lim.includes(`bdayChar:${ids.year}`), JSON.stringify(d.lim));
const known = d.tiers.find(t => t[0] === 'known');
ok('相识四百天：到了 365 那一档', known[1] >= 400 && known[2] === 2 && d.un.includes('known-365'), JSON.stringify(known));
const call = d.tiers.find(t => t[0] === 'call');
ok('通话一小时：到了第一档', call[1] === 1 && call[2] === 1, JSON.stringify(call));
ok('等级按分数算出来了', d.lv.level >= 2 && d.lv.name === `第 ${d.lv.level} 级`, JSON.stringify(d.lv));
ok('给角色看的名字带说明', /凌晨三点（/.test(d.label), d.label);

// ---- 三、增量：再同步不重复计；同一毫秒的两条都算；新消息推进、放动画 ----
const inc = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const b=(await import('/src/system/badges.js'));
  const n0 = db.chats.get(o.A).stats.n;
  b.sync(o.A);
  const n1 = db.chats.get(o.A).stats.n;
  const t = Date.now();
  db.messages.create({ chatId:o.A, role:'user', authorId:'me', kind:'text', content:'在吗', status:'done', createdAt: t });
  db.messages.create({ chatId:o.A, role:'char', authorId:o.Ac, kind:'text', content:'在', status:'done', createdAt: t });
  const news = b.sync(o.A);
  const chat = db.chats.get(o.A);
  return { n0, n1, n2: chat.stats.n, streak: b.streakOf(chat), news, fresh: b.fresh.get().items.map(x => x.id) };
}, ids);
ok('再同步一次不重复计', inc.n0 === inc.n1, JSON.stringify(inc));
ok('同一毫秒进来的两条都计上', inc.n2 === inc.n0 + 2, JSON.stringify(inc));
ok('今天互发了：点亮，连续 5 天', inc.streak.state === 'lit' && inc.streak.n === 5, JSON.stringify(inc.streak));

// ---- 四、角色颁发 ----
reply = '给你这个。\n[授予：最会挑咖啡的人｜三周都没点错]';
const aw = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const e=(await import('/src/system/ai/engine.js'));
  const r=(await import('/src/system/ai/reply.js'));
  const chat = db.chats.get(o.A), char = db.characters.get(o.Ac);
  db.messages.create({ chatId:o.A, role:'user', authorId:'me', kind:'text', content:'今天的咖啡不错', status:'done' });
  const raw = await e.streamReply({ chat, char });
  const made = await r.renderTurn({ chat, char, raw, turnId:'aw1', instant:true });
  const m = made.find(x => x.kind === 'award');
  return { kinds: made.map(x => x.kind), m, awards: db.chats.get(o.A).awards, id: m?.id };
}, ids);
const sys1 = String(reqs[reqs.length - 1]?.messages?.[0]?.content || '');
ok('能力清单里有颁发标识的写法', /\[授予：badge name｜reason\]/.test(sys1) || /\[颁发标识\]/.test(sys1), sys1.slice(-600));
ok('角色写的 [授予：…] 落成一条颁发标识', aw.m && aw.m.awardName === '最会挑咖啡的人' && aw.m.awardReason === '三周都没点错', JSON.stringify(aw));
ok('记进了这段对话的收藏', aw.awards?.length === 1 && aw.awards[0].by === ids.Ac && aw.awards[0].to === 'me', JSON.stringify(aw.awards));

// ---- 五、让角色知道：关着一个字都不给，开着给事实 ----
reply = '好。';
const sysOff = sys1;
ok('默认关着：提示词里没有互动标识那一段', !/\[互动标识\]/.test(JSON.stringify(reqs[reqs.length - 1]?.messages || [])));
await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const e=(await import('/src/system/ai/engine.js'));
  db.chats.update(o.A, { badgeAware: true });
  await e.streamReply({ chat: db.chats.get(o.A), char: db.characters.get(o.Ac) });
}, ids);
const allOn = JSON.stringify(reqs[reqs.length - 1]?.messages || []);
ok('开了：提示词末尾有天数、今天的状态与等级', /\[互动标识\]/.test(allOn) && /Days in a row on which both sides have messaged: 5\. Today counts/.test(allOn) && /Level: /.test(allOn), allOn.slice(-500));

// ---- 六、快熄灭提醒：到点提醒一次，只一次 ----
const rem = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const b=(await import('/src/system/badges.js'));
  const n=(await import('/src/system/notify.js'));
  db.chats.update(o.D, {});   // D 的最后一次互发在去年，不在快熄灭里
  db.chats.update(o.B, { badgeRemindHour: 0 });   // B：昨天互发、今天没有 -> 快熄灭
  const before = n.notifications.get().items.length;
  b.tick(); b.tick();
  const items = n.notifications.get().items.slice(0, n.notifications.get().items.length - before);
  return { got: items.map(x => x.body) };
}, ids);
ok('快熄灭的那一段提醒了，而且只提醒一次', rem.got.length === 1 && /连续互发 4 天，今天尚未互发/.test(rem.got[0]), JSON.stringify(rem));

// ---- 七、界面 ----
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat', '/'); n.popToRoot();
});
await page.waitForTimeout(800);
const rowA = page.locator('.msg-row', { hasText:'阿岚' });
ok('消息列表里名字旁边挂着火花', await rowA.locator('.bd-list .ph-badge').count() >= 1);
await page.screenshot({ path:`${OUT}/badges-list.png` });

await rowA.click();
await page.waitForTimeout(800);
ok('会话顶栏名字旁边挂着火花与天数', /5/.test(await page.locator('.nav-title .bd-streak').first().innerText().catch(() => '')));
ok('颁发标识画成一张卡', await page.locator('.ph-award').count() === 1 && /最会挑咖啡的人/.test(await page.locator('.ph-award').innerText()));

// 解锁动画：在会话里多凑一天就解锁不了什么，直接造一个 7 天的
await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const b=(await import('/src/system/badges.js'));
  // 直接改到「6 天、昨天互发」，今天再互发一次就到 7 天火焰那一档
  const chat = db.chats.get(o.A);
  const st = JSON.parse(JSON.stringify(chat.stats));
  st.streak = 6; st.lastBoth = b.dayNo(Date.now()) - 1; st.day = null;
  db.chats.update(o.A, { stats: st });
  db.messages.create({ chatId:o.A, role:'user', authorId:'me', kind:'text', content:'又一天', status:'done' });
  db.messages.create({ chatId:o.A, role:'char', authorId:o.Ac, kind:'text', content:'嗯', status:'done' });
}, ids);
// 会话页等页面落定之后才同步标识（晚 1.5 秒，见 Conversation 里那一段）
await page.waitForTimeout(2200);
const toast = await page.locator('.bd-toast').innerText().catch(() => '');
// 消息是现在建的：半夜跑的话同一下还解锁了「夜猫子」，卡片上写「共 2 枚」、名字是先解锁的那一枚。
// 所以名字从这一下解锁的清单里查，不从卡片上的字查
const freshNames = await page.evaluate(async (o) => {
  const b = (await import('/src/system/badges.js'));
  return (b.fresh.get().items || []).filter(x => x.chatId === o.A).map(x => x.id);
}, ids);
ok('会话里解锁新一档：弹出解锁动画', /解锁/.test(toast)
  && (/火焰/.test(toast) || freshNames.some(id => /streak-7/.test(id))), toast + JSON.stringify(freshNames));
await page.screenshot({ path:`${OUT}/badges-toast.png` });

// 菜单进标识页
await page.locator('.ph-nav-action').click();
await page.waitForTimeout(400);
await page.locator('.fullsheet .list-item', { hasText:'互动标识' }).click();
await page.waitForTimeout(700);
const pg = await page.locator('.page').last().innerText();
ok('标识页：等级、连续互发、成长、隐藏成就、限定、颁发、年度回顾都在', ['连续互发', '成长', '隐藏成就', '限定', '颁发', '年度回顾', '让角色知道'].every(k => pg.includes(k)), pg.slice(0, 300));
ok('没解锁的成就只显示「？？？」和方向', /？？？/.test(pg) && /与夜晚有关/.test(pg));
await page.screenshot({ path:`${OUT}/badges-page.png`, fullPage: true });

// 我颁给角色
await page.locator('.list-item', { hasText:'颁给阿岚' }).click();
await page.waitForTimeout(300);
await page.locator('.sheet input').first().fill('最准时的人');
await page.locator('.sheet button', { hasText:'颁发' }).click();
await page.waitForTimeout(400);
const mine = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const aws = db.chats.get(o.A).awards;
  const msg = db.messagesOf(o.A).filter(m => m.kind === 'award' && m.role === 'user')[0];
  return { aws, content: msg?.content };
}, ids);
ok('我颁给角色：记进收藏，会话里留一条角色看得见的记录', mine.aws.some(a => a.by === 'me' && a.to === ids.Ac && a.name === '最准时的人')
  && mine.content === '[授予：最准时的人]', JSON.stringify(mine));

// 删掉角色颁的那条，那一枚跟着收回
const dropped = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const r=(await import('/src/system/ai/reply.js'));
  r.dropMessage(o.id);
  return db.chats.get(o.A).awards.map(a => a.name);
}, { ...ids, id: aw.id });
ok('删掉颁发那一条，那一枚收回', !dropped.includes('最会挑咖啡的人') && dropped.includes('最准时的人'), JSON.stringify(dropped));

// 主页：一圈与一排
await page.evaluate(async (o) => { (await import('/src/system/nav.js')).push(`/profile/${o.Ac}`); }, ids);
await page.waitForTimeout(800);
ok('角色主页：头像外一圈、下面一排标识', await page.locator('.ph-level-ring').count() === 1 && await page.locator('.bd-strip').count() === 1);
await page.screenshot({ path:`${OUT}/badges-profile.png` });

// 年度回顾
await page.evaluate(async (o) => { (await import('/src/system/nav.js')).push(`/year/${o.D}`); }, ids);
await page.waitForTimeout(600);
const yrText = await page.locator('.page').last().innerText();
ok('年度回顾页打得开，有数字', /条消息/.test(yrText) && /最常说的词|最热闹的一天/.test(yrText), yrText.slice(0, 200));
reqs.length = 0;
await page.locator('.list-item', { hasText:'请角色写一段' }).click();
await page.waitForTimeout(1500);
const note = await page.evaluate(async (o) => (await import('/src/system/db/index.js')).chats.get(o.D).yearNotes, ids);
ok('请角色写一段：一次调用，写进这一年', reqs.length === 1 && Object.values(note || {}).some(t => /这一年/.test(t)), `${reqs.length} 次 ${JSON.stringify(note)}`);
ok('交给模型的是本地算好的数字', /Messages this year:/.test(JSON.stringify(reqs[0]?.messages || [])));

// 群里的周榜
const wk = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const g=(await import('/src/system/group.js'));
  const b=(await import('/src/system/badges.js'));
  const grp = g.create({ ids:[o.Ac, o.Dc], title:'小组' });
  for (let i = 0; i < 6; i++) db.messages.create({ chatId: grp.id, role:'char', authorId:o.Ac, kind:'text', content:'说' + i, status:'done' });
  db.messages.create({ chatId: grp.id, role:'user', authorId:'me', kind:'text', content:'@小雨', mentions:[o.Dc], status:'done' });
  db.messages.create({ chatId: grp.id, role:'user', authorId:'me', kind:'text', content:'@小雨', mentions:[o.Dc], status:'done' });
  const t = b.weeklyTitles(db.chats.get(grp.id));
  return { a: t.get(o.Ac), d: t.get(o.Dc), id: grp.id };
}, ids);
// 消息是现在建的：半夜跑这个测试，说话的那位同时是夜猫子。所以只查有没有「话痨」，不查只有它
ok('群里这周：说得最多的是话痨，被 @ 最多的是团宠', (wk.a || []).includes('话痨') && !(wk.a || []).includes('团宠')
  && JSON.stringify(wk.d) === '["团宠"]', JSON.stringify(wk));
await page.evaluate(async (id) => { (await import('/src/system/nav.js')).push(`/chat/${id}`); }, wk.id);
await page.waitForTimeout(700);
ok('群里名字后面带着周榜', (await page.locator('.msg-who').allInnerTexts()).some(t => /阿岚 · 话痨/.test(t)));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
