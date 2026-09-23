// 批 2a 随机事件库 + 批量生成
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

// 批量生成那几次调用：按 system 里写的条数返一批，其中故意夹一条和库里重的
const bodies=[];
await page.route('**/chat/completions', async r => {
  const body=JSON.parse(r.request().postData()||'{}');
  bodies.push(body);
  const sys=body.messages.find(m=>m.role==='system')?.content||'';
  const n=Number((sys.match(/条数：(\d+) 条/)||[])[1])||3;
  const tag=(sys.match(/领域：(\S+?)（/)||[])[1]+(sys.match(/色彩：(\S+?)（/)||[])[1];
  const list=[];
  list.push({text:'库里已经有的那一条'});          // 和已有的重
  list.push({text:'同一批里重的'});
  list.push({text:'同一批里重的。'});               // 只差一个句号，normalize 之后一样
  for(let i=list.length;i<n;i++) list.push({text:`${tag}的第${i}件事`});
  await r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content:JSON.stringify({events:list})}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- draw.js：抽法本身 ----
const d = await page.evaluate(async () => {
  const draw=await import('/src/system/draw.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const seq=vals=>{let i=0;return()=>vals[i++%vals.length];};
  const items=[{id:'a',weight:1},{id:'b',weight:1},{id:'c',weight:8}];

  ok('落在第一段就给第一个', draw.pick(items,{rng:seq([0])})?.id==='a');
  ok('落在最后一段就给最后一个', draw.pick(items,{rng:seq([0.99])})?.id==='c');
  ok('权重大的占的段也长', draw.pick(items,{rng:seq([0.5])})?.id==='c',
    draw.pick(items,{rng:seq([0.5])})?.id);
  ok('空池子给 null', draw.pick([],{rng:seq([0.5])})===null);
  ok('全是 0 权重也给 null', draw.pick([{id:'x',weight:0}],{rng:seq([0.5])})===null);

  // 大数定律：权重 8 的那个应该占八成上下
  let c=0; for(let i=0;i<4000;i++) if(draw.pick(items)?.id==='c') c++;
  ok('抽一万次比例对得上', c/4000>0.7 && c/4000<0.85, (c/4000).toFixed(3));

  // 冷却：压一压，不是封杀
  ok('刚抽过的罚得最狠', draw.penalty('a',['a','b','c'],3)===0.25, draw.penalty('a',['a','b','c'],3));
  ok('越往后罚得越轻', draw.penalty('c',['a','b','c'],3)===0.75, draw.penalty('c',['a','b','c'],3));
  ok('出了范围就完全恢复', draw.penalty('d',['a','b','c'],3)===1);
  ok('冷却填 0 就不压', draw.penalty('a',['a'],0)===1);
  const solo=[{id:'a',weight:1}];
  let hit=0; for(let i=0;i<500;i++) if(draw.pick(solo,{recent:['a'],cooldown:12})) hit++;
  ok('池子里只剩它时照样抽得到（压不是封杀）', hit===500, hit);

  // 掷与距上次
  ok('概率 0 永远不发生', !draw.roll(0,seq([0])));
  ok('概率 1 一定发生', draw.roll(1,seq([0.999])));
  ok('超出范围夹回来', draw.roll(5,seq([0.999])) && !draw.roll(-3,seq([0])));
  ok('当天就是基础概率', draw.overdue(0.3,1)===0.3, draw.overdue(0.3,1));
  ok('隔一天就加一截', draw.overdue(0.3,2)>0.3 && draw.overdue(0.3,2)<0.5, draw.overdue(0.3,2));
  ok('久了也不会超过 1', draw.overdue(0.3,100)===1);

  // 慢变量有惯性
  const half=()=>0.5;   // push 恒为 0
  ok('没有推力就往回收', draw.drift(2,{rng:half})===1.4, draw.drift(2,{rng:half}));
  ok('撞到上界会被夹住', draw.drift(2,{rng:()=>1})<=2);
  ok('撞到下界也会被夹住', draw.drift(-2,{rng:()=>0})>=-2);
  let mx=-9,mn=9,cur=0;
  for(let i=0;i<3000;i++){cur=draw.drift(cur);mx=Math.max(mx,cur);mn=Math.min(mn,cur);}
  ok('长期跑不出上下界', mx<=2&&mn>=-2, `${mn} ~ ${mx}`);

  return R;
});
d.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- events.js：库与抽取 ----
const e = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const events=await import('/src/system/events.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  db.events.all().forEach(x=>db.events.remove(x.id));

  ok('三个领域三种色彩', events.DOMAINS.length===3 && events.TONES.length===3);
  ok('分量两档，少见的轻一个量级',
    events.rarityOf('common').weight===10 && events.rarityOf('rare').weight===1);
  ok('九个格子', events.cells().length===9);

  const a=events.add({domain:'env',tone:'good',text:'路上一路绿灯'});
  ok('落库时记下了格子', a.cell==='env:good', a.cell);
  ok('按格子查得到', events.list({domain:'env',tone:'good'}).length===1);
  ok('别的格子是空的', events.list({domain:'env',tone:'bad'}).length===0);
  ok('九宫格数得对', events.counts()['env:good']===1, JSON.stringify(events.counts()));

  ok('不写内容会拦住', (()=>{try{events.add({domain:'env',tone:'good',text:' '});return false;}catch{return true;}})());
  ok('领域不对会拦住', (()=>{try{events.add({domain:'乱写',tone:'good',text:'x'});return false;}catch{return true;}})());

  // 去重：去掉标点空白之后一样就算重
  ok('标点不算区别', events.normalize('下雨了。')===events.normalize('下雨了'));
  ok('查得出重复', events.has('  路上一路绿灯 ',{domain:'env',tone:'good'}));
  ok('别的格子不算重', !events.has('路上一路绿灯',{domain:'social',tone:'bad'}));
  const made=events.addMany([
    {domain:'env',tone:'good',text:'路上一路绿灯'},     // 和已有的重
    {domain:'env',tone:'good',text:'路上一路绿灯！'},   // 只差标点
    {domain:'env',tone:'good',text:'电梯刚好停在这层'},
    {domain:'env',tone:'good',text:'电梯刚好停在这层'}, // 同一批里重
  ]);
  ok('一批里重的和已有的都被挡下', made.length===1 && made[0].text==='电梯刚好停在这层',
    JSON.stringify(made.map(x=>x.text)));

  // 权重：分量 × 自己的权重 × 大运偏向
  const rare=events.add({domain:'env',tone:'good',text:'捡到一把好伞',rarity:'rare'});
  ok('平常的比少见的重十倍',
    events.weightOf(a,0)===10*events.weightOf(rare,0), `${events.weightOf(a,0)} / ${events.weightOf(rare,0)}`);
  events.update(rare.id,{weight:3});
  ok('自己的权重再乘一道', events.weightOf(db.events.get(rare.id),0)===3, events.weightOf(db.events.get(rare.id),0));
  events.update(rare.id,{weight:1});

  ok('顺的时候好事更重', events.toneWeight('good',2)>events.toneWeight('good',0));
  ok('顺的时候坏事更轻', events.toneWeight('bad',2)<events.toneWeight('bad',0));
  ok('不好不坏谁也不偏', events.toneWeight('plain',2)===1 && events.toneWeight('plain',-2)===1);
  ok('偏向不会压到 0', events.toneWeight('bad',99)>0, events.toneWeight('bad',99));

  ok('停用的抽不到', (()=>{
    events.update(a.id,{off:true});
    const w=events.weightOf(db.events.get(a.id),0);
    events.update(a.id,{off:false});
    return w===0;
  })());

  // 抽
  const hit=events.draw({domain:'env',tone:'good',rng:()=>0});
  ok('抽得出来', !!hit && hit.cell==='env:good', JSON.stringify(hit&&hit.text));
  ok('空格子抽出 null', events.draw({domain:'luck',tone:'bad',rng:()=>0})===null);

  // 大运
  const c=db.characters.create({name:'阿岚'});
  ok('没设就是 0', events.luckOf(db.characters.get(c.id))===0);
  events.advanceLuck(c.id,{rng:()=>1});
  ok('挪过之后记在角色身上', db.characters.get(c.id).luck>0, db.characters.get(c.id).luck);
  ok('有标签可读', typeof events.luckLabel(1.5)==='string' && events.luckLabel(1.5)==='顺');
  db.characters.update(c.id,{luck:0});

  // 今天撞不撞得上
  db.settings.set({eventChance:0});
  ok('概率填 0 就永远不发生', events.rollEvent({charId:c.id,rng:()=>0})===null);
  db.settings.set({eventChance:1});
  ok('概率拉满就一定发生', !!events.rollEvent({charId:c.id,rng:()=>0}));
  // 运势只往上加不往下减：填了 100% 就该每天都有，不该被运势悄悄打个折
  db.characters.update(c.id,{luck:2});
  ok('顺的时候 100% 还是 100%', !!events.rollEvent({charId:c.id,rng:()=>0.999}),
    String(db.characters.get(c.id).luck));
  db.characters.update(c.id,{luck:-2});
  ok('背的时候也一定发生', !!events.rollEvent({charId:c.id,rng:()=>0.999}));
  db.settings.set({eventChance:0.5});
  db.characters.update(c.id,{luck:0});
  const plain=events.rollEvent({charId:c.id,rng:()=>0.6})===null;
  db.characters.update(c.id,{luck:-2});
  const unlucky=!!events.rollEvent({charId:c.id,rng:()=>0.6});
  ok('背的时候概率往上抬', plain && unlucky, `${plain} / ${unlucky}`);
  db.characters.update(c.id,{luck:0});
  db.characters.update(c.id,{eventsOn:false});
  ok('角色关掉就不发生', events.rollEvent({charId:c.id,rng:()=>0})===null);
  db.characters.update(c.id,{eventsOn:true});
  db.settings.set({eventChance:0.35});

  return { R, charId:c.id };
});
e.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 批量生成 ----
const g = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const events=await import('/src/system/events.js');
  const batch=await import('/src/system/ai/tasks/event-batch.js');
  const svc=await import('/src/system/ai/services.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m'});

  db.events.all().forEach(x=>db.events.remove(x.id));
  events.add({domain:'env',tone:'good',text:'库里已经有的那一条'});

  const rows=await batch.generateCell({domain:'env',tone:'good',rarity:'common',count:6});
  ok('生成回来的还没入库', db.events.all().length===1, db.events.all().length);
  ok('和库里重的被挡下', !rows.some(r=>r.text==='库里已经有的那一条'), JSON.stringify(rows.map(r=>r.text)));
  ok('同一批里重的只留一条',
    rows.filter(r=>events.normalize(r.text)===events.normalize('同一批里重的')).length===1,
    JSON.stringify(rows.map(r=>r.text)));
  ok('格子与分量带回来了', rows.every(r=>r.domain==='env'&&r.tone==='good'&&r.rarity==='common'));

  const made=events.addMany(rows);
  ok('入库之后库里多了这些', db.events.all().length===1+made.length);

  // 一整张表：只跑填了数的格子
  db.events.all().forEach(x=>db.events.remove(x.id));
  const r2=await batch.generatePlan({'env:good':3,'social:bad':3,'luck:plain':0},{rarity:'rare'});
  ok('只跑填了数的格子', r2.cells===2, r2.cells);
  ok('两格的东西都拿回来了',
    r2.rows.some(x=>x.tone==='good') && r2.rows.some(x=>x.tone==='bad'),
    JSON.stringify(r2.rows.map(x=>x.cell||`${x.domain}:${x.tone}`)));
  ok('分量按这一批选的走', r2.rows.every(x=>x.rarity==='rare'));
  ok('没有一格失败', r2.failed.length===0, JSON.stringify(r2.failed));

  return R;
});
g.forEach(r=>ok(r.name,r.pass,r.extra));

// 发出去的那几次请求长什么样
ok('一格一次调用', bodies.length>=3, String(bodies.length));
const sys = bodies.map(b=>b.messages.find(m=>m.role==='system')?.content||'');
ok('不带人设也不带聊天历史', sys.every(x=>!x.includes('[你是谁]')&&!x.includes('[对话记忆')), sys[0]?.slice(0,80));
ok('把已有的发过去了去重', sys.some(x=>x.includes('库里已经有的那一条')), sys[0]?.slice(0,200));
// 任务模板正文已经全部改成英文（第 14 条），注进去的领域名、色彩名仍是中文数据
ok('写明了这一格是哪个乘哪个',
  sys.every(x=>/Domain: \S+ \(/.test(x)&&/Tone: \S+ \(/.test(x)), sys[0]?.slice(0,200));
ok('写明了条数', sys.every(x=>/Count: \d+/.test(x)));
ok('每次都是各自的用户消息', bodies.every(b=>b.messages.filter(m=>m.role==='user').length===1));

// ---- 界面 ----
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('daily','/');
});
await page.waitForTimeout(700);
const home = await page.locator('.app-layer').innerText();
ok('日常打得开', home.includes('日常'), home.slice(0,60));
ok('九宫格在', await page.locator('.ev-cell').count()===9, await page.locator('.ev-cell').count());
ok('三个领域都写了', home.includes('环境')&&home.includes('人际')&&home.includes('运气'));
ok('三种色彩都写了', home.includes('好事')&&home.includes('坏事')&&home.includes('不好不坏'));
await page.screenshot({path:`${OUT}/ev-home.png`});

await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('daily','/cell/env/good');
});
await page.waitForTimeout(600);
const cell = await page.locator('.app-layer').innerText();
ok('格子页打得开', cell.includes('环境 · 好事'), cell.slice(0,60));

await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('daily','/gen');
});
await page.waitForTimeout(600);
const gen = await page.locator('.app-layer').innerText();
ok('批量生成页打得开', gen.includes('批量生成'), gen.slice(0,60));
ok('九个格子各有一个输入框', await page.locator('.ev-input input').count()===9,
  await page.locator('.ev-input input').count());
ok('输入框没有 max', await page.locator('.ev-input input').first().getAttribute('max')===null);
await page.locator('.ev-input input').first().fill('4');
await page.waitForTimeout(300);
const gen2 = await page.locator('.app-layer').innerText();
ok('填了数按钮上就写清楚要跑几格', gen2.includes('生成 1 格，共 4 条'), gen2.slice(-160));
await page.screenshot({path:`${OUT}/ev-gen.png`});

await page.locator('.btn-primary').last().click();
await page.waitForTimeout(1500);
const conf = await page.locator('.app-layer').innerText();
ok('先到确认页，不是直接入库', conf.includes('确认入库'), conf.slice(0,80));
await page.screenshot({path:`${OUT}/ev-confirm.png`});
const before = await page.evaluate(async()=>(await import('/src/system/db/index.js')).events.count());
await page.locator('.list-item').first().click();      // 取消勾选第一条
await page.waitForTimeout(250);
await page.locator('.btn-primary').last().click();
await page.waitForTimeout(700);
const after = await page.evaluate(async()=>(await import('/src/system/db/index.js')).events.count());
ok('取消勾选的那条没入库', after-before>0 && after-before<4, `${before} -> ${after}`);

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
