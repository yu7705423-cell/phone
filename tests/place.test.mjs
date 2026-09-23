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
  const cur=await import('/src/system/currency.js');
  const tr=await import('/src/system/transfer.js');
  const pl=await import('/src/system/place.js');
  const reply=await import('/src/system/ai/reply.js');
  const engine=await import('/src/system/ai/engine.js');
  const acc=await import('/src/system/accounts.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  db.personas.update(me.id,{name:'小明'});
  const c=db.characters.create({name:'阿岚',timezone:'Asia/Tokyo'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});

  // ---- 货币 ----
  cur.set('CNY');
  ok('默认人民币两位小数', tr.format(12.3)==='12.30' && tr.display(12.3)==='¥12.30', tr.display(12.3));
  cur.set('JPY');
  ok('日元不留小数', tr.format(1200.4)==='1200' && tr.display(1200.4)==='¥1200', tr.display(1200.4));
  ok('日元落库时也收成整数', tr.money(88.6)===89, String(tr.money(88.6)));
  cur.set('USD');
  ok('美元符号在前', tr.display(9.5)==='$9.50', tr.display(9.5));
  cur.set('none');
  ok('可以不显示符号', tr.display(9.5)==='9.50', tr.display(9.5));
  cur.set('xxx');
  ok('不认识的币种回落到人民币', cur.current().code==='CNY', cur.current().code);

  cur.set('JPY');
  const t=tr.send({chatId:chat.id,role:'user',authorId:'me',amount:'3000.7',note:'路费'});
  ok('日元下发出去的是整数', t.amount===3001 && t.content==='[转账：3001 路费]', t.content);
  ok('上下文里不带货币符号', !/[¥$]/.test(t.content), t.content);
  ok('币种记在这一笔上', t.currency==='JPY', t.currency);
  cur.set('CNY');
  ok('改了设置也不动已经发出去的那笔',
    tr.display(db.messages.get(t.id).amount, db.messages.get(t.id).currency)==='¥3001',
    tr.display(t.amount, db.messages.get(t.id).currency));
  ok('新发的才按新币种',
    tr.send({chatId:chat.id,role:'user',authorId:'me',amount:'5.5'}).currency==='CNY');

  // ---- 位置解析 ----
  ok('第一个空格前是地点名',
    JSON.stringify(pl.parse('城市图书馆 和平路 128 号'))==='{"place":"城市图书馆","address":"和平路 128 号"}',
    JSON.stringify(pl.parse('城市图书馆 和平路 128 号')));
  ok('没有空格就只有地点名',
    JSON.stringify(pl.parse('北京朝阳区某某咖啡'))==='{"place":"北京朝阳区某某咖啡","address":""}');
  ok('全角空格也认', pl.parse('东京塔　港区芝公园').address==='港区芝公园', pl.parse('东京塔　港区芝公园').address);
  ok('空的读不出来', pl.parse('  ')===null);

  const p1=reply.splitReply('我在这儿等你\n[位置：东京塔 港区芝公园 4-2-8]');
  ok('位置标记能解析出来', p1.length===2&&p1[1].type==='location'&&p1[1].place==='东京塔', JSON.stringify(p1));
  ok('地址也解析出来了', p1[1].address==='港区芝公园 4-2-8', p1[1].address);
  ok('定位两个字也认', reply.splitReply('[定位：涩谷站]')[0]?.type==='location');

  // ---- 角色发位置 ----
  const made=await reply.renderTurn({chat,char:c,raw:'我到了\n[位置：东京塔 港区芝公园]',turnId:'p1',instant:true});
  const loc=made.find(m=>m.kind==='location');
  ok('角色发出了位置', !!loc && loc.role==='char' && loc.place==='东京塔', JSON.stringify(loc&&{k:loc.kind,p:loc.place}));
  ok('正文是标记格式', loc.content==='[位置：东京塔 港区芝公园]', loc.content);

  // ---- 用户发位置 ----
  const mine=pl.send({chatId:chat.id,role:'user',authorId:'me',place:'城市图书馆',address:'和平路 128 号'});
  ok('用户也能发', mine.kind==='location'&&mine.role==='user');
  let threw=''; try{ pl.send({chatId:chat.id,role:'user',authorId:'me',place:'  '}); }catch(e){threw=e.message;}
  ok('没写地点名发不出去', /地点名称/.test(threw), threw);

  // ---- prompt ----
  const sys=engine.buildChatSystem(chat,c,db.messagesOf(chat.id),{}).system;
  // 标记名留中文（协议），说明文字是英文（第 14 条）
  ok('注入了位置说明', sys.includes('[位置：place name, address]'), sys.slice(sys.indexOf('[位置]'), sys.indexOf('[位置]')+160));
  ok('把角色所在地写进去了', sys.includes('日本 · 东京'), sys.slice(sys.indexOf('[位置]'), sys.indexOf('[位置]')+200));
  ok('转账里写了币种', sys.includes('人民币'), '');
  cur.set('none');
  const sys0=engine.buildChatSystem(chat,c,db.messagesOf(chat.id),{}).system;
  ok('不显示符号时不提币种', !sys0.includes('这段对话里的钱是'));
  cur.set('CNY');

  db.characters.update(c.id,{canSendLocation:false});
  const sys2=engine.buildChatSystem(chat,db.characters.get(c.id),db.messagesOf(chat.id),{}).system;
  ok('关掉就不注入位置', !sys2.includes('[位置：地点名 地址]'));
  db.characters.update(c.id,{canSendLocation:true});

  const noZone=db.characters.create({name:'无名'});
  const chat2=db.chats.create({characterIds:[noZone.id],personaId:me.id});
  const sys3=engine.buildChatSystem(chat2,noZone,[],{}).system;
  ok('没设时区就不硬塞一个城市', sys3.includes('和你的设定对得上。') || !/（你在/.test(sys3),
    sys3.slice(sys3.indexOf('[位置]'), sys3.indexOf('[位置]')+160));

  return { results:R, chat:chat.id };
});
out.results.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat',`/chat/${id}`);
}, out.chat);
await page.waitForTimeout(900);
ok('位置气泡画出来了', await page.locator('.bubble-location').count()===2,
  String(await page.locator('.bubble-location').count()));
await page.screenshot({path:`${OUT}/p1-bubbles.png`});

await page.locator('.composer-side').first().click();
await page.waitForTimeout(400);
await page.getByText('位置',{exact:true}).click();
await page.waitForTimeout(500);
ok('位置面板打开了', (await page.locator('.sheet').innerText()).includes('地点名称'));
await page.locator('.sheet input').first().fill('涩谷站');
await page.locator('.sheet input').nth(1).fill('东京都涩谷区');
await page.waitForTimeout(200);
await page.screenshot({path:`${OUT}/p2-send.png`});
await page.getByText('发送位置',{exact:true}).click();
await page.waitForTimeout(600);
const sent = await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  const l=db.messagesOf(id); const m=l[l.length-1];
  return { kind:m.kind, place:m.place, addr:m.address };
}, out.chat);
ok('发出去了', sent.kind==='location'&&sent.place==='涩谷站'&&sent.addr==='东京都涩谷区', JSON.stringify(sent));

// 币种选择
await page.locator('.composer-side').first().click();
await page.waitForTimeout(400);
await page.getByText('转账',{exact:true}).click();
await page.waitForTimeout(500);
ok('转账面板里有币种一行', (await page.locator('.sheet').innerText()).includes('币种'));
await page.getByText('币种',{exact:true}).click();
await page.waitForTimeout(500);
const list = await page.locator('.sheet').last().innerText();
ok('列出了币种', list.includes('日元')&&list.includes('美元'), list.slice(0,120));
await page.screenshot({path:`${OUT}/p3-currency.png`});
await page.getByText('日元',{exact:true}).click();
await page.waitForTimeout(500);
const code = await page.evaluate(async()=>{const c=await import('/src/system/currency.js');return c.current().code;});
ok('选中了日元', code==='JPY', code);
await page.screenshot({path:`${OUT}/p4-jpy.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
