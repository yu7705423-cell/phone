// 批 5 时间性行为：延迟回复、自动回复、定时寄信、深夜情绪
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

await page.route('**/chat/completions', async r => {
  await r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content:'嗯。'}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 什么时候回：按她的状态本地算，不问模型（4.261：空闲几分钟、忙碌等做完、睡觉起床后）----
const t = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const pace=await import('/src/system/pace.js');
  const day=await import('/src/system/day.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],title:'阿岚'});

  ok('默认按按钮才回', pace.modeOf(chat)==='manual', pace.modeOf(chat));
  pace.setMode(chat.id,'乱写的');
  ok('不认识的档位退回手动', pace.modeOf(db.chats.get(chat.id))==='manual');
  pace.setMode(chat.id,pace.PACED);
  ok('设成延迟回复', pace.modeOf(db.chats.get(chat.id))==='paced');

  // rng 固定成 0.4，抖动就是 1.0 倍，剩下的全是可以算的乘法
  const rng=()=>0.4;
  const at=h=>new Date(2026,8,17,h,0,0);
  const d=(text,h)=>pace.dueFor(chat.id,text,{rng,at:at(h)})?.secs;

  ok('空闲：默认一分钟起步', d('',15)===60, d('',15));
  // 免打扰时段默认 0 到 8 点：凌晨两点在睡觉，八点起床后 0 到 20 分钟回（rng 0.4 就是 8 分钟）
  ok('睡觉：凌晨两点发的，八点零八分才回', d('',2)===6*3600+480, d('',2));
  ok('八点就算起床了', d('',8)===60, d('',8));
  pace.setSleep(chat.id,false);
  ok('关掉「休息时不回复」：凌晨也按空闲算', d('',2)===60, d('',2));
  pace.setSleep(chat.id,true);
  ok('状态念得出：休息中', pace.stateOf(db.chats.get(chat.id),at(2)).kind==='asleep');
  ok('带问号回得快一半', d('在吗？',15)===30, d('在吗？',15));
  ok('写得长回得快一些', d('一'.repeat(40),15)===42, d('一'.repeat(40),15));
  ok('问号优先于长度', d('一'.repeat(40)+'？',15)===30, d('一'.repeat(40)+'？',15));

  // 基数自己填
  pace.setPace(chat.id,{base:600});
  ok('基数改得动', pace.baseOf(db.chats.get(chat.id))===600);
  ok('改完就按新基数算', d('',15)===600, d('',15));

  // 上限：0 表示等到状态结束（第 13 条），默认就是 0
  ok('默认不封顶', pace.maxOf(db.chats.get(chat.id))===0);
  pace.setPace(chat.id,{max:120});
  ok('封顶压得住', d('',2)===120, d('',2));
  pace.setPace(chat.id,{max:0});
  ok('填 0 就是等到状态结束', d('',2)===6*3600+480, d('',2));
  pace.setPace(chat.id,{base:60,max:0});

  // 忙碌：下午排着事，等到下午那一段结束（18 点）之后 0 到 15 分钟（rng 0.4 就是 6 分钟）
  db.characters.update(c.id,{dayOn:true});
  day.save(c.id,{date:day.dateKey(c,at(15)),items:[{slot:'afternoon',text:'把稿子改完'}]});
  ok('忙碌：下午三点发的，六点零六分才回', d('',15)===3*3600+360, d('',15));
  const st=pace.stateOf(db.chats.get(chat.id),at(15));
  ok('状态念得出：正在做什么', st.kind==='busy' && st.what==='把稿子改完', JSON.stringify(st));
  // 忙碌期间连发几条：一次回，到点不往后推
  pace.clear(chat.id);
  const first=pace.schedule(chat.id,'在吗',{rng,at:at(15)});
  const second=pace.schedule(chat.id,'在吗在吗',{rng:()=>0.9,at:at(15)});
  ok('忙碌期间再发一条：到点不往后推', second.dueAt===first.dueAt, `${first.dueAt} / ${second.dueAt}`);
  ok('横幅念得出正在做什么', pace.pendingText(db.chats.get(chat.id)).startsWith('对方正在把稿子改完，'), pace.pendingText(db.chats.get(chat.id)));
  pace.clear(chat.id);
  db.days.byIndex(c.id).slice().forEach(d => db.days.remove(d.id));
  db.characters.update(c.id,{dayOn:false});

  // 抖动：两头都要落在范围里
  const lo=pace.dueFor(chat.id,'',{rng:()=>0,at:at(15)}).secs;
  const hi=pace.dueFor(chat.id,'',{rng:()=>0.999,at:at(15)}).secs;
  ok('抖动在 0.6 到 1.6 倍之间', lo===36 && hi===96, `${lo} / ${hi}`);

  // 待回复记在会话上
  ok('还没排就是空的', pace.pendingOf(db.chats.get(chat.id))===null);
  const s=pace.schedule(chat.id,'在吗？',{rng,at:at(15)});
  ok('排上了', s.secs===30 && s.dueAt>Date.now());
  const withP=db.chats.get(chat.id);
  ok('记在会话上，关掉页面也还在', pace.pendingOf(withP)?.secs===30);
  ok('还差多久算得出', pace.leftOf(withP)>25000 && pace.leftOf(withP)<=30000, pace.leftOf(withP));
  pace.clear(chat.id);
  ok('取消得掉', pace.pendingOf(db.chats.get(chat.id))===null);

  ok('念给人听：秒', pace.leftText(9000)==='约 9 秒后回复', pace.leftText(9000));
  ok('念给人听：分钟', pace.leftText(150000)==='约 3 分钟后回复', pace.leftText(150000));
  ok('念给人听：小时', pace.leftText(7200000)==='约 2 小时后回复', pace.leftText(7200000));
  ok('过点了就说快回了', pace.leftText(0)==='就快回复了');
  ok('没排就是空串', pace.leftText(null)==='');

  // 到点的那几段挑得出来
  pace.schedule(chat.id,'',{rng,at:at(15)});
  ok('没到点不算到点', pace.dueChats(Date.now()).length===0);
  ok('到点了挑得出来', pace.dueChats(Date.now()+120000).some(x=>x.id===chat.id));
  pace.clear(chat.id);

  return { R, chatId:chat.id, charId:c.id };
});
t.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 自动回复：两道闸都要主动关掉并说一声 ----
const a = await page.evaluate(async ({chatId}) => {
  const db=await import('/src/system/db/index.js');
  const auto=await import('/src/system/autoreply.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=()=>db.chats.get(chatId);
  const texts=()=>db.messages.byIndex(chatId).map(m=>m.content);

  ok('默认两边都关着', !auto.isOn(chat(),'mine') && !auto.isOn(chat(),'hers'));
  auto.setConfig(chatId,'hers',{on:true,text:''});
  ok('没填话就不算开着', !auto.isOn(chat(),'hers'));

  auto.setConfig(chatId,'hers',{on:true,text:'在开会，晚点回你。',max:2});
  ok('填了话才算开着', auto.isOn(chat(),'hers'));
  ok('还剩两条', auto.leftOf(chat(),'hers')===2);

  const m1=auto.fire(chatId,'hers');
  ok('回的是她', m1 && m1.role==='char' && m1.content==='在开会，晚点回你。', m1&&m1.role);
  ok('回完只剩一条', auto.leftOf(chat(),'hers')===1);
  const m2=auto.fire(chatId,'hers');
  ok('第二条也回得出', !!m2);
  ok('到条数就自己关了', !auto.isOn(chat(),'hers'));
  ok('关的时候说了一声', texts().some(x=>x.includes('自动回复已停止')&&x.includes('条数上限')), texts().join(' | '));
  ok('关了就不再回', auto.fire(chatId,'hers')===null);

  // 条数填 0 就是不限（第 13 条）
  db.messages.byIndex(chatId).filter(m=>m.kind==='notice').forEach(m=>db.messages.remove(m.id));
  auto.setConfig(chatId,'hers',{on:true,text:'在忙。',max:0});
  ok('填 0 就是不限条数', auto.leftOf(chat(),'hers')===Infinity);
  for(let i=0;i<5;i++) auto.fire(chatId,'hers');
  ok('不限条数就一直回得动', auto.isOn(chat(),'hers'));

  // 时限
  auto.setConfig(chatId,'hers',{on:true,text:'在忙。',max:0,until:Date.now()-1000});
  ok('过了结束时间就不回', auto.fire(chatId,'hers')===null);
  ok('到点也自己关了', !auto.isOn(chat(),'hers'));
  ok('到点也说了一声', db.messages.byIndex(chatId).some(m=>m.content.includes('结束时间')));

  // 我这边
  auto.setConfig(chatId,'mine',{on:true,text:'我在忙，晚点看。',max:1});
  const mine=auto.fire(chatId,'mine');
  ok('我这边回的是我', mine && mine.role==='user' && mine.authorId==='me', mine&&mine.role);
  const banner=auto.bannerOf(chat());
  ok('开着的时候有横幅', !banner, banner);   // 刚好用完关掉了
  auto.setConfig(chatId,'mine',{on:true,text:'我在忙。',max:3});
  ok('横幅写清还能回几条', auto.bannerOf(chat()).includes('还可回 3 条'), auto.bannerOf(chat()));
  auto.setConfig(chatId,'mine',{on:true,text:'我在忙。',max:0});
  ok('不限条数的横幅也写清楚', auto.bannerOf(chat()).includes('不限条数'), auto.bannerOf(chat()));
  auto.setConfig(chatId,'mine',{on:false});
  auto.setConfig(chatId,'hers',{on:false});
  return R;
}, {chatId:t.chatId});
a.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 定时寄信 ----
const s = await page.evaluate(async ({chatId}) => {
  const db=await import('/src/system/db/index.js');
  const space=await import('/src/system/space.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const now=Date.now();
  const later=space.saveDraft({chatId,title:'等一等',body:'这封还没到点。',sendAt:now+3600000});
  const due=space.saveDraft({chatId,title:'到点了',body:'这封该寄了。',sendAt:now-1000});
  const plain=space.saveDraft({chatId,title:'不定时',body:'这封一直留着。'});
  ok('不定时的就是 0', plain.sendAt===0, plain.sendAt);

  const out=space.deliverDue(now);
  ok('只寄到点的那一封', out.length===1 && out[0].title==='到点了', out.map(m=>m.title).join(','));
  ok('寄出去的从草稿里清掉', !space.drafts(chatId).some(d=>d.id===due.id));
  ok('没到点的还在', space.drafts(chatId).some(d=>d.id===later.id));
  ok('不定时的也还在', space.drafts(chatId).some(d=>d.id===plain.id));
  ok('落成一条信', db.messages.byIndex(chatId).some(m=>m.kind==='letter'&&m.title==='到点了'));
  ok('时间按写好的那一刻算', out[0].createdAt<=now, out[0].createdAt-now);
  ok('再跑一遍不会重寄', space.deliverDue(now).length===0);
  return R;
}, {chatId:t.chatId});
s.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 深夜情绪 ----
const e = await page.evaluate(async ({charId}) => {
  const db=await import('/src/system/db/index.js');
  const pro=await import('/src/system/ai/proactive.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const char=()=>db.characters.get(charId);

  ok('默认关着', !pro.configOf(char()).emo);
  const night=new Date(2026,8,17,2,0,0), noon=new Date(2026,8,17,14,0,0);
  ok('关着的时候深夜也不来', !pro.emoDue(char(),{at:night}));

  db.characters.update(charId,{emo:true,emoFrom:1,emoTo:4,emoDays:5});
  ok('开了并且到点就来', pro.emoDue(char(),{at:night}));
  ok('白天不来', !pro.emoDue(char(),{at:noon}));
  ok('时段跨零点认得出', pro.inEmoHours({emoFrom:23,emoTo:3},new Date(2026,8,17,0,30)),'');
  ok('起止一样就当没开', !pro.inEmoHours({emoFrom:2,emoTo:2},night));

  // 隔几天才一次：定死每晚就成了固定节目
  const D=86400000;
  localStorage.setItem('phone.proactive.emo', JSON.stringify({[charId]:Date.now()}));
  ok('刚来过就不再来', !pro.emoDue(char(),{at:night}));
  ok('隔一天还不够', !pro.emoDue(char(),{now:pro.emoAt(charId)+D,at:night}));
  ok('隔够五天才来', pro.emoDue(char(),{now:pro.emoAt(charId)+5*D,at:night}));
  db.characters.update(charId,{emoDays:0});
  ok('间隔填 0 就每晚都可能来', pro.emoDue(char(),{at:night}), String(pro.configOf(char()).emoDays));
  localStorage.removeItem('phone.proactive.emo');
  db.characters.update(charId,{emo:false});
  return R;
}, {charId:t.charId});
e.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 设置页 ----
await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat',`/pace/${id}`);
}, t.chatId);
await page.waitForTimeout(700);
const ui = await page.locator('.app-layer').innerText();
ok('回复节奏这一页打得开', ui.includes('按按钮')&&ui.includes('发完就回')&&ui.includes('延迟回复'), ui.slice(0,200));
ok('三档的说明都摆在明处', ui.includes('不再调用接口')||ui.includes('本地'), ui.slice(0,400));
ok('两边的自动回复都在', (ui.match(/自动回复/g)||[]).length>=2, ui.slice(0,600));
ok('页面上没有裸露的英文 id', !/\b(manual|paced|hers|mine)\b/.test(ui), (ui.match(/\b(manual|paced|hers|mine)\b/)||[])[0]);
await page.screenshot({path:`${OUT}/pace-page.png`});

// 会话页那一行横幅
await page.evaluate(async ({chatId}) => {
  const auto=await import('/src/system/autoreply.js');
  const pace=await import('/src/system/pace.js');
  auto.setConfig(chatId,'hers',{on:true,text:'在开会。',max:3});
  pace.setMode(chatId,pace.PACED);
  pace.setSleep(chatId,false);   // 测试可能在夜里跑
  pace.schedule(chatId,'在吗？',{rng:()=>0.999});
  const nav=await import('/src/system/nav.js'); nav.openApp('chat',`/chat/${chatId}`);
}, {chatId:t.chatId});
await page.waitForTimeout(800);
const conv = await page.locator('.app-layer').innerText();
ok('会话页写着自动回复开着', conv.includes('自动回复开着'), conv.slice(0,300));
ok('会话页写着还要等多久', /约 \d+ (秒|分钟)后回复/.test(conv), conv.slice(0,300));
const bar = await page.locator('.pace-bar').count();
ok('横幅点得动，通到设置页', bar===1, String(bar));
await page.screenshot({path:`${OUT}/pace-bar.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
