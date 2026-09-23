// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 批 0：能力不设上限，花钱的必须能关（CLAUDE.md 第 13 条）
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
const bodies=[];
await page.route('**/chat/completions', async r => {
  bodies.push(JSON.parse(r.request().postData()||'{}'));
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'嗯'}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const svc=await import('/src/system/ai/services.js');
  const engine=await import('/src/system/ai/engine.js');
  const search=await import('/src/system/search.js');
  const tr=await import('/src/system/transfer.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m'});

  // ---- 默认值都在 ----
  const s0=db.settings.get();
  const keys=['callMaxTokens','callFrameGap','stickerCold','stickerHot',
    'proactiveMaxUnread','chatPage','searchLimit','scrobbleAfter'];
  ok('八个旋钮都有默认值', keys.every(k=>typeof s0[k]==='number'),
    JSON.stringify(keys.filter(k=>typeof s0[k]!=='number')));

  // ---- 历史：0 = 整段都要 ----
  for (let i=0;i<30;i++) db.messages.create({chatId:chat.id,status:'done',
    role:i%2?'char':'user',kind:'text',authorId:i%2?c.id:'me',content:'第'+i+'句 晚安'});
  const msgs=db.messagesOf(chat.id);
  db.settings.set({contextBudget:0,historyMode:'count',historyLimit:5});
  ok('按条数截断时只给这么多', engine.buildHistory(chat,c,msgs,{}).length===5,
    engine.buildHistory(chat,c,msgs,{}).length);
  db.settings.set({historyLimit:0});
  ok('条数填 0 就整段都给', engine.buildHistory(chat,c,msgs,{}).length===30,
    engine.buildHistory(chat,c,msgs,{}).length);
  db.settings.set({historyMode:'turn',historyTurns:2});
  const t2=engine.buildHistory(chat,c,msgs,{}).length;
  db.settings.set({historyTurns:0});
  ok('轮数填 0 也整段都给', engine.buildHistory(chat,c,msgs,{}).length===30 && t2<30, `${t2} / 30`);
  db.settings.set({historyMode:'count',historyLimit:20,historyTurns:10});

  // ---- 注入预算：0 = 不按 token 截 ----
  db.settings.set({contextBudget:30});
  const tight=engine.buildHistory(chat,c,msgs,{}).length;
  db.settings.set({contextBudget:0});
  const loose=engine.buildHistory(chat,c,msgs,{}).length;
  ok('预算填 0 不再按 token 截', tight<loose && loose===20, `${tight} / ${loose}`);
  db.settings.set({contextBudget:6000});

  // ---- 搜索：0 = 全给 ----
  const cap3=await new Promise(res=>search.searchMessages('晚安',{limit:3,onBatch:(h,f)=>f&&res(h.length)}));
  ok('搜索给了上限就按上限停', cap3===3, cap3);
  db.settings.set({searchLimit:0});
  const all=await new Promise(res=>search.searchMessages('晚安',{onBatch:(h,f)=>f&&res(h.length)}));
  ok('搜索上限填 0 就全给', all===30, all);
  db.settings.set({searchLimit:200});

  // ---- 表情名单：0 = 全列 ----
  for (let i=0;i<20;i++) db.stickers.create({name:'表情'+i,useCount:i});
  const caps=await import('/src/system/ai/capabilities.js');
  // 表情这一项是常驻的（always），冷热两条路都走 stickerHot 之外的那一个，
  // 这里两个都设成同一个数，测的是「截断这件事本身」。
  const ctx=n=>({chat,char:c,msgs:[],settings:{...db.settings.get(),promptLean:true,stickerCold:n,stickerHot:n}});
  const count=n=>((caps.capabilityBlock(ctx(n)).match(/表情\d+/g))||[]).length;
  ok('表情名单按设置截断', count(5)===5, count(5));
  ok('表情名单填 0 就全列', count(0)>=20, count(0));

  // ---- 转账：没有金额上限了 ----
  let threw=''; let big=null;
  try{ big=tr.send({chatId:chat.id,role:'user',authorId:'me',amount:123456789}); }catch(e){threw=e.message;}
  ok('转账金额不再封顶', !threw && !!big, threw);
  if (big) db.messages.remove(big.id);
  ok('金额为 0 还是发不出去', (()=>{try{tr.send({chatId:chat.id,role:'user',authorId:'me',amount:0});return false;}catch{return true;}})());

  // ---- 主动消息：未读阈值 0 = 不受限 ----
  // ---- 主动消息：未读阈值 0 = 不受限 ----
  // tick() 到点了才会发。把落点拨到过去，未读堆到 99，看它发不发。
  const pro=await import('/src/system/ai/proactive.js');
  db.characters.update(c.id,{proactive:true,proactiveMinutes:1,proactiveQuietFrom:0,proactiveQuietTo:0,charAltChance:0});
  db.chats.update(chat.id,{unread:99});
  const countOf=()=>db.messagesOf(chat.id).length;
  // scheduleIn 最少排到一秒后，这里要的是「早就该发了」，直接写落点表
  const due=()=>localStorage.setItem('phone.proactive.next',JSON.stringify({[c.id]:Date.now()-1000}));

  db.settings.set({proactiveMaxUnread:3});
  due();
  const before1=countOf();
  await pro.tick();
  await new Promise(r=>setTimeout(r,800));
  ok('未读堆满时不再主动发', countOf()===before1, `${before1} -> ${countOf()}`);

  db.settings.set({proactiveMaxUnread:0});
  due();
  const before2=countOf();
  await pro.tick();
  await new Promise(r=>setTimeout(r,1500));
  ok('阈值填 0 就照发不误', countOf()>before2, `${before2} -> ${countOf()}`);

  db.settings.set({proactiveMaxUnread:3});
  db.characters.update(c.id,{proactive:false});
  db.chats.update(chat.id,{unread:0});

  return { R, chatId:chat.id };
});
out.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 通话回复上限进了请求体 ----
await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  db.settings.set({callMaxTokens:400});
  const engine=await import('/src/system/ai/engine.js');
  const chat=db.chats.get(id), char=db.characters.get(chat.characterIds[0]);
  const system=await engine.buildCallSystem(chat,char);
  await engine.streamCall({chat,char,system,lines:[],opening:'接通了'}).catch(()=>{});
}, out.chatId);
await page.waitForTimeout(400);
ok('通话请求带了 400 的上限', bodies.some(b=>b.max_tokens===400),
  JSON.stringify(bodies.map(b=>b.max_tokens)));

bodies.length=0;
await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  db.settings.set({callMaxTokens:0});
  const engine=await import('/src/system/ai/engine.js');
  const chat=db.chats.get(id), char=db.characters.get(chat.characterIds[0]);
  const system=await engine.buildCallSystem(chat,char);
  await engine.streamCall({chat,char,system,lines:[],opening:'接通了'}).catch(()=>{});
}, out.chatId);
await page.waitForTimeout(400);
ok('填 0 就退回接口自己的上限', bodies.some(b=>b.max_tokens===32000),
  JSON.stringify(bodies.map(b=>b.max_tokens)));

// ---- 设置页那一页真的打得开 ----
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('settings','/limits');
});
await page.waitForTimeout(700);
const txt = await page.locator('.app-layer').innerText();
ok('用量与上限打开了', txt.includes('用量与上限'), txt.slice(0,40));
ok('每个旋钮都有输入框', await page.locator('.num-row input').count() >= 9,
  await page.locator('.num-row input').count());
ok('说明里写了 0 表示不限', txt.includes('填 0 表示不限'));
await page.locator('.num-row input').first().fill('0');
await page.waitForTimeout(300);
ok('填 0 存得下去', await page.evaluate(async()=>(await import('/src/system/db/index.js')).settings.get().callMaxTokens)===0);
ok('输入框没有 max 属性', await page.locator('.num-row input').first().getAttribute('max')===null,
  await page.locator('.num-row input').first().getAttribute('max'));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
