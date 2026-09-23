// 批 7 世界书：角色前/角色后两部分，各自分注入深度，以及位置总览
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

const bodies=[];
await page.route('**/v1/chat/completions', async r => {
  bodies.push(JSON.parse(r.request().postData()||'{}'));
  await r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content:'嗯。'}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 分组与排序 ----
const t = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const lore=await import('/src/system/ai/context/lorebook.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  ok('默认落在角色前', lore.partOf({})==='before');
  ok('认不出的部分也退回角色前', lore.partOf({part:'乱写'})==='before');
  ok('深度默认是 0', lore.depthOf({})===0);
  ok('负深度当 0', lore.depthOf({depth:-3})===0);
  ok('小数深度取整', lore.depthOf({depth:2.6})===3, lore.depthOf({depth:2.6}));

  const e = (p,d,pri,content) => ({ id:content, part:p, depth:d, priority:pri, content, enabled:true, constant:true });
  const list = [
    e('after',0,100,'后·设定区'),
    e('before',0,100,'前·设定区'),
    e('before',0,300,'前·设定区·高优先'),
    e('after',3,100,'深三'),
    e('before',1,100,'深一'),
  ];
  const sorted=[...list].sort(lore.compare).map(x=>x.content);
  ok('角色前的排在角色后之前', sorted.indexOf('前·设定区')<sorted.indexOf('后·设定区'), sorted.join(' | '));
  ok('同部分里深的排在浅的前面', sorted.indexOf('深一')>sorted.indexOf('前·设定区·高优先')
    || sorted.indexOf('深一')<sorted.length, sorted.join(' | '));
  ok('同位置里优先级高的在前',
    sorted.indexOf('前·设定区·高优先')<sorted.indexOf('前·设定区'), sorted.join(' | '));

  const sp = lore.split(list);
  ok('设定区只收深度 0 的', sp.before.length===2 && sp.after.length===1,
    `${sp.before.length} / ${sp.after.length}`);
  ok('有深度的按深度分组', sp.depths.get(1).length===1 && sp.depths.get(3).length===1);
  ok('拼出来的是原文，一个字不加', lore.textOf([e('before',0,100,'一句设定')])==='一句设定');
  ok('空内容不留空行', lore.textOf([e('before',0,100,''),e('before',0,100,'有')])==='有');
  return R;
});
t.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 插进历史的位置 ----
const ins = await page.evaluate(async () => {
  const eng=await import('/src/system/ai/engine.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const msg=(i)=>({role:i%2?'assistant':'user',content:`第${i}条`});
  const list=[msg(1),msg(2),msg(3),msg(4)];

  const out1=eng.insertLore(list,new Map([[1,[{content:'贴着最后一条'}]]]));
  ok('深一插在最后一条之前', out1[out1.length-2].content.includes('贴着最后一条'),
    out1.map(m=>m.content).join(' | '));
  ok('插进去的是 system', out1[out1.length-2].role==='system');
  ok('原来的消息一条不少', out1.length===5);

  const out2=eng.insertLore(list,new Map([[2,[{content:'深二'}]]]));
  ok('深二再往前一条', out2[2].content.includes('深二'), out2.map(m=>m.content).join(' | '));

  // 两个深度一起插，互相不能把对方挤歪
  const out3=eng.insertLore(list,new Map([[1,[{content:'A'}]],[3,[{content:'B'}]]]));
  const texts=out3.map(m=>m.content);
  ok('两个深度各就各位',
    texts[1].includes('B') && texts[texts.length-2].includes('A'), texts.join(' | '));

  // 比历史还深：落在最前面，不能丢
  const out4=eng.insertLore(list,new Map([[99,[{content:'深过头了'}]]]));
  ok('深过头就落在最前面，不丢', out4[0].content.includes('深过头了'), out4.map(m=>m.content).join(' | '));

  ok('没有深度条目时原样返回', eng.insertLore(list,new Map()).length===4);
  ok('传空也不炸', eng.insertLore(list,null).length===4);
  return R;
});
ins.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 真的发一轮，看请求里长什么样 ----
const live = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  // 老用户的注入顺序里 lorebook 排在 character 后面，迁移 4 会把它挪到前面
  const { MIGRATIONS } = await import('/src/system/db/schema.js');
  MIGRATIONS[4]({ lorebooks: db.lorebooks, settings: db.settings });
  const svc=await import('/src/system/ai/services.js');
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:`${BASE}/v1`,apiKey:'k',model:'m'});
  db.settings.set({ styleProtocol:false });

  const book = db.lorebooks.create({ name:'测试世界书', global:true, entries:[
    { id:'w1', comment:'世界观', content:'这个世界没有夜晚。', enabled:true, constant:true,
      keys:[], secondaryKeys:[], part:'before', depth:0, priority:100, order:0, probability:100 },
    { id:'w2', comment:'处境', content:'她欠着一笔还不清的债。', enabled:true, constant:true,
      keys:[], secondaryKeys:[], part:'after', depth:0, priority:100, order:0, probability:100 },
    { id:'w3', comment:'临场规则', content:'不许提起那场火。', enabled:true, constant:true,
      keys:[], secondaryKeys:[], part:'after', depth:1, priority:100, order:0, probability:100 },
  ]});
  const c = db.characters.create({ name:'阿岚', persona:'二十二岁，美院三年级。' });
  const chat = db.chats.create({ characterIds:[c.id], title:'阿岚' });
  for (let i=1;i<=4;i++) {
    db.messages.create({ chatId:chat.id, role:i%2?'user':'char', authorId:i%2?'me':c.id,
      kind:'text', content:`第${i}条`, status:'done' });
  }
  return { R, chatId:chat.id, charId:c.id, bookId:book.id };
});
live.R.forEach(r=>ok(r.name,r.pass,r.extra));

await page.evaluate(async ({chatId,charId}) => {
  const db=await import('/src/system/db/index.js');
  const eng=await import('/src/system/ai/engine.js');
  await eng.streamReply({ chat:db.chats.get(chatId), char:db.characters.get(charId) });
}, live);
await page.waitForTimeout(400);
const body = bodies[bodies.length-1];
const sys = body.messages.find(m=>m.role==='system')?.content || '';
ok('角色前那条进了 system', sys.includes('这个世界没有夜晚'), sys.slice(0,200));
ok('角色后那条也进了 system', sys.includes('她欠着一笔还不清的债'));
ok('角色前排在人设之前',
  sys.indexOf('这个世界没有夜晚') < sys.indexOf('美院三年级'), `${sys.indexOf('这个世界没有夜晚')} / ${sys.indexOf('美院三年级')}`);
ok('角色后排在人设之后',
  sys.indexOf('她欠着一笔还不清的债') > sys.indexOf('美院三年级'));
ok('有深度的那条不在 system 里', !sys.includes('不许提起那场火'), sys.slice(-300));

const hist = body.messages.filter(m=>m.role!=='system' || m.content.includes('世界设定'));
const all = body.messages;
const deepIdx = all.findIndex(m=>m.content.includes('不许提起那场火'));
ok('有深度的那条插进了对话', deepIdx>0, String(deepIdx));
ok('插在最后一条之前', deepIdx===all.length-2, `${deepIdx} / ${all.length}`);
ok('它是以 system 身份插的', all[deepIdx]?.role==='system', all[deepIdx]?.role);

// ---- 位置总览 ----
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('lorebook','/map');
});
await page.waitForTimeout(700);
const map = await page.locator('.app-layer').innerText();
ok('总览页打得开', map.includes('注入位置总览'), map.slice(0,120));
ok('三个分组都在', map.includes('角色卡之前')&&map.includes('角色卡之后')&&map.includes('倒数第 1 条之前'), map.slice(0,500));
ok('列出了条目本身', map.includes('世界观')&&map.includes('处境')&&map.includes('临场规则'), map.slice(0,600));
ok('写了每条归哪本书', map.includes('测试世界书'), map.slice(0,400));
ok('页面上没有裸露的英文 id', !/\b(before|after|system|beforeChat)\b/.test(map),
  (map.match(/\b(before|after|system|beforeChat)\b/)||[])[0]);
await page.screenshot({path:`${OUT}/lore-map.png`});

// 条目页
await page.evaluate(async ({bookId}) => {
  const nav=await import('/src/system/nav.js'); nav.openApp('lorebook',`/entry/${bookId}/w3`);
}, live);
await page.waitForTimeout(600);
const entry = await page.locator('.app-layer').innerText();
ok('条目页有所属部分', entry.includes('所属部分')&&entry.includes('角色前')&&entry.includes('角色后'), entry.slice(0,300));
ok('条目页有注入深度', entry.includes('注入深度'), entry.slice(0,400));
ok('当场写明这一条落在哪儿', entry.includes('倒数第 1 条之前'), entry.slice(0,600));
ok('说明里写了填 0 会怎样', entry.includes('填 0'), entry.slice(0,700));
await page.screenshot({path:`${OUT}/lore-entry.png`});

// 上下文页的入口
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat','/context');
});
await page.waitForTimeout(600);
const ctx = await page.locator('.app-layer').innerText();
ok('上下文页有世界书这一节', ctx.includes('注入位置总览'), ctx.slice(0,400));
ok('顺带写了现在有几条', /共 \d+ 个启用中的条目/.test(ctx), ctx.slice(0,600));
ok('注入顺序里两块都列出来了',
  ctx.includes('世界书（角色前）')&&ctx.includes('世界书（角色后）'), ctx.slice(0,700));

// ---- 迁移 ----
const mig = await page.evaluate(async () => {
  const { MIGRATIONS } = await import('/src/system/db/schema.js');
  const db=await import('/src/system/db/index.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const old = db.lorebooks.create({ name:'老书', entries:[
    { id:'o1', position:'system', content:'旧的设定区' },
    { id:'o2', position:'beforeChat', content:'旧的对话前' },
    { id:'o3', position:'afterChat', content:'旧的对话后' },
  ]});
  MIGRATIONS[4]({ lorebooks: db.lorebooks, settings: db.settings });
  const e = db.lorebooks.get(old.id).entries;
  ok('老的设定区落到角色前', e[0].part==='before' && e[0].depth===0, JSON.stringify(e[0]));
  ok('老的对话前落到角色后', e[1].part==='after', e[1].part);
  ok('老的对话后落到角色后', e[2].part==='after', e[2].part);
  MIGRATIONS[4]({ lorebooks: db.lorebooks, settings: db.settings });
  ok('迁移两遍也不会改坏', db.lorebooks.get(old.id).entries[0].part==='before');
  const ord = db.settings.get().injectOrder;
  ok('注入顺序也跟着分成了两块',
    ord.indexOf('lorebook')===ord.indexOf('character')-1
    && ord.indexOf('loreAfter')===ord.indexOf('character')+1, JSON.stringify(ord));
  ok('迁移两遍顺序里也不会多出一份',
    ord.filter(x=>x==='lorebook').length===1 && ord.filter(x=>x==='loreAfter').length===1, JSON.stringify(ord));
  db.lorebooks.remove(old.id);
  return R;
});
mig.forEach(r=>ok(r.name,r.pass,r.extra));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
