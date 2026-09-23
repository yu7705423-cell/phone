import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const tr=await import('/src/system/transfer.js');
  const reply=await import('/src/system/ai/reply.js');
  const engine=await import('/src/system/ai/engine.js');
  const acc=await import('/src/system/accounts.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  db.personas.update(me.id,{name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});

  // ---- 金额 ----
  ok('两位小数收口', tr.format(0.1+0.2)==='0.30', tr.format(0.1+0.2));
  ok('非数字当 0', tr.money('abc')===0);
  let threw=''; try{ tr.send({chatId:chat.id,role:'user',authorId:'me',amount:0}); }catch(e){threw=e.message;}
  ok('金额为 0 发不出去', /大于/.test(threw), threw);
  // 不再有金额上限（CLAUDE.md 第 13 条）。发完就撤掉，免得这笔一直挂在待处理上。
  threw=''; let huge=null;
  try{ huge=tr.send({chatId:chat.id,role:'user',authorId:'me',amount:99999999}); }catch(e){threw=e.message;}
  ok('金额再大也发得出去', !threw && !!huge, threw);
  if (huge) db.messages.remove(huge.id);

  // ---- 用户发，角色收 ----
  const t1=tr.send({chatId:chat.id,role:'user',authorId:'me',amount:'88.005',note:'生日快乐'});
  ok('落成了转账消息', t1.kind==='transfer'&&t1.transfer==='pending'&&t1.amount===88.01, JSON.stringify(t1.amount));
  ok('上下文里写的是标记格式', t1.content==='[转账：88.01 生日快乐]', t1.content);
  ok('待处理的能被找出来', tr.pendingFrom(chat.id,'user')?.id===t1.id);
  ok('反方向找不到', tr.pendingFrom(chat.id,'char')===null);

  // 角色写 [收款]
  let made=await reply.renderTurn({chat,char:c,raw:'谢谢你\n[收款]',turnId:'t1',instant:true});
  const after1=db.messages.get(t1.id);
  ok('角色收下之后状态变了', after1.transfer==='taken', after1.transfer);
  ok('正文也跟着标上了', after1.content.includes('已被收下'), after1.content);
  ok('落了一行提示', made.some(m=>m.kind==='notice'), JSON.stringify(made.map(m=>m.kind)));
  const notice=made.find(m=>m.kind==='notice');
  ok('提示里两边名字都有', notice.content.includes('阿岚')&&notice.content.includes('小明')&&notice.content.includes('88.01'), notice.content);
  ok('[收款] 那一行不占气泡', made.filter(m=>m.kind==='text').length===1, JSON.stringify(made.map(m=>m.kind)));
  ok('处理过就不再是待处理', tr.pendingFrom(chat.id,'user')===null);

  // 重新生成整轮 -> 撤销这次处理
  reply.clearTurn(chat.id,'t1');
  ok('整轮撤掉之后回到待处理', db.messages.get(t1.id).transfer==='pending', db.messages.get(t1.id).transfer);
  ok('正文上的括号也去掉了', db.messages.get(t1.id).content==='[转账：88.01 生日快乐]', db.messages.get(t1.id).content);

  // 角色退回
  await reply.renderTurn({chat,char:c,raw:'这个我不能收\n[退回]',turnId:'t2',instant:true});
  ok('退回也认', db.messages.get(t1.id).transfer==='returned', db.messages.get(t1.id).transfer);
  ok('退回的提示写的是退回', db.messagesOf(chat.id).some(m=>m.kind==='notice'&&m.content.includes('退回了')));

  // 同一笔不会被处理两次
  const before=db.messagesOf(chat.id).filter(m=>m.kind==='notice').length;
  await reply.renderTurn({chat,char:c,raw:'[收款]',turnId:'t3',instant:true});
  ok('已经处理过的不会再处理一次',
    db.messagesOf(chat.id).filter(m=>m.kind==='notice').length===before, String(before));

  // ---- 角色发，用户收 ----
  const made2=await reply.renderTurn({chat,char:c,raw:'请你吃饭\n[转账：20 拿去买奶茶]',turnId:'t4',instant:true});
  const t2=made2.find(m=>m.kind==='transfer');
  ok('角色也能发起转账', !!t2 && t2.role==='char' && t2.amount===20, JSON.stringify(t2&&{r:t2.role,a:t2.amount}));
  ok('留言解析出来了', t2.note==='拿去买奶茶', t2.note);
  ok('待处理的方向是角色', tr.pendingFrom(chat.id,'char')?.id===t2.id);
  const n2=tr.settle(t2.id,true);
  ok('用户收下', db.messages.get(t2.id).transfer==='taken');
  ok('也落了一行提示，是用户这边的', n2.kind==='notice'&&n2.role==='user', JSON.stringify({k:n2.kind,r:n2.role}));
  ok('提示写清了谁收了谁的', n2.content.includes('小明收下了阿岚的转账'), n2.content);

  // 删掉提示行 = 撤销
  reply.dropMessage(n2.id);
  ok('删掉提示行就回到待处理', db.messages.get(t2.id).transfer==='pending');

  // ---- 解析 ----
  const p=reply.splitReply('[转账：¥12.5 给你]');
  ok('带货币符号也认', p.length===1&&p[0].type==='transfer'&&p[0].amount===12.5, JSON.stringify(p));
  const p2=reply.splitReply('[转账：一百块]');
  ok('金额读不出来整条丢掉', p2.length===0, JSON.stringify(p2));
  const p3=reply.splitReply('我想退回老家看看');
  ok('正常句子里的退回不算指令', p3.length===1&&p3[0].type==='text', JSON.stringify(p3));
  const p4=reply.splitReply('[退回]');
  ok('单独成行带括号才算', p4.length===1&&p4[0].type==='settle'&&p4[0].take===false, JSON.stringify(p4));
  const p5=reply.splitReply('[收下]');
  ok('收下也当收款', p5[0]?.take===true, JSON.stringify(p5));

  // ---- prompt 注入 ----
  const sys1=engine.buildChatSystem(chat,c,db.messagesOf(chat.id),{}).system;
  // 标记名留中文（它是协议），说明文字改成了英文（第 14 条）
  ok('开着就注入转账说明', sys1.includes('[转账：amount note]'), sys1.slice(0, 200));
  db.characters.update(c.id,{canTransfer:false});
  const sys2=engine.buildChatSystem(chat,db.characters.get(c.id),db.messagesOf(chat.id),{}).system;
  ok('关掉就不注入', !sys2.includes('[转账：amount note]'));
  db.characters.update(c.id,{canTransfer:true});

  return { results:R, chat:chat.id, char:c.id };
});
out.results.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat',`/chat/${id}`);
}, out.chat);
await page.waitForTimeout(900);
ok('转账气泡画出来了', await page.locator('.bubble-transfer').count()>=2,
  String(await page.locator('.bubble-transfer').count()));
ok('提示行也在', await page.locator('.conv-notice').count()>=1);
await page.screenshot({path:`${OUT}/m1-bubbles.png`});

// 点对方那笔待处理的
await page.locator('.msg:not(.is-mine) .bubble-transfer').last().click();
await page.waitForTimeout(500);
const sheet = await page.locator('.sheet').innerText().catch(()=>'');
ok('点开了处理面板', sheet.includes('收款')&&sheet.includes('退回'), sheet.slice(0,120));
await page.screenshot({path:`${OUT}/m2-settle.png`});
await page.getByText('退回',{exact:true}).click();
await page.waitForTimeout(600);
const state = await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  const t=db.messagesOf(id).filter(m=>m.kind==='transfer');
  return t[t.length-1].transfer;
}, out.chat);
ok('点退回真的退回了', state==='returned', state);

// 自己那笔点不动
const mineBefore = await page.evaluate(()=>document.querySelectorAll('.sheet').length);
await page.locator('.msg.is-mine .bubble-transfer').first().click();
await page.waitForTimeout(400);
ok('自己发的那张点不开处理面板', await page.locator('.sheet').count()===mineBefore);

// 面板：语音只剩一个入口，红包换成转账
await page.locator('.composer-side').first().click();
await page.waitForTimeout(400);
const panel = await page.locator('.panel-grid').innerText();
ok('面板里没有「写成语音」了', !panel.includes('写成语音'), panel);
ok('面板里有语音', panel.includes('语音'), panel);
ok('红包改成了转账', panel.includes('转账')&&!panel.includes('红包'), panel);
await page.screenshot({path:`${OUT}/m3-panel.png`});

await page.getByText('转账',{exact:true}).click();
await page.waitForTimeout(500);
ok('转账面板打开了', (await page.locator('.sheet').innerText()).includes('金额'));
await page.locator('.sheet input[type=number]').fill('66.6');
await page.locator('.sheet input').nth(1).fill('请你喝奶茶');
await page.waitForTimeout(300);
await page.screenshot({path:`${OUT}/m4-send.png`});
await page.locator('.sheet button').filter({hasText:'转账'}).last().click();
await page.waitForTimeout(700);
const sent = await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  const l=db.messagesOf(id); const m=l[l.length-1];
  return { kind:m.kind, amount:m.amount, note:m.note, state:m.transfer, role:m.role };
}, out.chat);
ok('发出去了一笔 66.60', sent.kind==='transfer'&&sent.amount===66.6&&sent.role==='user', JSON.stringify(sent));
ok('留言存下来了', sent.note==='请你喝奶茶', sent.note);
await page.screenshot({path:`${OUT}/m5-after.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
