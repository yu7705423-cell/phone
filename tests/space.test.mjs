// 批 1 情侣空间
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
await page.route('**/chat/completions', async r => {
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'好'}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const space=await import('/src/system/space.js');
  const reply=await import('/src/system/ai/reply.js');
  const caps=await import('/src/system/ai/capabilities.js');
  const blocks=await import('/src/system/ai/context/index.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});

  // ---- 空间本身 ----
  ok('单人会话就是一个空间', !!space.spaceOf(chat.id), String(!!space.spaceOf(chat.id)));
  const group=db.chats.create({characterIds:[c.id,db.characters.create({name:'乙'}).id],personaId:me.id});
  ok('群聊不算空间', space.spaceOf(group.id)===null);
  ok('列表里有它', space.spacesOf(me.id).some(x=>x.chat.id===chat.id));

  // 换一个人设，看到的是那个人设的空间
  const alt=acc.createAlt(me.id,{name:'小号'});
  const chat2=db.chats.create({characterIds:[c.id],personaId:alt.id});
  ok('小号的空间只属于小号',
    space.spacesOf(alt.id).length===1 && space.spacesOf(alt.id)[0].chat.id===chat2.id,
    JSON.stringify(space.spacesOf(alt.id).map(x=>x.chat.id)));
  ok('大号看不到小号那一个', !space.spacesOf(me.id).some(x=>x.chat.id===chat2.id));

  // ---- 在一起多少天 ----
  ok('没设起始日就是没有', space.togetherDays(db.chats.get(chat.id))===null);
  const start=new Date(); start.setHours(0,0,0,0);
  space.setStart(chat.id, start.getTime()-86400000*9);
  ok('第十天', space.togetherDays(db.chats.get(chat.id))===10, space.togetherDays(db.chats.get(chat.id)));
  space.setStart(chat.id, start.getTime());
  ok('今天开始就是第一天', space.togetherDays(db.chats.get(chat.id))===1);

  // ---- 纪念日 ----
  const y=new Date().getFullYear();
  const pad=n=>String(n).padStart(2,'0');
  const dstr=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const soonD=new Date(start.getTime()+86400000*3);
  const d1=space.addDay({chatId:chat.id,title:'三天后',date:dstr(soonD),yearly:true});
  ok('还有三天', space.leftDays(d1)===3, space.leftDays(d1));
  // 去年的同一天，每年重复 -> 滚到今年或明年，永远不是负的
  const past=new Date(start.getTime()-86400000*10);
  const d2=space.addDay({chatId:chat.id,title:'十天前',date:dstr(past),yearly:true});
  ok('每年重复的滚到下一次', space.leftDays(d2)>0, space.leftDays(d2));
  const d3=space.addDay({chatId:chat.id,title:'只过一次',date:dstr(past),yearly:false});
  ok('不重复的过了就是过了', space.leftDays(d3)<0, space.leftDays(d3));
  const up=space.upcoming(chat.id);
  ok('排序把过期的甩到最后', up[up.length-1].item.id===d3.id, JSON.stringify(up.map(x=>x.item.title)));
  ok('填错日期会拦住', (()=>{try{space.addDay({chatId:chat.id,title:'x',date:'乱写'});return false;}catch{return true;}})());
  ok('不写名字会拦住', (()=>{try{space.addDay({chatId:chat.id,title:'',date:'2026-01-01'});return false;}catch{return true;}})());

  // ---- 约定 ----
  const p1=space.makePact({chatId:chat.id,role:'user',authorId:'me',title:'一起去看海'});
  ok('约定是一条消息', db.messages.get(p1.id)?.kind==='pact');
  ok('正文里带着它', p1.content==='[约定：一起去看海]', p1.content);
  ok('默认未完成', p1.pact===space.PACT_OPEN);
  const notice=space.completePact(p1.id);
  ok('完成后落了一行提示', notice?.kind==='notice', JSON.stringify(notice&&notice.kind));
  ok('正文改成已完成', db.messages.get(p1.id).content==='[约定：一起去看海]（已完成）',
    db.messages.get(p1.id).content);
  ok('同一条不会完成两次', space.completePact(p1.id)===null);
  reply.dropMessage(notice.id);
  ok('删掉提示行就回到未完成', db.messages.get(p1.id).pact===space.PACT_OPEN,
    db.messages.get(p1.id).pact);
  ok('正文也跟着退回去', db.messages.get(p1.id).content==='[约定：一起去看海]');

  // ---- 信 ----
  const dr=space.saveDraft({chatId:chat.id,title:'还没寄',body:'想说又没说的话'});
  ok('草稿不是消息', space.letters(chat.id).length===0 && space.drafts(chat.id).length===1);
  const sent=space.sendDraft(dr.id);
  ok('寄出之后变成一条消息', sent?.kind==='letter' && space.drafts(chat.id).length===0,
    JSON.stringify({k:sent&&sent.kind,d:space.drafts(chat.id).length}));
  ok('信的正文进了 content', sent.content.includes('想说又没说的话'), sent.content);
  ok('空信寄不出去', (()=>{try{space.sendLetter({chatId:chat.id,role:'user',authorId:'me',body:' '});return false;}catch{return true;}})());

  // 约定和信的正文是固定格式，气泡显示的是各自的字段。改正文改不动字段，
  // 所以这两种既不给「编辑」也不给「修格式」伸手 —— 和转账、礼物同一份名单。
  const repair=await import('/src/system/ai/repair.js');
  ok('约定不给修格式', repair.STRUCTURED.has('pact') && repair.fixesFor(db.messages.get(p1.id)).length===0);
  ok('信不给修格式', repair.STRUCTURED.has('letter') && repair.fixesFor(db.messages.get(sent.id)).length===0);
  const starry=space.makePact({chatId:chat.id,role:'char',authorId:c.id,title:'*一起去看海*'});
  ok('正文里带星号的约定也不给动', repair.fixesFor(db.messages.get(starry.id)).length===0,
    JSON.stringify(repair.fixesFor(db.messages.get(starry.id)).map(f=>f.id)));
  db.messages.remove(starry.id);

  return { R, chatId: chat.id, charId: c.id, meId: me.id, altChatId: chat2.id, pactId: p1.id };
});
out.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 模型写的那几行 ----
const mk = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const reply=await import('/src/system/ai/reply.js');
  const space=await import('/src/system/space.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=db.chats.get(ids.chatId), char=db.characters.get(ids.charId);

  const parts=reply.splitReply('那就说定了\n[约定：每天十一点前睡]');
  ok('[约定] 解析出来了', JSON.stringify(parts.map(p=>p.type))==='["text","pact"]',
    JSON.stringify(parts.map(p=>p.type)));
  const p2=reply.splitReply('[约定完成：每天十一点前睡]');
  ok('[约定完成] 不会被 [约定] 吃掉', p2[0]?.type==='pactdone' && p2[0].title==='每天十一点前睡',
    JSON.stringify(p2));
  const p3=reply.splitReply('[信：给你 | 今天路过那家店，想起你说过喜欢]');
  ok('[信] 拆出标题和正文',
    p3[0]?.type==='letter' && p3[0].title==='给你' && p3[0].text.startsWith('今天路过'),
    JSON.stringify(p3));
  const p4=reply.splitReply('[信：没有抬头的一封]');
  ok('不写竖线就整段是正文', p4[0]?.type==='letter' && p4[0].title==='' && p4[0].text==='没有抬头的一封',
    JSON.stringify(p4));

  const before=space.pacts(chat.id).length;
  await reply.renderTurn({chat,char,raw:'那就说定了\n[约定：每天十一点前睡]',turnId:'t1',instant:true});
  ok('角色立的约定记下来了', space.pacts(chat.id).length===before+1);
  const made=space.pacts(chat.id).find(m=>m.title==='每天十一点前睡');
  ok('记在角色名下', made?.role==='char' && made.authorId===char.id, JSON.stringify(made&&made.role));

  await reply.renderTurn({chat,char,raw:'做到了\n[约定完成：十一点前睡]',turnId:'t2',instant:true});
  ok('说一小段也认得出是哪条', db.messages.get(made.id).pact===space.PACT_DONE,
    db.messages.get(made.id).pact);

  const n0=db.messagesOf(chat.id).filter(m=>m.kind==='notice').length;
  await reply.renderTurn({chat,char,raw:'[约定完成：根本没有这一条]',turnId:'t3',instant:true});
  ok('认不出来就不乱标', db.messagesOf(chat.id).filter(m=>m.kind==='notice').length===n0,
    db.messagesOf(chat.id).filter(m=>m.kind==='notice').length);

  const L=space.letters(chat.id).length;
  await reply.renderTurn({chat,char,raw:'[信：给你 | 今天路过那家店]',turnId:'t4',instant:true});
  ok('角色写的信进了信箱', space.letters(chat.id).length===L+1);
  ok('信记在角色名下', space.letters(chat.id).slice(-1)[0].role==='char');

  return R;
}, out);
mk.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 注入与能力目录 ----
const inj = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const space=await import('/src/system/space.js');
  const blocks=await import('/src/system/ai/context/index.js');
  const engine=await import('/src/system/ai/engine.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=db.chats.get(ids.chatId), char=db.characters.get(ids.charId);

  ok('space 是一个注入块', !!blocks.BLOCKS.space && blocks.DEFAULT_ORDER.includes('space'));
  const ctx={chat,char,messages:[],persona:db.personas.get(ids.meId),settings:db.settings.get()};

  space.setInject(chat.id,false);
  ok('默认不注入', blocks.BLOCKS.space.build(ctx)==='', blocks.BLOCKS.space.build(ctx));
  space.setInject(chat.id,true);
  const text=blocks.BLOCKS.space.build(ctx);
  ok('开了才有这一段', text.includes('[你们之间]'), text);
  ok('写了在一起第几天', /This is day \d+ of your relationship/.test(text), text);
  ok('写了快到的纪念日', text.includes('三天后'), text);
  ok('写了没完成的约定', text.includes('一起去看海'), text);
  ok('已完成的不写', !text.includes('十一点前睡'), text);
  ok('过期的纪念日不写', !text.includes('只过一次'), text);
  ok('信的正文不重复注入', !text.includes('想说又没说'), text);

  // 能力目录：冷的时候只有一行，挂着未完成的约定就必须是热的
  db.settings.set({promptLean:true});
  const cold=caps0=>caps0;
  const capsMod=await import('/src/system/ai/capabilities.js');
  const coldText=capsMod.capabilityBlock({chat,char,messages:[],settings:db.settings.get()});
  ok('冷着只给目录那一行',
    coldText.includes('Make a promise: write a line on its own') && !coldText.includes('[约定]\nWhen the two of you settle'),
    coldText.slice(0,200));
  const hotText=capsMod.capabilityBlock({chat,char,messages:db.messagesOf(chat.id),settings:db.settings.get()});
  ok('挂着未完成的约定就给细则',
    hotText.includes('When the two of you settle on something to do later'), hotText.slice(0,200));
  ok('信冷着也只有一行', coldText.includes('Write a letter: write a line on its own'));

  // 角色卡上能关掉
  db.characters.update(char.id,{canPact:false,canWriteLetter:false});
  const offText=capsMod.capabilityBlock({chat,char:db.characters.get(char.id),messages:[],settings:db.settings.get()});
  ok('关掉之后一个字都不提', !offText.includes('立约定') && !offText.includes('写一封信'));
  db.characters.update(char.id,{canPact:true,canWriteLetter:true});

  return R;
}, out);
inj.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 统计与清理 ----
const st = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const space=await import('/src/system/space.js');
  const gift=await import('/src/system/gift.js');
  const place=await import('/src/system/place.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=db.chats.get(ids.chatId), char=db.characters.get(ids.charId);

  gift.send({chatId:chat.id,role:'char',authorId:char.id,cover:'一盒糖',inner:'一张纸条'});
  place.send({chatId:chat.id,role:'user',authorId:'me',place:'海边',address:'滨海路 1 号'});
  db.chats.update(chat.id,{listenSeconds:1830,listenCount:7});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'call',
    direction:'out',outcome:'done',seconds:95,callKind:'voice',content:'[通话]',status:'done'});

  const s=space.stats(chat.id);
  ok('礼物数对', s.gifts===1, s.gifts);
  ok('地点数对', s.places===1, s.places);
  ok('通话数对', s.calls===1, s.calls);
  ok('一起听的累积读的是会话上那份', s.listenCount===7 && s.listenSeconds===1830, JSON.stringify(s));
  ok('礼物墙就是那几条消息', space.recordsOf(chat.id,'gift').length===1);
  ok('不认识的类别给空', space.recordsOf(chat.id,'text').length===0);

  // 礼物没拆开，正文里不许有里面是什么（第 13 条之外的老规矩，顺手再钉一遍）
  const g=space.recordsOf(chat.id,'gift')[0];
  ok('没拆开的礼物正文里没有内容物', !g.content.includes('纸条'), g.content);

  // 删会话时纪念日和草稿跟着走
  const tmp=db.chats.create({characterIds:chat.characterIds,personaId:'tmp'});
  space.saveDraft({chatId:tmp.id,title:'x',body:'y'});
  const n=db.spaceItems.byIndex(tmp.id).length;
  ok('spaceItems 里确实有东西', n>0, n);
  const purge=await import('/src/system/purge.js');
  purge.dropChat(tmp.id);
  ok('删会话之后空间里一条不剩', db.spaceItems.byIndex(tmp.id).length===0 && !db.chats.has(tmp.id));

  return R;
}, out);
st.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('space','/');
});
await page.waitForTimeout(700);
const homeText = await page.locator('.app-layer').innerText();
ok('空间列表打得开', homeText.includes('情侣空间'), homeText.slice(0,60));
ok('列出了角色', homeText.includes('阿岚'), homeText.slice(0,120));

await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.openApp('space',`/space/${id}`);
}, out.chatId);
await page.waitForTimeout(700);
const spText = await page.locator('.app-layer').innerText();
ok('空间页打得开', spText.includes('纪念日') && spText.includes('约定') && spText.includes('信箱'), spText.slice(0,200));
ok('四个数字都在', spText.includes('礼物') && spText.includes('去过') && spText.includes('一起听') && spText.includes('通话'));
ok('在一起的天数露在头上', /\d+\s*在一起的天数/.test(spText.replace(/\n/g,' ')), spText.slice(0,160));
ok('人设正文一个字都没露', !spText.includes('人设'), spText.slice(0,200));
await page.screenshot({path:`${OUT}/sp-space.png`});

await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.openApp('space',`/log/${id}/gift`);
}, out.chatId);
await page.waitForTimeout(600);
const wall = await page.locator('.app-layer').innerText();
ok('礼物墙打得开', wall.includes('礼物墙') && wall.includes('一盒糖'), wall.slice(0,160));
ok('礼物墙上没剧透内容物', !wall.includes('纸条'), wall.slice(0,200));

await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.openApp('space',`/mail/${id}`);
}, out.chatId);
await page.waitForTimeout(600);
const mail = await page.locator('.app-layer').innerText();
ok('信箱打得开', mail.includes('信箱'), mail.slice(0,80));
ok('已寄出的在里面', mail.includes('给你'), mail.slice(0,200));
await page.screenshot({path:`${OUT}/sp-mail.png`});

// 会话里那两个气泡
await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat',`/chat/${id}`);
}, out.chatId);
await page.waitForTimeout(900);
ok('约定在会话里有气泡', await page.locator('.bubble-pact').count()>=1,
  await page.locator('.bubble-pact').count());
ok('信在会话里有气泡', await page.locator('.bubble-letter').count()>=1,
  await page.locator('.bubble-letter').count());
ok('完成的约定划掉了', await page.locator('.bubble-pact.is-done').count()>=1,
  await page.locator('.bubble-pact.is-done').count());
await page.locator('.bubble-letter').last().click();   // 最后那封是角色写的
await page.waitForTimeout(500);
ok('点开能读到信', (await page.locator('.sp-letter').innerText()).includes('路过那家店'),
  await page.locator('.sp-letter').innerText().catch(()=>''));
await page.screenshot({path:`${OUT}/sp-conv.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
