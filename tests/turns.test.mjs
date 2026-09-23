import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const bodies=[];
await page.route('**/chat/completions', async r => {
  bodies.push(JSON.parse(r.request().postData()||'{}'));
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'一只橘猫'}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const svc=await import('/src/system/ai/services.js');
  const engine=await import('/src/system/ai/engine.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m'});

  const U=t=>({role:'user',kind:'text',content:t,authorId:'me'});
  const A=t=>({role:'char',kind:'text',content:t,authorId:c.id});

  // ---- 轮次切分 ----
  const seq=[U('a1'),A('b1'),U('a2'),U('a2b'),A('b2'),A('b2b'),U('a3'),A('b3'),U('a4')];
  ok('最后一轮只有用户那几条', JSON.stringify(engine.currentTurn(seq).map(m=>m.content))==='["a4"]',
    JSON.stringify(engine.currentTurn(seq).map(m=>m.content)));
  const closed=seq.slice(0,-1);
  ok('角色回完了当前轮就是空的', engine.currentTurn(closed).length===0,
    JSON.stringify(engine.currentTurn(closed).map(m=>m.content)));
  ok('用户连发几条算同一轮',
    JSON.stringify(engine.currentTurn([A('b'),U('x'),U('y')]).map(m=>m.content))==='["x","y"]');

  ok('取一轮就是最后那一轮',
    JSON.stringify(engine.takeTurns(seq,1).map(m=>m.content))==='["a4"]',
    JSON.stringify(engine.takeTurns(seq,1).map(m=>m.content)));
  ok('取两轮从上一轮的用户发言起',
    JSON.stringify(engine.takeTurns(seq,2).map(m=>m.content))==='["a3","b3","a4"]',
    JSON.stringify(engine.takeTurns(seq,2).map(m=>m.content)));
  ok('一轮里用户连发的几条不会被切开',
    JSON.stringify(engine.takeTurns(seq,3).map(m=>m.content))==='["a2","a2b","b2","b2b","a3","b3","a4"]',
    JSON.stringify(engine.takeTurns(seq,3).map(m=>m.content)));
  ok('轮数超过总轮数就全给', engine.takeTurns(seq,99).length===seq.length);

  // ---- buildHistory 按轮次 ----
  for (const m of seq) db.messages.create({chatId:chat.id,status:'done',...m});
  const msgs=db.messagesOf(chat.id);
  db.settings.set({historyMode:'turn',historyTurns:2,contextBudget:60000});
  const h2=engine.buildHistory(chat,c,msgs,{});
  ok('按轮次时历史只有那两轮', h2.map(x=>x.content).join('|')==='a3|b3|a4', JSON.stringify(h2));
  db.settings.set({historyMode:'count',historyLimit:4});
  const hc=engine.buildHistory(chat,c,msgs,{});
  ok('按条数照旧', hc.map(x=>x.content).join('|').includes('a3'), JSON.stringify(hc));
  db.settings.set({historyMode:'turn',historyTurns:10});

  // ---- 只取当前轮的图 ----
  const png='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABlklEQVR4nBXR4RiFMQiG4Q9hCEMIYQghhDCEEIbwIIQQQgghDOHs9Lu7662+72N8zA/5WB/6YR/7wz/OBx/xkR/10R/34/sGYzAHMlgDHdhgD3xwBgxikIMa9OCOByZjMicyWROd2GRPfHImTGKSk5r05M4HhCFMQYQlqGDCFlw4AkIIKZTQwpUHFmMxF7JYC13YYi98cRYsYpGLWvTirgeUoUxFlKWoYspWXDkKSiiplNLK1QeMYUxDjGWoYcY23DgGRhhplNHGtQc2YzM3slkb3dhmb3xzNmxik5va9ObuB5zhTEec5ahjznbcOQ5OOOmU0871Bw7jMA9yWAc92GEf/HAOHOKQhzr04Z4H/s95534HfCd5S77YL8gb/Zr/FZBQ0HDf679gBDOQYAUaWLADD0782yPIoIIObjyQjGQmkqxEE0t24snJ//BIMqmkk5sPFKOYhRSr0MKKXXhx6h8liiyq6OLWA81oZiPNarSxZjfenP4Hjyabarq5/cBlXOZFLuuiF7vsi1/O/a8Zl7zUpS/38gNq4ZAQG74ASAAAAABJRU5ErkJggg==';
  const blob=await (await fetch('data:image/png;base64,'+png)).blob();
  const id1=await db.images.put(new File([blob],'1.png',{type:'image/png'}));
  const id2=await db.images.put(new File([blob],'2.png',{type:'image/png'}));

  svc.setVision({mode:'chat'});
  // 旧的一轮里的图（已经有描述了）
  const oldPic=db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'image',
    imageId:id1,content:'[图片：早先那张]',vision:'done',status:'done'});
  db.messages.create({chatId:chat.id,role:'char',authorId:c.id,kind:'text',content:'嗯',status:'done'});
  // 当前这一轮的图
  const newPic=db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'image',
    imageId:id2,content:'[图片]',vision:'chat',status:'done'});

  const all=db.messagesOf(chat.id);
  const pics=await engine.imagesFor(all);
  ok('只带当前这一轮的图', !!pics && pics.size===1 && pics.has(newPic.id),
    pics?JSON.stringify([...pics.keys()]):'null');
  ok('早先那张不再重传', !pics.has(oldPic.id));

  // 角色回完之后当前轮为空，一张都不带
  db.messages.create({chatId:chat.id,role:'char',authorId:c.id,kind:'text',content:'好看',status:'done'});
  ok('这一轮收口后就不带图了', (await engine.imagesFor(db.messagesOf(chat.id)))===null);

  svc.setVision({mode:'off'});
  ok('关掉识图一张都不带', (await engine.imagesFor(all))===null);

  return { results:R, chat:chat.id, char:c.id, newPic:newPic.id };
});
out.results.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 回复之后把当轮的图写成描述 ----
const wrote = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const engine=await import('/src/system/ai/engine.js');
  svc.setVision({mode:'chat'});
  // 把收口的那条删掉，让图片重新回到当前轮
  const list=db.messagesOf(ids.chat);
  const last=list[list.length-1];
  if (last.role==='char') db.messages.remove(last.id);
  const chat=db.chats.get(ids.chat), char=db.characters.get(ids.char);
  await engine.streamReply({ chat, char });
  for (let i=0;i<40 && db.messages.get(ids.newPic).vision!=='done';i++) await new Promise(r=>setTimeout(r,150));
  return db.messages.get(ids.newPic);
}, out);
ok('回复之后写回了描述', wrote.vision==='done' && wrote.content==='[图片：一只橘猫]',
  JSON.stringify({v:wrote.vision,c:wrote.content}));
ok('描述也存进了 imageDesc', wrote.imageDesc==='一只橘猫', wrote.imageDesc);

const withImg = bodies.filter(b=>JSON.stringify(b).includes('image_url'));
ok('回复请求里带了图', withImg.length>=1, String(bodies.length));
const describeReq = withImg[withImg.length-1];
const picCount = b => (JSON.stringify(b).match(/"type":"image_url"/g)||[]).length;
ok('识别那次请求只带这一张图', picCount(describeReq)===1, String(picCount(describeReq)));
ok('回复那次请求也只带当轮这一张', picCount(withImg[0])===1, String(picCount(withImg[0])));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
