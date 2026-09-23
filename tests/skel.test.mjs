// 批 8b 骨架重写：性别锚点、消息规则、示例、取舍顺序、核心设定、思维链
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

// 模型这一轮先写自检，再说话
const RAW='<thinking>\n1. 说了两件事\n2. 先聊面试\n</thinking>\n啊？\n为什么';
const sse=[...RAW].map(ch=>`data: ${JSON.stringify({choices:[{delta:{content:ch}}]})}\n\n`).join('')+'data: [DONE]\n\n';
await page.route('**/v1/chat/completions', r => r.fulfill({
  status:200, contentType:'text/event-stream; charset=utf-8', body:sse }));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 剥自检 ----
const th = await page.evaluate(async () => {
  const reply=await import('/src/system/ai/reply.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  let r=reply.stripThink('<thinking>检查内容</thinking>正文');
  ok('剥得掉 thinking', r.text==='正文', r.text);
  ok('自检内容留了下来', r.think==='检查内容', r.think);

  r=reply.stripThink('<think>短标签</think>说话');
  ok('短标签也认', r.text==='说话' && r.think==='短标签', `${r.text} / ${r.think}`);

  r=reply.stripThink('< thinking >带空格</ thinking >正文');
  ok('标签里有空格也认', r.text==='正文', r.text);

  r=reply.stripThink('没有标签的一句话');
  ok('没有标签就原样返回', r.text==='没有标签的一句话' && r.think==='');

  // 漏了闭合标签：从开标签到结尾全当自检丢掉，否则整张清单会发给用户
  r=reply.stripThink('<thinking>检查了一半就没收尾');
  ok('漏了闭合标签也不会漏出去', r.text==='' && r.think.includes('检查了一半'), `${r.text} / ${r.think}`);

  r=reply.stripThink('<thinking>一</thinking>中间\n<thinking>二</thinking>结尾');
  ok('两段自检都剥掉', !r.text.includes('一') && !r.text.includes('二'), r.text);
  ok('两段都收进来了', r.think.includes('一') && r.think.includes('二'), r.think);

  // 拆条的时候也要先剥
  const parts=reply.splitReply('<thinking>检查</thinking>啊？\n为什么');
  ok('拆条前先剥自检', parts.length===2, JSON.stringify(parts.map(p=>p.text||p.content)));
  ok('拆出来的头一条不是自检', !JSON.stringify(parts[0]).includes('检查'), JSON.stringify(parts[0]));
  return R;
});
th.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 骨架 ----
const built = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const eng=await import('/src/system/ai/engine.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const me=acc.current();
  db.personas.update(me.id, { name:'阿园', gender:'男' });
  const c=db.characters.create({ name:'阿岚', gender:'女',
    persona:'美院三年级。说话略带漫不经心。',
    core:'说话简短，不解释。被追问时回避。' });
  const chat=db.chats.create({ characterIds:[c.id] });
  db.messages.create({ chatId:chat.id, role:'user', authorId:'me', kind:'text', content:'在吗', status:'done' });

  const { system } = eng.buildChatSystem(chat, c, db.messagesOf(chat.id));

  // 骨架正文一律英文（第 14 条）；开场白里一个字都不提说什么语言（第 16 条）
  ok('开头只剩一句身份',
    system.startsWith('You are 阿岚. You are texting 阿园 on a phone.'), system.slice(0,60));
  ok('开场白不替角色定语言',
    !/in Chinese|默认使用中文|Reply in/.test(system.slice(0,200)), system.slice(0,200));
  ok('删掉了「你不是AI助手」那句', !system.includes('你不是AI助手'), '还在');
  ok('删掉了「你不是在扮演角色」', !system.includes('扮演角色'));

  // 性别：首尾各一次
  const first=system.indexOf('[性别]');
  const last=system.lastIndexOf('[性别]');
  ok('性别块出现了', first>=0);
  ok('性别块出现了两次', last>first, `${first} / ${last}`);
  ok('第一次在最前面', first<200, first);
  ok('第二次在最后面', last>system.length-900, `${last} / ${system.length}`);
  ok('写了角色的性别', system.includes('阿岚：女'));
  ok('写了我的性别', system.includes('阿园：男'));
  ok('要求人称一致', system.includes('Use pronouns consistent with the genders stated above'),
    system.slice(0,300));

  // 没填就不写，不替用户猜
  const c2=db.characters.create({ name:'无名' });
  db.personas.update(me.id, { gender:'' });
  const chat2=db.chats.create({ characterIds:[c2.id] });
  const s2=eng.buildChatSystem(chat2, c2, []).system;
  ok('两边都没填就整段不出现', !s2.includes('[性别]'), '不该出现');
  // 只填一边
  db.characters.update(c2.id, { gender:'女' });
  const s3=eng.buildChatSystem(chat2, db.characters.get(c2.id), []).system;
  ok('只填一边就只写一边', s3.includes('无名：女') && !/：\s*$/m.test(s3.split('[性别]')[1].split('\n')[1]||''), '');
  db.personas.update(me.id, { name:'阿园', gender:'男' });

  // ---- 消息规则：只剩一条 ----
  //
  // **这一节曾经有九章**（回应焦点、关系立场、反应强度、分条断句、表达变化、
  // 话题承接……），连同示例与取舍顺序一并删掉了：那些是在替角色决定怎么做人，
  // 不是机器需要的格式规则（第 16 条）。
  //
  // 下面这几条断言守的正是「它不要再长回来」—— 已经删过两次了。
  ok('消息规则在', system.includes('[消息规则]'));
  ok('规则只剩分几条发', system.includes('Write each reply as 3 to 5 separate messages'),
    system.slice(system.indexOf('[消息规则]'), system.indexOf('[消息规则]')+200));
  const rules = system.slice(system.indexOf('[消息规则]')).split('\n\n')[0];
  ok('规则一节短到装不下判断', rules.length < 200, `${rules.length} 字：${rules}`);
  ok('九章消息规则没有长回来',
    !/一、分条|二、|三、关系|逗号与顿号处的停顿|允许不完整的句子|整体理解|不再追问|该条暂缓执行/.test(system),
    '有一条回来了');
  ok('旧的自然表达协议没了', !system.includes('自然表达协议'), '还在');
  ok('示例整段删掉了', !system.includes('[示例]'), '示例回来了');
  ok('取舍顺序整段删掉了',
    !system.includes('[冲突时的取舍]') && !system.includes('角色人设与核心设定'), '取舍顺序回来了');
  ok('不替它决定什么时候用某个功能',
    !/先想想|合不合适|多数时候|此时少说/.test(system), '混进了判断');

  // 核心设定与性别锚点收尾，贴着输出放
  ok('核心设定注入了', system.includes('[核心设定]') && system.includes('被追问时回避'));
  ok('核心设定排在消息规则之后',
    system.indexOf('[核心设定]')>system.indexOf('[消息规则]'));
  ok('性别锚点收在最后一段',
    system.trimEnd().endsWith('keep them consistent throughout.'), system.slice(-80));

  // 核心设定留空就不注入
  const s4=eng.buildChatSystem(chat2, db.characters.get(c2.id), []).system;
  ok('核心设定留空就不出现', !s4.includes('[核心设定]'));

  // 示例与自检那两个开关随着两段正文一起删了 —— 没有那两段，也就没有
  // 「要不要注入」这回事。剩下的只有一条：消息规则关不掉
  const s5=eng.buildChatSystem(chat, c, db.messagesOf(chat.id)).system;
  ok('消息规则关不掉，始终在', s5.includes('[消息规则]'));
  ok('输出前的自检那一段不在了', !s5.includes('[输出前的自检]'), '还在');

  return { R, chatId:chat.id, charId:c.id, len:system.length };
});
built.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 真发一轮：自检不能出现在对话里 ----
await page.evaluate(async ({chatId,charId}) => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const eng=await import('/src/system/ai/engine.js');
  const reply=await import('/src/system/ai/reply.js');
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:`${BASE}/v1`,apiKey:'k',model:'m'});
  const chat=db.chats.get(chatId), char=db.characters.get(charId);
  const raw=await eng.streamReply({ chat, char });
  await reply.renderTurn({ chat, char, raw, turnId:'t1', swipes:[raw], swipeIndex:0, instant:true });
}, built);
await page.waitForTimeout(500);

const after = await page.evaluate(async ({chatId}) => {
  const db=await import('/src/system/db/index.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const msgs=db.messagesOf(chatId).filter(m=>m.role==='char');
  ok('落库的是正文', msgs.map(m=>m.content).join('|')==='啊？|为什么', msgs.map(m=>m.content).join('|'));
  ok('自检一个字都没进消息', !msgs.some(m=>String(m.content).includes('thinking')||String(m.content).includes('先聊面试')), '');
  ok('自检挂在第一条上，排查时看得到', msgs[0].think.includes('先聊面试'), msgs[0].think);
  return R;
}, built);
after.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async ({charId}) => {
  const nav=await import('/src/system/nav.js'); nav.openApp('contact',`/edit/${charId}`);
}, built);
await page.waitForTimeout(700);
const edit = await page.locator('.app-layer').innerText();
ok('编辑资料页有核心设定', edit.includes('核心设定'), edit.slice(0,400));
ok('说明写了会在末尾再注入一次', edit.includes('末尾再注入一次'), edit.slice(0,900));

await page.evaluate(async () => {
  const acc=await import('/src/system/accounts.js');
  const nav=await import('/src/system/nav.js'); nav.openApp('contact',`/me/${acc.currentId()}`);
});
await page.waitForTimeout(700);
const mine = await page.locator('.app-layer').innerText();
ok('我的资料页有性别', mine.includes('性别'), mine.slice(0,400));
ok('说明写了它的用途', mine.includes('人称'), mine.slice(0,600));

await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat','/context');
});
// 等页面真的画出来，不按固定时长：完整跑的时候机器忙，600 毫秒不够，读到的是空白
await page.waitForFunction(() => /不可关闭/.test(document.querySelector('.app-layer')?.innerText || ''),
  null, { timeout: 8000 }).catch(() => {});
const ctx = await page.locator('.app-layer').innerText();
ok('上下文页上不再有示例与自检两个开关',
  !ctx.includes('输出前的自检') && !/示例/.test(ctx), ctx.slice(0,500));
ok('说明写了消息规则不可关闭', ctx.includes('不可关闭'), ctx.slice(0,900));
ok('说明写的是它只管分条', ctx.includes('只规定消息如何分条'), ctx.slice(0,1200));
ok('旧的自然表达协议从界面上消失了', !ctx.includes('自然表达协议'), '还在');
await page.screenshot({path:`${OUT}/skel-context.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
