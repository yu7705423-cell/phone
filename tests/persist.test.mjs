import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);

const made = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});

  const kept=db.messages.create({chatId:chat.id,role:'user',kind:'text',content:'原始',status:'done'});
  db.messages.update(kept.id,{content:'改过一次'});
  db.messages.update(kept.id,{content:'改过两次'});     // 同一行连改，只该写最后一版

  const gone=db.messages.create({chatId:chat.id,role:'user',kind:'text',content:'马上删',status:'done'});
  db.messages.remove(gone.id);                          // 攒着的 put 后面跟着 del

  const many=[];
  for (let i=0;i<50;i++) many.push(db.messages.create({chatId:chat.id,role:'char',kind:'text',content:'批量'+i,status:'done'}).id);
  db.messages.removeWhere(m=>m.content==='批量7'||m.content==='批量8');

  const other=db.chats.create({characterIds:[c.id],personaId:me.id});
  const moved=db.messages.create({chatId:chat.id,role:'user',kind:'text',content:'换个会话',status:'done'});
  db.messages.update(moved.id,{chatId:other.id});        // 换桶

  return { chat:chat.id, other:other.id, kept:kept.id, gone:gone.id, moved:moved.id };
});

// 索引在内存里就要对
const live = await page.evaluate(async m => {
  const db=await import('/src/system/db/index.js');
  return { a:db.messagesOf(m.chat).length, b:db.messagesOf(m.other).length,
           movedIn:db.messagesOf(m.other).some(x=>x.id===m.moved),
           movedOut:!db.messagesOf(m.chat).some(x=>x.id===m.moved) };
}, made);
ok('换了会话的那条进了新桶', live.movedIn, JSON.stringify(live));
ok('也从旧桶里出来了', live.movedOut, JSON.stringify(live));
ok('旧桶剩 1 + 48 条', live.a===49, JSON.stringify(live));

// 刷新，从 IndexedDB 重新读
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2000);
const after = await page.evaluate(async m => {
  const db=await import('/src/system/db/index.js');
  await db.ready;
  const list=db.messagesOf(m.chat);
  return {
    kept: db.messages.get(m.kept)?.content,
    gone: !!db.messages.get(m.gone),
    count: list.length,
    batch7: list.some(x=>x.content==='批量7'),
    batch9: list.some(x=>x.content==='批量9'),
    movedIn: db.messagesOf(m.other).some(x=>x.id===m.moved),
  };
}, made);
ok('连改三次只留最后那一版', after.kept==='改过两次', after.kept);
ok('攒着时删掉的没落盘', after.gone===false, String(after.gone));
ok('批量删的两条真没了', !after.batch7, String(after.batch7));
ok('没删的还在', after.batch9, String(after.batch9));
ok('条数对得上', after.count===49, String(after.count));
ok('换桶那条重载后仍在新会话里', after.movedIn, String(after.movedIn));

// 整表清空后重载
await page.evaluate(async () => { const db=await import('/src/system/db/index.js'); await db.messages.clear(); });
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2000);
const cleared = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js'); await db.ready; return db.messages.count();
});
ok('清空之后重载还是空的', cleared===0, String(cleared));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
