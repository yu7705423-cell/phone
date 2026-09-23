// 批 2b 角色的一天：日程、时段注入、吃饭记录与食谱库
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

const bodies=[];
await page.route('**/chat/completions', async r => {
  const body=JSON.parse(r.request().postData()||'{}');
  bodies.push(body);
  const sys=body.messages.find(m=>m.role==='system')?.content||'';
  let content='好';
  // 提示词正文已经全部改成英文（第 14 条），这里照现在的措辞认
  if (sys.includes('Plan what this character will do')) {
    content=JSON.stringify({items:[
      {slot:'morning',text:'去邮局取包裹'},
      {slot:'afternoon',text:'把稿子改完'},
      {slot:'evening',text:'看完那部片子'},
      {slot:'乱写的',text:'这一条 slot 不对，应该被丢掉'},
      {slot:'noon',text:''},
    ]});
  } else if (sys.includes('library of meals')) {
    const web=sys.includes('verified against the\nweb');
    const n=Number((sys.match(/Count: (\d+)/)||[])[1])||3;
    // 联网那一档的模型会给每条都配一个店名，这里照着它的样子返
    const P = i => (web ? { place: `第${i}家店` } : {});
    const list=[{name:'已经有的那一样',...P(0)},{name:'重的',...P(1)},{name:'重的。',...P(2)}];
    for(let i=list.length;i<n;i++) list.push({name:`菜${i}`,...P(i)});
    content=JSON.stringify({dishes:list});
  }
  await r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 时段与日期 ----
const t = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const day=await import('/src/system/day.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const c=db.characters.create({name:'阿岚'});

  ok('五个时段', day.SLOTS.length===5);
  const at=h=>new Date(2026,8,17,h,0,0);
  ok('早上八点是早上', day.slotNow(c,at(8)).id==='morning', day.slotNow(c,at(8)).id);
  ok('中午十二点是中午', day.slotNow(c,at(12)).id==='noon');
  ok('下午三点是下午', day.slotNow(c,at(15)).id==='afternoon');
  ok('晚上八点是晚上', day.slotNow(c,at(20)).id==='evening');
  ok('深夜跨零点也认得出', day.slotNow(c,at(23)).id==='night' && day.slotNow(c,at(2)).id==='night',
    day.slotNow(c,at(2)).id);

  ok('凌晨两点算前一天', day.dateKey(c,at(2))==='2026-09-16', day.dateKey(c,at(2)));
  ok('早上八点就是今天', day.dateKey(c,at(8))==='2026-09-17', day.dateKey(c,at(8)));

  // 落库：slot 不对的和空的都丢掉，落库后按时段排好
  const row=day.save(c.id,{date:'2026-09-17',items:[
    {slot:'evening',text:'看片子'},{slot:'morning',text:'取包裹'},
    {slot:'乱写',text:'扔掉'},{slot:'noon',text:'  '},
  ]});
  ok('落库时排好了序，认不出的时段整条丢掉', row.items.map(x=>x.slot).join(',')==='morning,evening',
    row.items.map(x=>x.slot).join(','));
  ok('每条都有 id 和状态', row.items.every(x=>x.id&&x.state===day.PLAN));
  ok('同一天再落一次是整条换掉',
    day.save(c.id,{date:'2026-09-17',items:[{slot:'noon',text:'只剩一条'}]}).items.length===1);
  ok('取得回来', day.get(c.id,'2026-09-17')?.items.length===1);

  // 事项状态
  const d2=day.save(c.id,{date:'2026-09-17',items:[{slot:'morning',text:'去邮局取包裹'}]});
  const it=d2.items[0];
  day.setState(d2.id,it.id,day.DONE);
  ok('标完成', day.get(c.id,'2026-09-17').items[0].state===day.DONE);
  ok('标签是中文', day.stateLabel(day.DONE)==='已完成' && day.stateLabel(day.DROP)==='已取消');

  // 认领：说一小段也能对上，认不出就不动
  const d3=day.save(c.id,{date:'2026-09-17',items:[
    {slot:'morning',text:'去邮局取包裹'},{slot:'evening',text:'看完那部片子'}]});
  ok('说一小段认得出', day.findItem(d3,'取包裹')?.text==='去邮局取包裹');
  ok('认不出来就给 null', day.findItem(d3,'根本没有这一条')===null);
  ok('已经完成的不再被认领', (()=>{
    day.setState(d3.id,d3.items[0].id,day.DONE);
    return day.findItem(day.get(c.id,'2026-09-17'),'取包裹')===null;
  })());

  return { R, charId:c.id };
});
t.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 吃饭：抽、记性、压一压不是封杀 ----
const f = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const food=await import('/src/system/food.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  db.recipes.all().forEach(x=>db.recipes.remove(x.id));
  db.meals.all().forEach(x=>db.meals.remove(x.id));

  const c=db.characters.create({name:'小满',region:'成都'});
  const other=db.characters.create({name:'东京的那位',region:'东京'});

  food.add({region:'成都',name:'担担面',place:'陈记面馆',meal:'lunch'});
  food.add({region:'成都',name:'钟水饺',meal:'lunch'});
  food.add({region:'成都',name:'肥肠粉',meal:'lunch'});
  food.add({region:'东京',name:'荞麦面',meal:'lunch'});
  food.add({region:'',name:'煎蛋',meal:'breakfast'});

  ok('按地区分得开', food.list({region:'成都'}).length===3);
  ok('地区留空的是通用的', food.list({region:''}).length===1);
  ok('吃得到的是本地区加通用', food.poolFor(c).length===4, food.poolFor(c).length);
  ok('别的地区的端不上来', !food.poolFor(c).some(r=>r.name==='荞麦面'));
  ok('没填地区就只吃通用的',
    food.poolFor(db.characters.create({name:'没填地区的'})).length===1);
  ok('按哪一顿筛得出', food.poolFor(c,'breakfast').map(r=>r.name).join()==='煎蛋',
    food.poolFor(c,'breakfast').map(r=>r.name).join());
  ok('东京那位吃东京的', food.poolFor(other,'lunch').map(r=>r.name).join()==='荞麦面',
    food.poolFor(other,'lunch').map(r=>r.name).join());

  ok('查得出重复', food.has('担担面','成都') && !food.has('担担面','东京'));
  const made=food.addMany([{name:'担担面'},{name:'龙抄手'},{name:'龙抄手。'}],'成都');
  ok('去重之后只进新的', made.length===1 && made[0].name==='龙抄手',
    JSON.stringify(made.map(x=>x.name)));
  food.remove(made[0].id);

  // 抽一顿会落一条记录
  const r1=food.eat({charId:c.id,meal:'lunch'});
  ok('抽得出来也记下来了', !!r1 && food.history(c.id).length===1, JSON.stringify(r1&&r1.name));
  ok('记录里带着是哪一顿', r1.meal==='lunch');
  ok('店名跟着走', food.list({region:'成都'}).find(x=>x.name==='担担面').place==='陈记面馆');

  // 空库不编
  const empty=db.characters.create({name:'没得吃',region:'火星'});
  ok('库是空的就返回 null，不编', food.eat({charId:empty.id,meal:'lunch'})===null);

  // 记性：连吃二十顿，不该二十顿都一样
  db.meals.byIndex(c.id).forEach(m=>db.meals.remove(m.id));
  db.settings.set({mealCooldown:8});
  const got=[];
  for(let i=0;i<24;i++) got.push(food.eat({charId:c.id,meal:'lunch'}).name);
  const uniq=new Set(got);
  ok('二十四顿不会全是同一样', uniq.size===3, `${uniq.size} 种：${[...uniq].join('、')}`);
  let maxRun=1,run=1;
  for(let i=1;i<got.length;i++){ run = got[i]===got[i-1]?run+1:1; maxRun=Math.max(maxRun,run); }
  ok('也不会连着吃很多顿同一样', maxRun<=4, `最长连吃 ${maxRun} 顿`);

  // 压一压不是封杀：爱吃的那样仍然反复出现
  const counts={}; got.forEach(x=>{counts[x]=(counts[x]||0)+1;});
  ok('每一样都还吃得到（压不是封杀）', Object.keys(counts).length===3 && Math.min(...Object.values(counts))>=3,
    JSON.stringify(counts));

  // 冷却填 0 就不压
  db.meals.byIndex(c.id).forEach(m=>db.meals.remove(m.id));
  db.settings.set({mealCooldown:0});
  const one=food.poolFor(c,'lunch');
  ok('冷却填 0 时不再打折',
    food.draw({charId:c.id,meal:'lunch',rng:()=>0})?.id===one[0].id,
    JSON.stringify(food.draw({charId:c.id,meal:'lunch',rng:()=>0})?.name));
  db.settings.set({mealCooldown:8});

  // 注进去的是「哪一顿 + 吃了什么」，冒号分隔 —— 「吃了」那两个字是
  // 说明书的口气，属于 prompt 正文，已经拿掉（第 14 条）
  ok('上下文里怎么念', food.mealText({meal:'lunch',name:'担担面',place:'陈记面馆'})==='午饭: 担担面（陈记面馆）',
    food.mealText({meal:'lunch',name:'担担面',place:'陈记面馆'}));
  ok('没店名就不带括号', food.mealText({meal:'breakfast',name:'煎蛋'})==='早饭: 煎蛋',
    food.mealText({meal:'breakfast',name:'煎蛋'}));

  return { R, charId:c.id };
}, t);
f.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 生成日程 + 本地掷 ----
const g = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const day=await import('/src/system/day.js');
  const dayTask=await import('/src/system/ai/tasks/day.js');
  const svc=await import('/src/system/ai/services.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m'});

  const c=db.characters.get(ids.charId);
  db.characters.update(c.id,{persona:'在成都做编辑',dayOn:false});
  db.settings.set({eventChance:1});   // 填满就是每天都有，运势不再往下打折
  db.events.all().forEach(x=>db.events.remove(x.id));
  const events=await import('/src/system/events.js');
  events.add({domain:'env',tone:'good',text:'路上一路绿灯'});

  ok('没开就不排', await dayTask.ensureToday(c.id)===null);
  let threw=''; try{ await dayTask.makeToday(c.id); }catch(e){threw=e.message;}
  ok('没开时硬排会说清楚', /没有开启/.test(threw), threw);

  db.characters.update(c.id,{dayOn:true});
  const row=await dayTask.makeToday(c.id);
  ok('排出来了', !!row && row.items.length===3, JSON.stringify(row&&row.items.map(x=>x.text)));
  ok('slot 不对的那条被丢掉', !row.items.some(x=>x.text.includes('slot 不对')));
  ok('空正文的那条也被丢掉', row.items.every(x=>x.text));
  ok('顺手掷了随机事件', !!row.event && row.event.text==='路上一路绿灯', JSON.stringify(row.event));
  ok('事件绑在某个时段上', !!day.slotOf(row.event.slot) && row.event.slot!=='night', row.event.slot);
  ok('顺手掷了大运', typeof row.luck==='number');
  ok('顺手抽了三顿', (row.meals||[]).length>=1, JSON.stringify(row.meals));

  const n=db.days.byIndex(c.id).length;
  ok('同一天不重复排', (await dayTask.makeToday(c.id))?.id===row.id && db.days.byIndex(c.id).length===n);
  ok('ensureToday 也不会再排一次', await dayTask.ensureToday(c.id)===null);

  return { R, charId:c.id, dayId:row.id, slot:row.event.slot };
}, f);
g.R.forEach(r=>ok(r.name,r.pass,r.extra));

// 排日程那一次请求长什么样
const planReq = bodies.map(b=>b.messages.find(m=>m.role==='system')?.content||'')
  .find(x=>x.includes('Plan what this character will do'));
ok('排日程是单独一次调用', !!planReq);
ok('带了人设', planReq.includes('在成都做编辑'), planReq.slice(0,120));
ok('写明了时段表', /morning = 早上/.test(planReq));
ok('说了不要写吃什么', planReq.includes('Do not write meals'));
ok('不带聊天历史', !planReq.includes('[对话记忆'));

// ---- 注入：分两层 ----
const inj = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const day=await import('/src/system/day.js');
  const blocks=await import('/src/system/ai/context/index.js');
  const caps=await import('/src/system/ai/capabilities.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const c=db.characters.get(ids.charId);
  const chat=db.chats.create({characterIds:[c.id],personaId:db.personas.all()[0]?.id});

  ok('day 是一个注入块', !!blocks.BLOCKS.day && blocks.DEFAULT_ORDER.includes('day'));

  // 把今天钉成一个已知的样子
  const date=day.dateKey(c);
  day.save(c.id,{date,luck:1.5,items:[
    {slot:'morning',text:'去邮局取包裹'},
    {slot:'evening',text:'看完那部片子'},
  ],event:{eventId:'x',text:'路上一路绿灯',tone:'good',domain:'env',slot:'evening'},
   meals:[{meal:'lunch',name:'担担面',place:'陈记面馆'}]});

  const at = h => new Date(new Date(`${date}T00:00:00`).getTime()+h*3600000);
  const b8=day.brief(c.id,at(8));
  ok('早上八点时当前时段是早上', b8.slot.id==='morning', b8.slot.id);
  ok('摘要里两个时段都在', b8.summary.length===2, JSON.stringify(b8.summary));
  ok('当前时段的事写出来了', b8.nowItems.join()==='去邮局取包裹', JSON.stringify(b8.nowItems));
  ok('晚上的事不在当前时段里', !b8.nowItems.includes('看完那部片子'));
  ok('绑在晚上的事件，早上一个字都不提', b8.event===null, JSON.stringify(b8.event));

  const b20=day.brief(c.id,at(20));
  ok('到了晚上事件才出现', !!b20.event && b20.event.text==='路上一路绿灯', JSON.stringify(b20.event));
  ok('晚上的事成了当前时段的事', b20.nowItems.join()==='看完那部片子');
  ok('中午那顿在中午才提', day.brief(c.id,at(12)).meal.includes('担担面')
    && !b8.meal, `${day.brief(c.id,at(12)).meal} / ${b8.meal}`);

  const ctx={chat,char:c,messages:[],persona:db.personas.all()[0],settings:db.settings.get()};
  const text=blocks.BLOCKS.day.build(ctx);
  ok('注入块拼得出来', text.includes('[你今天]'), text.slice(0,60));
  ok('写了摘要', text.includes('去邮局取包裹'));
  ok('大运写成倾向不写数字', !text.includes('1.5') && /in (good|reasonable|poor) form/.test(text),
    text.slice(-260));
  // 「可以改，但不要当成从来没安排过」这一句已经删掉：那是替角色作判断，
  // 不是格式规则（第 16 条）。这一段现在只剩客观事实
  ok('不替角色决定该怎么对待这份日程',
    !/不要当成|该怎么|尽量/.test(text) && !/should|try to/.test(text), text.slice(-260));
  ok('写明了没到的时段不知道结果',
    text.includes('not how\n it turned out') || text.includes('not how it turned out'),
    text.slice(-160));

  // 关掉就一个字都没有
  db.characters.update(c.id,{dayOn:false});
  ok('关掉就不注入', blocks.BLOCKS.day.build({...ctx,char:db.characters.get(c.id)})==='');
  db.characters.update(c.id,{dayOn:true});

  // 能力目录：排了日程才提「怎么标完成」
  const hot=caps.capabilityBlock({chat,char:db.characters.get(c.id),messages:[],settings:db.settings.get()});
  ok('排了日程才给标记的写法', hot.includes('[事项完成：the item]'), hot.slice(0,200));
  const other=db.characters.create({name:'没排日程的'});
  const cold=caps.capabilityBlock({chat,char:other,messages:[],settings:db.settings.get()});
  ok('没排日程就一个字不提', !cold.includes('事项完成'));

  return { R, charId:c.id, chatId:chat.id };
}, g);
inj.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 模型写的那两行 ----
const mk = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const day=await import('/src/system/day.js');
  const reply=await import('/src/system/ai/reply.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const c=db.characters.get(ids.charId), chat=db.chats.get(ids.chatId);

  const p=reply.splitReply('包裹取到了\n[事项完成：取包裹]');
  ok('[事项完成] 解析出来了', JSON.stringify(p.map(x=>x.type))==='["text","agenda"]',
    JSON.stringify(p.map(x=>x.type)));
  ok('状态是完成', p[1].state===day.DONE);
  const p2=reply.splitReply('[事项取消：看完那部片子]');
  ok('[事项取消] 也认', p2[0]?.type==='agenda' && p2[0].state===day.DROP, JSON.stringify(p2));

  const before=db.messagesOf(chat.id).length;
  await reply.renderTurn({chat,char:c,raw:'包裹取到了\n[事项完成：取包裹]',turnId:'d1',instant:true});
  const today=day.today(c.id);
  ok('那一条被标完成了', today.items.find(x=>x.text.includes('取包裹'))?.state===day.DONE,
    JSON.stringify(today.items));
  ok('不占气泡，只落了那句正文', db.messagesOf(chat.id).length===before+1,
    db.messagesOf(chat.id).length-before);

  await reply.renderTurn({chat,char:c,raw:'[事项完成：根本没有这一条]',turnId:'d2',instant:true});
  ok('认不出来就什么都不动',
    day.today(c.id).items.filter(x=>x.state===day.DONE).length===1,
    JSON.stringify(day.today(c.id).items.map(x=>x.state)));

  await reply.renderTurn({chat,char:c,raw:'[事项取消：看完那部片子]',turnId:'d3',instant:true});
  ok('取消也生效', day.today(c.id).items.find(x=>x.text.includes('片子'))?.state===day.DROP);
  ok('取消掉的不再进摘要',
    !day.brief(c.id).summary.join().includes('片子'), JSON.stringify(day.brief(c.id).summary));

  return R;
}, inj);
mk.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 食谱生成：普通与联网两档 ----
const rb = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const food=await import('/src/system/food.js');
  const batch=await import('/src/system/ai/tasks/recipe-batch.js');
  const svc=await import('/src/system/ai/services.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  db.recipes.all().forEach(x=>db.recipes.remove(x.id));
  food.add({region:'成都',name:'已经有的那一样'});

  ok('没配联网接口时用不了这一档', !batch.canSearch());
  let threw=''; try{ await batch.generate({region:'成都',count:5,web:true}); }catch(e){threw=e.message;}
  ok('硬要走会说清楚', /联网/.test(threw), threw);

  const rows=await batch.generate({region:'成都',meal:'lunch',count:6});
  ok('和库里重的被挡下', !rows.some(r=>r.name==='已经有的那一样'), JSON.stringify(rows.map(r=>r.name)));
  ok('同一批里重的只留一条',
    rows.filter(r=>food.normalize(r.name)===food.normalize('重的')).length===1);
  ok('普通那一档不带店名', rows.every(r=>!r.place), JSON.stringify(rows.map(r=>r.place)));
  ok('地区和哪一顿带回来了', rows.every(r=>r.region==='成都'&&r.meal==='lunch'));

  // 配上联网接口
  svc.setSearch({baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m-search'});
  ok('配了就能用', batch.canSearch());
  let threw2=''; try{ await batch.generate({count:5,web:true}); }catch(e){threw2=e.message;}
  ok('联网这一档必须先填地区', /地区/.test(threw2), threw2);
  const web=await batch.generate({region:'成都',count:5,web:true});
  ok('联网那一档带店名', web.length>0 && web.every(r=>r.place), JSON.stringify(web.map(r=>r.place)));

  return R;
});
rb.forEach(r=>ok(r.name,r.pass,r.extra));

const webReq = bodies.map(b=>b.messages.find(m=>m.role==='system')?.content||'')
  .find(x=>/verified against the\s+web/.test(x));
ok('联网那一档换了一套提示词', !!webReq && /genuinely exist/.test(webReq), (webReq||'').slice(0,120));
ok('联网那一档明说查不到就别编', /rather than inventing one/.test(webReq||''));
const plainReq = bodies.map(b=>b.messages.find(m=>m.role==='system')?.content||'')
  .find(x=>x.includes('what local people actually eat'));
// 查的是输出结构里有没有店名那一栏 —— 正文里「this kind of place」是另一回事
ok('普通那一档不提店名', !!plainReq && !plainReq.includes('"place"'),
  (plainReq||'').slice(-120));

// ---- 界面 ----
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('daily','/');
});
await page.waitForTimeout(700);
const home = await page.locator('.app-layer').innerText();
ok('日常首页有三块', home.includes('今天')&&home.includes('吃什么')&&home.includes('事件库'),
  home.slice(0,160));

await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.openApp('daily',`/today/${id}`);
}, inj.charId);
await page.waitForTimeout(700);
const today = await page.locator('.app-layer').innerText();
ok('今天这一页打得开', today.includes('去邮局取包裹'), today.slice(0,200));
ok('三顿写在对应时段里', today.includes('担担面'), today.slice(0,300));
ok('运势写成词不写数字', !today.includes('1.5'), today.slice(0,120));
await page.screenshot({path:`${OUT}/day-today.png`});

await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('daily','/food');
});
await page.waitForTimeout(600);
const foodHome = await page.locator('.app-layer').innerText();
ok('吃什么打得开', foodHome.includes('吃什么'), foodHome.slice(0,60));
ok('列出了地区', foodHome.includes('成都')&&foodHome.includes('不分地区'), foodHome.slice(0,200));
await page.screenshot({path:`${OUT}/day-food.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
