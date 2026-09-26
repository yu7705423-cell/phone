// 批 4：面板排序与「更多」、点外卖、共享位置
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
await page.route('**/chat/completions', r=>r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({choices:[{message:{content:'好'}}]})}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 面板排序 ----
const p = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const panel=await import('/src/system/panel.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  panel.reset();

  const all=panel.ITEMS.map(x=>x.id);
  ok('顺序一开始就是全部', panel.order().join()===all.join(), panel.order().join());
  // 默认收进「更多」的现在是五格（video/share/dice/request/makeclip）
  ok('默认收了几格进更多', panel.onPanel().length===all.length-6, panel.onPanel().length);
  ok('收进去的确实不在面板上', !panel.onPanel().includes('dice'));

  // 丢掉不认识的、补上缺失的 —— 老配置里少一格不能静默丢掉
  db.settings.set({panelOrder:['dice','根本没有这一格','photo']});
  const o=panel.order();
  ok('不认识的 id 丢掉', !o.includes('根本没有这一格'), o.join());
  ok('配置里写了的排在前面', o.slice(0,2).join()==='dice,photo', o.slice(0,3).join());
  ok('缺的全补回来了', o.length===all.length && all.every(x=>o.includes(x)), o.length);
  panel.reset();

  // 挪
  const before=panel.order();
  panel.move(before[2],-1);
  const after=panel.order();
  ok('上移换了位置', after[1]===before[2] && after[2]===before[1], `${before.slice(0,3)} -> ${after.slice(0,3)}`);
  panel.move(after[1],1);
  ok('下移换回来了', panel.order().join()===before.join());
  ok('第一个再往上不动', (()=>{const b=panel.order();panel.move(b[0],-1);return panel.order().join()===b.join();})());
  ok('最后一个再往下不动', (()=>{const b=panel.order();panel.move(b[b.length-1],1);return panel.order().join()===b.join();})());

  // 进出更多不改顺序 —— 这正是顺序和「在不在面板上」分开存的理由
  const ord=panel.order();
  panel.setMore('photo', true);
  ok('收进更多之后不在面板上', !panel.onPanel().includes('photo'));
  panel.setMore('photo', false);
  ok('挪回来还在原来的位置', panel.order().join()===ord.join() && panel.onPanel()[0]==='photo',
    panel.onPanel().slice(0,2).join());

  db.settings.set({panelMore:[]});
  ok('设成空数组就是全都放面板上', panel.onPanel().length===all.length, panel.onPanel().length);
  panel.reset();
  ok('恢复默认回得去', panel.onPanel().length===all.length-6, panel.onPanel().length);
  return R;
});
p.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 共享位置：距离本地算 ----
const g = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const geo=await import('/src/system/geo.js');
  const blocks=await import('/src/system/ai/context/index.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  db.personas.update(me.id,{name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});

  const cd=geo.CITIES.find(x=>x.name==='成都'), sh=geo.CITIES.find(x=>x.name==='上海');
  const km=geo.distance(cd,sh);
  // 成都到上海直线约 1660 公里，误差给宽一点
  ok('haversine 算得对', km>1600 && km<1720, km);
  ok('自己到自己是 0', geo.distance(cd,cd)<0.001, geo.distance(cd,cd));
  ok('缺坐标就给 null，不猜', geo.distance({place:'某地'},sh)===null);
  ok('坐标越界当没有', geo.distance({lat:999,lng:0},sh)===null);
  ok('一公里以内说米', geo.distanceText(0.32)==='320 米', geo.distanceText(0.32));
  ok('十公里以内带一位小数', geo.distanceText(4.26)==='4.3 公里', geo.distanceText(4.26));
  ok('再远就取整', geo.distanceText(1660.4)==='1660 公里', geo.distanceText(1660.4));
  ok('没有距离就给空串', geo.distanceText(null)==='');

  ok('默认关着', !geo.isOn(db.chats.get(chat.id)));
  ok('没开就没有摘要', geo.summary(chat.id)===null);
  geo.setOn(chat.id,true);
  ok('开了但两端都没填，还是没有', geo.summary(chat.id)===null);
  geo.setSpot(chat.id,'me',{place:'成都',lat:cd.lat,lng:cd.lng});
  ok('只填一端也不算', geo.summary(chat.id)===null);
  geo.setSpot(chat.id,'char',{place:'上海',lat:sh.lat,lng:sh.lng});
  const sum=geo.summary(chat.id);
  ok('两端都填了才算得出', !!sum && sum.text.includes('公里'), JSON.stringify(sum&&sum.text));
  ok('开关和坐标都存在会话上', geo.stateOf(db.chats.get(chat.id)).me.place==='成都');

  const ctx={chat:db.chats.get(chat.id),char:c,messages:[],persona:db.personas.get(me.id),settings:db.settings.get()};
  const t=blocks.BLOCKS.geo.build(ctx);
  ok('注入块拼得出来', t.includes('[你们隔多远]'), t.slice(0,40));
  ok('把算好的数写进去了', t.includes(sum.text), t);
  // 注进 prompt 的句子一律英文（第 14 条），区块抬头仍是中文
  ok('明说了别自己改这个数', t.includes('Do not substitute another figure'), t);
  ok('两边地名都写了', t.includes('成都') && t.includes('上海'));

  // 只有地名没坐标：明说说不出多远，别编
  geo.setSpot(chat.id,'char',{place:'一个没坐标的地方'});
  const t2=blocks.BLOCKS.geo.build({...ctx,chat:db.chats.get(chat.id)});
  ok('没坐标时明说不要编', t2.includes('Do not state a specific figure'), t2);
  ok('没坐标时一个数字都不给', !/\d+\s*(公里|米)/.test(t2), t2);
  geo.setSpot(chat.id,'char',{place:'上海',lat:sh.lat,lng:sh.lng});

  geo.setOn(chat.id,false);
  ok('关掉就一个字都不注入', blocks.BLOCKS.geo.build({...ctx,chat:db.chats.get(chat.id)})==='');
  geo.setOn(chat.id,true);
  return { R, chatId:chat.id, charId:c.id };
});
g.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 点外卖 ----
const t = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const to=await import('/src/system/takeout.js');
  const reply=await import('/src/system/ai/reply.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=db.chats.get(ids.chatId), char=db.characters.get(ids.charId);

  // 三档
  const a=to.order({chatId:chat.id,role:'user',authorId:'me',kind:to.SELF,item:'麻辣烫',amount:32});
  ok('自己点的一落库就完了', a.takeout===to.TAKEN, a.takeout);
  ok('自己点的正文里没有状态', a.content==='[外卖：麻辣烫 32.00]', a.content);
  const b=to.order({chatId:chat.id,role:'user',authorId:'me',kind:to.TREAT,item:'奶茶',amount:18});
  ok('请客要等对方表态', b.takeout===to.PENDING && b.content==='[请客：奶茶 18.00]', b.content);
  const cc=to.order({chatId:chat.id,role:'user',authorId:'me',kind:to.ASK,item:'炸鸡',amount:45});
  ok('代付也要等', cc.takeout===to.PENDING && cc.content==='[代付：炸鸡 45.00]', cc.content);

  ok('不写吃的会拦住', (()=>{try{to.order({chatId:chat.id,role:'user',authorId:'me',item:' '});return false;}catch{return true;}})());
  ok('不认识的点法会拦住', (()=>{try{to.order({chatId:chat.id,role:'user',authorId:'me',kind:'乱写',item:'x'});return false;}catch{return true;}})());
  ok('负数金额会拦住', (()=>{try{to.order({chatId:chat.id,role:'user',authorId:'me',item:'x',amount:-1});return false;}catch{return true;}})());

  // 待处理的只找得到最近那一单
  ok('找得到待处理的', to.pendingFrom(chat.id,'user')?.id===cc.id);
  ok('反方向找不到', to.pendingFrom(chat.id,'char')===null);
  ok('自己点的那一单不算待处理', to.pendingFrom(chat.id,'user')?.id!==a.id);

  // 表态
  const n1=to.settle(b.id,true);
  ok('收下之后状态变了', db.messages.get(b.id).takeout===to.TAKEN);
  ok('正文跟着标上', db.messages.get(b.id).content.includes('已被收下'), db.messages.get(b.id).content);
  ok('落了一行提示', n1?.kind==='notice' && n1.content.includes('收下了'), n1&&n1.content);
  ok('提示里两边名字都在', n1.content.includes('阿岚')&&n1.content.includes('小明'), n1.content);
  ok('同一单不处理两次', to.settle(b.id,true)===null);
  const n2=to.settle(cc.id,false);
  ok('代付拒绝写的是没有替', n2.content.includes('没有替'), n2.content);

  // 提示行被删就当没表过态
  reply.dropMessage(n1.id);
  ok('删掉提示行回到待处理', db.messages.get(b.id).takeout===to.PENDING);
  ok('正文也退回去', db.messages.get(b.id).content==='[请客：奶茶 18.00]', db.messages.get(b.id).content);

  // 解析：最后一个数是金额，前面全是吃的
  ok('多个空格也切得对', JSON.stringify(to.parse('香辣鸡腿堡 套餐 32'))==='{"item":"香辣鸡腿堡 套餐","amount":32}',
    JSON.stringify(to.parse('香辣鸡腿堡 套餐 32')));
  ok('带货币符号也认', to.parse('奶茶 ¥18').amount===18, JSON.stringify(to.parse('奶茶 ¥18')));
  ok('带「元」也认', to.parse('炸鸡 45元').amount===45);
  ok('没写金额就当 0', JSON.stringify(to.parse('一份沙拉'))==='{"item":"一份沙拉","amount":0}',
    JSON.stringify(to.parse('一份沙拉')));

  // 模型写的那几行
  ok('[外卖] 解析出来了', reply.splitReply('[外卖：小面 12]')[0]?.kind===to.SELF);
  ok('[请客] 是给对方点', reply.splitReply('[请客：小面 12]')[0]?.kind===to.TREAT);
  ok('[代付] 是让对方付', reply.splitReply('[代付：小面 12]')[0]?.kind===to.ASK);
  ok('[要了] 和 [不要] 都认',
    reply.splitReply('[要了]')[0]?.type==='meal' && reply.splitReply('[不要]')[0]?.take===false,
    JSON.stringify(reply.splitReply('[要了]')));
  // 「收下」归转账。共用一个词的话，外卖这一单会被当成转账去处理，
  // 那边没有待处理的转账，于是什么都没发生，还不报错
  ok('[收下] 仍然归转账，不抢外卖', reply.splitReply('[收下]')[0]?.type==='settle',
    JSON.stringify(reply.splitReply('[收下]')));
  ok('吃什么读不出来就整条丢掉', reply.splitReply('[外卖： ]').length===0, JSON.stringify(reply.splitReply('[外卖： ]')));

  await reply.renderTurn({chat,char,raw:'给你点了一份\n[请客：小蛋糕 26]',turnId:'k1',instant:true});
  const mine=to.pendingFrom(chat.id,'char');
  ok('角色请客落成了一单', !!mine && mine.item==='小蛋糕', JSON.stringify(mine&&mine.item));
  await reply.renderTurn({chat,char,raw:'那我就不客气了\n[要了]',turnId:'k2',instant:true});
  ok('角色处理的是我点的那一单', db.messages.get(b.id).takeout===to.TAKEN, db.messages.get(b.id).takeout);
  return R;
}, g);
t.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 能力目录 ----
const cap = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const caps=await import('/src/system/ai/capabilities.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const build=()=>caps.capabilityBlock({chat:db.chats.get(ids.chatId),
    char:db.characters.get(ids.charId),messages:[],settings:db.settings.get()});
  db.settings.set({promptLean:true});
  ok('冷着只给一行', build().includes('Order delivery: [外卖：item amount]'), build().slice(0,300));
  const hot=caps.capabilityBlock({chat:db.chats.get(ids.chatId),char:db.characters.get(ids.charId),
    messages:db.messagesOf(ids.chatId),settings:db.settings.get()});
  ok('挂着一单没处理就给细则', hot.includes('An order they placed for you requires a response'),
    hot.slice(0,200));
  db.characters.update(ids.charId,{canTakeout:false});
  ok('角色卡上关掉就一个字不提', !build().includes('外卖'));
  db.characters.update(ids.charId,{canTakeout:true});
  return R;
}, g);
cap.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat',`/chat/${id}`);
}, g.chatId);
await page.waitForTimeout(900);
ok('外卖在会话里有气泡', await page.locator('.bubble-meal').count()>=1, await page.locator('.bubble-meal').count());
await page.locator('.composer-side').first().click();
await page.waitForTimeout(500);
const cells = await page.locator('.panel-item').count();
ok('面板上是用户排的那几格加一个更多', cells===12, cells);
const labels = await page.locator('.panel-item').allInnerTexts();
ok('最后一格是更多', labels[labels.length-1].includes('更多'), labels.join('/'));
ok('默认收起来的那几格不在面板上', !labels.join('').includes('骰子'), labels.join('/'));
await page.screenshot({path:`${OUT}/pn-panel.png`});

await page.locator('.panel-item').last().click();
await page.waitForTimeout(500);
const moreText = await page.locator('.overlay').innerText();
ok('更多里列出了全部', moreText.includes('骰子')&&moreText.includes('图片')&&moreText.includes('共享位置'),
  moreText.slice(0,200));
ok('每一项写明了在哪儿', moreText.includes('在面板上')&&moreText.includes('收在更多里'));
ok('说明里写了没有上限', moreText.includes('没有上限'), moreText.slice(0,160));
await page.screenshot({path:`${OUT}/pn-more.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
