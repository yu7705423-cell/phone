// 群聊：建群、@、一次调用写整轮并按名字拆回、每人单独调用的开关、记忆开关、删角色、界面
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});

const reqs = [];
let streamReply = '';
let jsonReply = '{}';
const perCharReply = { };   // system 里认出是谁在说话，就回那个人的
await ctx.route('**/relay.example.com/**', async route => {
  const req = route.request(); const u = req.url(); const body = req.postData() || '';
  if (u.includes('/chat/completions')) {
    const j = JSON.parse(body || '{}');
    reqs.push(j);
    if (j.stream) {
      const sys = String(j.messages?.[0]?.content || '');
      let text = streamReply;
      for (const [name, t] of Object.entries(perCharReply)) if (sys.startsWith(`You are ${name}.`)) text = t;
      const chunks = [...text].map(ch => `data: ${JSON.stringify({ choices:[{ delta:{ content: ch } }] })}\n\n`);
      return route.fulfill({ status:200, contentType:'text/event-stream', body: chunks.join('') + 'data: [DONE]\n\n' });
    }
    return route.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ choices:[{ message:{ content: jsonReply } }] }) });
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
  const acc=(await import('/src/system/accounts.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
  const me = acc.current();
  const a = db.characters.create({ name:'小林', persona:'小林是花店店员，说话很短。', gender:'女' });
  const a2 = db.characters.create({ name:'小林子', persona:'小林子是小林的表弟。' });
  const b = db.characters.create({ name:'阿树', persona:'阿树是摄影师，爱讲冷笑话。' });
  const pair = db.chats.create({ characterIds:[a.id], personaId: me.id, title:'' });
  return { a: a.id, a2: a2.id, b: b.id, pair: pair.id, me: me.id, meName: me.name };
});

// ---- 一、数据 ----
const data = await page.evaluate(async (o) => {
  const g=(await import('/src/system/group.js'));
  let err = '';
  try { g.create({ ids:[o.a] }); } catch (e) { err = e.message; }
  const chat = g.create({ ids:[o.a, o.b], title:'' });
  const three = g.create({ ids:[o.a, o.a2, o.b], title:'三人' });
  return {
    err, id: chat.id, three: three.id,
    isGroup: g.isGroup(chat), title: g.titleOf(chat),
    m1: g.mentionsIn('@小林子 你好', three), m2: g.mentionsIn('@小林 @阿树 都来', three),
    m3: g.mentionsIn('没点名', three),
    pend: g.pendingMentions([{ role:'char' }, { role:'user', mentions:[o.b] }, { role:'user', mentions:[o.a] }]),
  };
}, ids);
ok('少于两人不建群', /至少需要 2/.test(data.err), data.err);
ok('是群、没起名时用成员名字', data.isGroup && data.title === '小林、阿树', data.title);
ok('@ 认长名字，不被短名字吃掉', JSON.stringify(data.m1) === JSON.stringify([ids.a2]), JSON.stringify(data.m1));
ok('一句里 @ 两个人', data.m2.length === 2 && data.m2.includes(ids.a) && data.m2.includes(ids.b), JSON.stringify(data.m2));
ok('没 @ 就是空', data.m3.length === 0);
ok('这一轮点了谁：只看角色接话之后那几条', JSON.stringify(data.pend) === JSON.stringify([ids.b, ids.a]), JSON.stringify(data.pend));
ids.group = data.id; ids.three = data.three;

// ---- 二、按名字拆回各人 ----
const split = await page.evaluate(async (o) => {
  const r=(await import('/src/system/ai/reply.js'));
  const db=(await import('/src/system/db/index.js'));
  const mem = [db.characters.get(o.a), db.characters.get(o.b)];
  return {
    basic: r.splitSpeakers('小林：在的\n今天店里好忙\n**阿树**：我也在\n【小林】：你呢', mem),
    user: r.splitSpeakers(`小林：好\n${o.meName}：我替你说一句\n阿树：嗯`, mem, { userName: o.meName }),
    none: r.splitSpeakers('一句没带名字的话', mem, { fallback: o.b }),
  };
}, ids);
ok('按名字拆开，没名字的行接着上一个人', split.basic.length === 3
  && split.basic[0].charId === ids.a && split.basic[0].text === '在的\n今天店里好忙'
  && split.basic[1].charId === ids.b && split.basic[2].charId === ids.a, JSON.stringify(split.basic));
ok('替用户写的那几行丢掉', split.user.length === 2 && !split.user.some(x => /替你说/.test(x.text)), JSON.stringify(split.user));
ok('一个名字都没有时算被点名的那个人', split.none.length === 1 && split.none[0].charId === ids.b, JSON.stringify(split.none));

// ---- 三、一次调用写整轮 ----
streamReply = '小林：在的\n[图片：店门口的花]\n阿树：我也在，刚拍完片';
reqs.length = 0;
const one = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const g=(await import('/src/system/ai/group.js'));
  const chat = db.chats.get(o.group);
  db.messages.create({ chatId: o.group, role:'user', authorId:'me', kind:'text', content:'@阿树 你们在吗',
    mentions:[o.b], status:'done' });
  const made = await g.run(chat, { notify:false });
  return made.map(m => ({ who: m.authorId, kind: m.kind, text: m.content }));
}, ids);
ok('一轮只调了一次接口', reqs.length === 1, `${reqs.length} 次`);
const sys = String(reqs[0]?.messages?.[0]?.content || '');
ok('系统提示里两个成员各有一段，带着各自的人设', /\[成员：小林\][\s\S]*花店店员/.test(sys) && /\[成员：阿树\][\s\S]*摄影师/.test(sys), sys.slice(0, 400));
ok('有群聊格式那一段，指令是英文', /\[群聊规则\]/.test(sys) && /Start each line with the speaker's name/.test(sys));
ok('没有一对一才有的能力（转账）', !/转账|\[transfer/i.test(sys));
const hist = JSON.stringify(reqs[0]?.messages || []);
ok('被 @ 的人写进了本轮点名', /\[本轮点名\][\s\S]*阿树/.test(hist), hist.slice(-300));
ok('拆成三条，各归各的', one.length === 3 && one[0].who === ids.a && one[1].who === ids.a && one[1].kind === 'image'
  && one[2].who === ids.b && /刚拍完片/.test(one[2].text), JSON.stringify(one));

// 下一轮：历史里成员的话带着名字、算 assistant
streamReply = '阿树：好';
reqs.length = 0;
await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const g=(await import('/src/system/ai/group.js'));
  db.messages.create({ chatId: o.group, role:'user', authorId:'me', kind:'text', content:'那好', status:'done' });
  await g.run(db.chats.get(o.group), { notify:false });
}, ids);
const hist2 = reqs[0]?.messages || [];
ok('历史里成员的话是 assistant，前面带名字', hist2.some(m => m.role === 'assistant' && /^小林：在的/.test(m.content))
  && hist2.some(m => m.role === 'assistant' && /阿树：我也在/.test(m.content)), JSON.stringify(hist2).slice(0, 500));
ok('这一轮没 @ 人，就没有点名那一段', !/\[本轮点名\]/.test(JSON.stringify(hist2)));

// ---- 四、每个角色单独调用：登记在案、默认关、开了按人头算 ----
const cost = await page.evaluate(async (o) => {
  const d=(await import('/src/system/db/defaults.js'));
  const c=(await import('/src/system/ai/cost.js'));
  const db=(await import('/src/system/db/index.js'));
  const before = c.perTurn(o.group);
  db.settings.set({ groupPerChar: true });
  const after = c.perTurn(o.group);
  return { dflt: d.DEFAULT_SETTINGS.groupPerChar, listed: c.EXTRA_CALLS.some(x => x.id === 'groupPerChar' && x.off === false),
    before, after };
}, ids);
ok('默认关、登记在 EXTRA_CALLS', cost.dflt === false && cost.listed, JSON.stringify(cost));
ok('开了之后「每轮调用」按人头多算', cost.before === 1 && cost.after === 2, JSON.stringify(cost));

perCharReply['小林'] = '小林说的';
perCharReply['阿树'] = '阿树说的';
reqs.length = 0;
const pc1 = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const g=(await import('/src/system/ai/group.js'));
  db.messages.create({ chatId: o.group, role:'user', authorId:'me', kind:'text', content:'@小林 你说', mentions:[o.a], status:'done' });
  return (await g.run(db.chats.get(o.group), { notify:false })).map(m => m.authorId);
}, ids);
ok('单独调用：@ 了一个人就只调一次、只他说', reqs.length === 1 && pc1.length === 1 && pc1[0] === ids.a, `${reqs.length} 次 ${JSON.stringify(pc1)}`);
reqs.length = 0;
const pc2 = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const g=(await import('/src/system/ai/group.js'));
  db.messages.create({ chatId: o.group, role:'user', authorId:'me', kind:'text', content:'大家好', status:'done' });
  return (await g.run(db.chats.get(o.group), { notify:false })).map(m => m.authorId);
}, ids);
ok('单独调用：没 @ 人就每人一次', reqs.length === 2 && pc2[0] === ids.a && pc2[1] === ids.b, `${reqs.length} 次 ${JSON.stringify(pc2)}`);
const sysPer = String(reqs[1]?.messages?.[0]?.content || '');
ok('单独调用时每人只看自己的角色卡', /摄影师/.test(sysPer) && !/花店店员/.test(sysPer), sysPer.slice(0, 200));
await page.evaluate(async () => { (await import('/src/system/db/index.js')).settings.set({ groupPerChar: false }); });

// ---- 五、记忆：各存一份、一起改；开关关着只留在群里 ----
jsonReply = JSON.stringify({ memories:[{ content:'用户说周六要去看展', category:'pending', rank:'B', keywords:['看展'] }] });
const mem = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const M=(await import('/src/system/ai/context/memory.js'));
  const x=(await import('/src/system/ai/tasks/memory-extract.js'));
  await x.extract(o.group);
  const rows = db.memories.where(m => /看展/.test(m.content));
  return {
    owners: rows.map(m => m.charId).sort(), twin: rows.length === 2 && rows[0].twin && rows[0].twin === rows[1].twin,
    scoped: rows.some(m => m.scopeChat),
    inPair: M.listFor(o.a, o.me, o.pair).some(m => /看展/.test(m.content)),
  };
}, ids);
ok('群里记下的事，每个成员各一份，共用 twin', mem.owners.length === 2 && mem.owners.includes(ids.a) && mem.owners.includes(ids.b) && mem.twin, JSON.stringify(mem));
ok('默认开关：私聊里也记得', !mem.scoped && mem.inPair, JSON.stringify(mem));

const upd = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const x=(await import('/src/system/ai/tasks/memory-extract.js'));
  const row = db.memories.where(m => /看展/.test(m.content) && m.charId === o.a)[0];
  db.messages.create({ chatId: o.group, role:'user', authorId:'me', kind:'text', content:'改成周日了', status:'done' });
  db.messages.create({ chatId: o.group, role:'char', authorId:o.a, kind:'text', content:'好', status:'done' });
  return row.id;
}, ids);
jsonReply = JSON.stringify({ memories:[{ content:'用户改成周日去看展（更新）', category:'pending', rank:'B', keywords:['看展'], updateId: upd }] });
const upd2 = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const x=(await import('/src/system/ai/tasks/memory-extract.js'));
  await x.extract(o.group);
  return db.memories.where(m => /看展/.test(m.content)).map(m => m.content);
}, ids);
ok('改一份，两份一起改', upd2.length === 2 && upd2.every(t => /周日/.test(t)), JSON.stringify(upd2));

jsonReply = JSON.stringify({ memories:[{ content:'阿树答应帮大家拍合照', category:'fact', rank:'S', keywords:['合照'] }] });
const scope = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const M=(await import('/src/system/ai/context/memory.js'));
  const bond=(await import('/src/system/bond.js'));
  const x=(await import('/src/system/ai/tasks/memory-extract.js'));
  db.chats.update(o.group, { groupMemory: 'group' });
  db.messages.create({ chatId: o.group, role:'user', authorId:'me', kind:'text', content:'合照呢', status:'done' });
  db.messages.create({ chatId: o.group, role:'char', authorId:o.b, kind:'text', content:'我来拍', status:'done' });
  await x.extract(o.group);
  const rows = db.memories.where(m => /合照/.test(m.content));
  return {
    scoped: rows.length === 2 && rows.every(m => m.scopeChat === o.group),
    inGroup: M.listFor(o.b, o.me, o.group).some(m => /合照/.test(m.content)),
    inPair: M.listFor(o.b, o.me, o.pair).some(m => /合照/.test(m.content)),
    noChat: M.listFor(o.b, o.me).some(m => /合照/.test(m.content)),
    inBond: bond.sourceOf(o.b, o.me).some(m => /合照/.test(m.content)),
  };
}, ids);
ok('开关关着：这几份只挂在这个群上', scope.scoped, JSON.stringify(scope));
ok('群里拿得到', scope.inGroup);
ok('私聊里、其余地方都拿不到', !scope.inPair && !scope.noChat, JSON.stringify(scope));
ok('也不进关系底色', !scope.inBond);

// ---- 六、删角色、删群、清空 ----
const purge = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const p=(await import('/src/system/purge.js'));
  const g=(await import('/src/system/group.js'));
  const c = db.characters.create({ name:'临时', persona:'x' });
  const c2 = db.characters.create({ name:'临时二', persona:'y' });
  const big = g.create({ ids:[o.a, o.b, c.id] });
  const small = g.create({ ids:[o.a, c2.id] });
  db.messages.create({ chatId: big.id, role:'char', authorId:o.a, kind:'text', content:'群里的话', status:'done' });
  p.clearHistory(o.a);
  const kept = db.messagesOf(big.id).length;
  p.dropCharacter(c.id);
  p.dropCharacter(c2.id);
  const scopedBefore = db.memories.where(m => m.scopeChat === o.group).length;
  p.dropChat(o.group);
  return {
    kept,
    big: db.chats.get(big.id)?.characterIds?.length,
    small: !!db.chats.get(small.id),
    scopedBefore, scopedAfter: db.memories.where(m => m.scopeChat === o.group).length,
  };
}, ids);
ok('清空一个角色的聊天记录不动群', purge.kept === 1, JSON.stringify(purge));
ok('删掉一个成员：三人群留下两人', purge.big === 2, JSON.stringify(purge));
ok('删到只剩一人的群整个删掉', purge.small === false, JSON.stringify(purge));
ok('删群时只在群里生效的记忆一并删掉', purge.scopedBefore === 2 && purge.scopedAfter === 0, JSON.stringify(purge));

// ---- 七、界面 ----
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot();
});
await page.waitForTimeout(700);
await page.locator('[aria-label="发起群聊"]').click();
await page.waitForTimeout(500);
await page.locator('.list-item', { hasText:'小林子' }).click();
await page.locator('.list-item', { hasText:'阿树' }).click();
await page.locator('.page input').first().fill('周末小组');
await page.locator('.nav-text', { hasText:'完成' }).click();
await page.waitForTimeout(700);
const title = await page.locator('.nav-title').last().innerText();
ok('建完群直接进会话，标题是群名和人数', /周末小组（2）/.test(title), title);
const newId = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  return db.chats.all().find(c => c.title === '周末小组')?.id;
});
ok('建出来的是群', !!newId);

// @ 条
await page.locator('.composer-input').fill('@');
await page.waitForTimeout(200);
const chips = await page.locator('.mention-bar .chip').allInnerTexts();
ok('输入 @ 出现成员', chips.length === 2 && chips.some(t => /阿树/.test(t)), JSON.stringify(chips));
await page.locator('.mention-bar .chip', { hasText:'阿树' }).click();
const drafted = await page.locator('.composer-input').inputValue();
ok('点一下补全成「@名字 」', drafted === '@阿树 ', JSON.stringify(drafted));

// 发一条，再按「让对方回复」（节奏默认按按钮才回）
streamReply = '阿树：来了\n小林子：我也来了';
await page.locator('.composer-input').fill('@阿树 出来玩');
await page.locator('.send-btn').click();
await page.waitForTimeout(300);
await page.locator('.send-btn').click();
await page.waitForTimeout(2500);
const sent = await page.evaluate(async (id) => {
  const db=(await import('/src/system/db/index.js'));
  return db.messagesOf(id).map(m => ({ role: m.role, who: m.authorId, mentions: m.mentions || [] }));
}, newId);
ok('发出去的那条记着 @ 了谁', sent[0]?.mentions?.[0] === ids.b, JSON.stringify(sent));
ok('回复按名字落成两个人', sent.filter(m => m.role === 'char').length === 2
  && sent[1]?.who === ids.b && sent[2]?.who === ids.a2, JSON.stringify(sent));
const whos = await page.locator('.msg-who').allInnerTexts();
ok('气泡上方写着是谁说的', whos.includes('阿树') && whos.includes('小林子'), JSON.stringify(whos));
await page.screenshot({ path:`${OUT}/group-chat.png` });

// 面板里没有转账
await page.locator('.ph-plus').click();
await page.waitForTimeout(300);
const panel = await page.locator('.panel-grid').innerText();
ok('面板里没有一对一的那几格', !/转账|礼物|通话/.test(panel), panel);
await page.locator('.ph-plus').click();

// 菜单
await page.locator('.ph-nav-action').click();
await page.waitForTimeout(400);
const menuText = await page.locator('.fullsheet').last().innerText().catch(() => '');
ok('菜单里是「这个群」，没有导出角色与关系底色', /群资料/.test(menuText) && !/导出这个角色/.test(menuText) && !/关系底色/.test(menuText), menuText.slice(0, 300));
await page.locator('.list-item', { hasText:'群资料' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path:`${OUT}/group-page.png` });
await page.locator('.list-item', { hasText:'群里的事带进私聊' }).locator('.switch').click();
const mode = await page.evaluate(async (id) => (await import('/src/system/db/index.js')).chats.get(id).groupMemory, newId);
ok('群资料里的记忆开关写在这个群上', mode === 'group', mode);

// 消息列表
await page.evaluate(async () => { (await import('/src/system/nav.js')).popToRoot(); });
await page.waitForTimeout(600);
ok('消息列表里群用拼起来的头像', await page.locator('.msg-row .group-face').count() >= 1);
const rowText = await page.locator('.msg-row', { hasText:'周末小组' }).innerText();
ok('预览带着最后是谁说的', /小林子：我也来了/.test(rowText), rowText);
await page.screenshot({ path:`${OUT}/group-list.png` });

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
