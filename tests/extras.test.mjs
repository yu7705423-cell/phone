// 批 3 关系小件：心声、拍一拍、特别关心、骰子、头像联动
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
const bodies=[];
await page.route('**/chat/completions', async r => {
  const body=JSON.parse(r.request().postData()||'{}'); bodies.push(body);
  const sys=body.messages.find(m=>m.role==='system')?.content||'';
  await r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content: sys.includes('what you were actually thinking') ? '其实根本不想去。' : '好'}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 拍一拍 / 骰子 / 特别关心 ----
const a = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const ex=await import('/src/system/extras.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  db.personas.update(me.id,{name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});

  // 后缀归被拍的那一方
  ex.setCharPat(c.id,'的尾巴');
  ex.setMyPat('的脑门');
  const p1=ex.pat({chatId:chat.id,role:'user'});
  ok('我拍它用它的后缀', p1.content==='[小明拍了拍阿岚的尾巴]', p1.content);
  const p2=ex.pat({chatId:chat.id,role:'char'});
  ok('它拍我用我的后缀', p2.content==='[阿岚拍了拍小明的脑门]', p2.content);
  ok('拍一拍是提示行不是消息', p1.kind==='notice' && p2.kind==='notice');
  ok('落在正确的一侧', p1.role==='user' && p2.role==='char' && p2.authorId===c.id);
  ex.setCharPat(c.id,'');
  ok('不填就用默认后缀', ex.pat({chatId:chat.id,role:'user'}).content===`[小明拍了拍阿岚${ex.DEFAULT_PAT}]`);

  // 骰子：本地掷，点数落在消息上
  ok('默认六面', ex.facesOf(db.chats.get(chat.id))===6);
  const seq=v=>{let i=0;return()=>v[i++%v.length];};
  const d1=ex.roll({chatId:chat.id,role:'user',rng:seq([0])});
  ok('最小值是 1', d1.value===1, d1.value);
  const d2=ex.roll({chatId:chat.id,role:'user',rng:seq([0.999])});
  ok('最大值就是面数', d2.value===6, d2.value);
  ok('六面的不写面数', d2.content==='[骰子：6]', d2.content);
  ex.setFaces(chat.id,20);
  const d3=ex.roll({chatId:chat.id,role:'user',rng:seq([0.999])});
  ok('换了面数就写出来', d3.value===20 && d3.content==='[骰子：20（20 面）]', d3.content);
  ok('面数存在会话上', ex.facesOf(db.chats.get(chat.id))===20);
  ex.setFaces(chat.id,1);
  ok('小于两面的落回默认六面', ex.facesOf(db.chats.get(chat.id))===6, ex.facesOf(db.chats.get(chat.id)));
  // 一百次都落在范围内
  let bad=0; for(let i=0;i<200;i++){const v=ex.roll({chatId:chat.id}).value; if(v<1||v>6||v!==Math.floor(v))bad++;}
  ok('点数永远在范围内且是整数', bad===0, bad);

  // 特别关心
  ok('默认不是特别关心', !ex.isStarred(db.characters.get(c.id)));
  ok('没开就不加前缀', ex.starTitle(db.characters.get(c.id),'阿岚')==='阿岚');
  ex.setStar(c.id,true);
  ok('开了就加前缀', ex.starTitle(db.characters.get(c.id),'阿岚')==='【特别关心】阿岚',
    ex.starTitle(db.characters.get(c.id),'阿岚'));

  // 心声的模式与样式
  ok('心声默认关着', ex.innerMode(db.chats.get(chat.id))===ex.INNER_OFF && !ex.innerOn(db.chats.get(chat.id)));
  ex.setInnerMode(chat.id,'乱写');
  ok('不认识的模式落回关闭', ex.innerMode(db.chats.get(chat.id))===ex.INNER_OFF);
  ex.setInnerMode(chat.id,ex.INNER_INLINE);
  ok('设得上', ex.innerMode(db.chats.get(chat.id))===ex.INNER_INLINE && ex.innerOn(db.chats.get(chat.id)));
  ok('样式默认淡色小字', ex.innerStyle()==='quiet');
  ex.setInnerStyle('card'); ok('样式换得了', ex.innerStyle()==='card');
  ex.setInnerStyle('乱写'); ok('不认识的样式落回默认', ex.innerStyle()==='quiet');

  return { R, chatId:chat.id, charId:c.id, meId:me.id };
});
a.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 模型写的那几行 ----
const mk = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const reply=await import('/src/system/ai/reply.js');
  const ex=await import('/src/system/extras.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=db.chats.get(ids.chatId), char=db.characters.get(ids.charId);

  const p=reply.splitReply('想你了\n[拍一拍]');
  ok('[拍一拍] 解析出来了', JSON.stringify(p.map(x=>x.type))==='["text","pat"]', JSON.stringify(p.map(x=>x.type)));
  ok('[骰子] 也认', reply.splitReply('[骰子]')[0]?.type==='dice');
  ok('[扔骰子] 同义词也认', reply.splitReply('[扔骰子]')[0]?.type==='dice');
  const iv=reply.splitReply('今天不去了\n[心声：其实是不想见他]');
  ok('心声挂在上一条上，不自己占气泡',
    iv.length===1 && iv[0].type==='text' && iv[0].inner==='其实是不想见他', JSON.stringify(iv));
  const iv2=reply.splitReply('[心声：前面没有话]');
  ok('前面没有话的心声就丢掉', iv2.length===0, JSON.stringify(iv2));
  ok('[换头像] 解析出来了', reply.splitReply('[换头像：白猫]')[0]?.name==='白猫');

  const before=db.messagesOf(chat.id).length;
  await reply.renderTurn({chat,char,raw:'想你了\n[拍一拍]',turnId:'e1',instant:true});
  const made=db.messagesOf(chat.id).slice(before);
  ok('角色拍了我', made.some(m=>m.kind==='notice'&&m.pat), JSON.stringify(made.map(m=>m.kind)));
  ok('用的是我的后缀', made.find(m=>m.pat)?.content.includes('的脑门'), made.find(m=>m.pat)?.content);

  await reply.renderTurn({chat,char,raw:'交给运气吧\n[骰子]',turnId:'e2',instant:true});
  const dice=db.messagesOf(chat.id).filter(m=>m.kind==='dice'&&m.role==='char');
  ok('角色掷出了一条骰子', dice.length===1 && dice[0].value>=1 && dice[0].value<=6, JSON.stringify(dice[0]));

  // 心声随回复一起
  await reply.renderTurn({chat,char,raw:'那就这样吧\n[心声：其实还想再聊一会儿]',turnId:'e3',instant:true});
  const last=db.messagesOf(chat.id).filter(m=>m.turnId==='e3');
  ok('心声存在那一条消息上', last.some(m=>m.inner==='其实还想再聊一会儿'), JSON.stringify(last.map(m=>m.inner)));
  ok('心声不占气泡', last.filter(m=>m.kind==='text').length===1, last.length);
  ok('心声不进正文', last.every(m=>!String(m.content).includes('还想再聊')), JSON.stringify(last.map(m=>m.content)));

  return R;
}, a);
mk.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 心声：单独生成那一档 ----
const ap = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const ex=await import('/src/system/extras.js');
  const inner=await import('/src/system/ai/tasks/inner.js');
  const svc=await import('/src/system/ai/services.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m'});
  const chat=db.chats.get(ids.chatId), char=db.characters.get(ids.charId);

  const mk=t=>db.messages.create({chatId:chat.id,role:'char',authorId:char.id,kind:'text',content:t,status:'done'});
  const created=[mk('那就这样吧'),mk('我先去忙了')];

  ex.setInnerMode(chat.id, ex.INNER_INLINE);
  ok('不是单独那一档就不跑', await inner.attach(chat.id,created)===null);
  ex.setInnerMode(chat.id, ex.INNER_APART);
  const text=await inner.attach(chat.id,created);
  ok('补上了一段心声', text==='其实根本不想去。', text);
  ok('挂在她最后说的那一条上', db.messages.get(created[1].id).inner==='其实根本不想去。',
    JSON.stringify([db.messages.get(created[0].id).inner,db.messages.get(created[1].id).inner]));
  ok('挂的是最后一条不是第一条', !db.messages.get(created[0].id).inner);

  ok('整轮都不是文字就不挂', ex.innerTarget([{role:'char',kind:'dice'}])===null);
  ok('用户说的话不挂心声', ex.innerTarget([{role:'user',kind:'text'}])===null);
  ex.setInnerMode(chat.id, ex.INNER_INLINE);
  return R;
}, a);
ap.forEach(r=>ok(r.name,r.pass,r.extra));

const innerReq = bodies.map(b=>b.messages.find(m=>m.role==='system')?.content||'').find(x=>x.includes('what you were actually thinking'));
ok('心声是单独一次调用', !!innerReq);
ok('带了人设', (innerReq||'').includes('## Who you are'), (innerReq||'').slice(0,120));
// 「不要复述刚才说的话」这条已经不写了：怎么想是角色的事，不是格式规则（第 16 条）。
// 留下的只有一条格式要求：不带「心声：」前缀，那一段由本地补
ok('只提格式要求，不规定想什么',
  (innerReq||'').includes('no 「心声：」 prefix'), (innerReq||'').slice(-160));

// ---- 能力目录 ----
const cap = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const caps=await import('/src/system/ai/capabilities.js');
  const ex=await import('/src/system/extras.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=db.chats.get(ids.chatId);
  const build=()=>caps.capabilityBlock({chat:db.chats.get(ids.chatId),
    char:db.characters.get(ids.charId),messages:[],settings:db.settings.get()});

  db.settings.set({promptLean:true});
  const t=build();
  // 标记名留中文，说明文字是英文（第 14 条）
  ok('冷着只给拍一拍那一行', t.includes('Nudge: write a line on its own, [拍一拍]'));
  ok('冷着只给骰子那一行', t.includes('Roll a die: write a line on its own, [骰子]'));
  ok('骰子那一行就写明了这一轮不知道点数',
    t.includes('the result is not knowable this turn'), t.slice(0,400));
  ok('心声是常驻的（随回复一起那一档）',
    t.includes('[心声：what you are actually thinking at this moment]'), t.slice(-400));

  ex.setInnerMode(chat.id, ex.INNER_APART);
  ok('单独生成那一档不在能力目录里说写法',
    !build().includes('[心声：what you are actually thinking at this moment]'));
  ex.setInnerMode(chat.id, ex.INNER_INLINE);

  db.characters.update(ids.charId,{canPat:false,canDice:false});
  const off=build();
  ok('角色卡上关掉就一个字不提', !off.includes('拍一拍') && !off.includes('骰子'));
  db.characters.update(ids.charId,{canPat:true,canDice:true});

  ok('头像库是空的就不提换头像', !build().includes('换头像'));
  return R;
}, a);
cap.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 头像联动 ----
const av = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const avatar=await import('/src/system/avatar.js');
  const caps=await import('/src/system/ai/capabilities.js');
  const blocks=await import('/src/system/ai/context/index.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  // 只说看得见的，不替用户解释
  ok('纯黑就说几乎全黑', avatar.describe({light:0.01,sat:0,r:0,g:0,b:0})==='几乎全黑');
  ok('纯白就说几乎全白', avatar.describe({light:0.99,sat:0,r:255,g:255,b:255})==='几乎全白');
  ok('不解读含义', !avatar.describe({light:0.01,sat:0,r:0,g:0,b:0}).includes('心情'));
  ok('灰调说没有颜色', avatar.describe({light:0.5,sat:0.02,r:128,g:128,b:128}).includes('没有颜色'),
    avatar.describe({light:0.5,sat:0.02,r:128,g:128,b:128}));
  ok('认得出色相', avatar.describe({light:0.4,sat:0.8,r:200,g:20,b:20}).includes('红'),
    avatar.describe({light:0.4,sat:0.8,r:200,g:20,b:20}));
  ok('读不出来就给空串', avatar.describe(null)==='');

  // 真造一张纯黑的图走一遍
  const cv=document.createElement('canvas'); cv.width=cv.height=8;
  const cx=cv.getContext('2d'); cx.fillStyle='#000'; cx.fillRect(0,0,8,8);
  const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
  const imgId=await db.images.put(new File([blob],'a.png',{type:'image/png'}));
  const note=await avatar.note(imgId);
  ok('真图也认得出', note==='几乎全黑', note);

  // 换头像 -> 下一轮提一句 -> 再下一轮就不提了
  const me=db.personas.get(ids.meId);
  db.personas.update(me.id,{avatar:imgId});
  await avatar.rememberMine(me.id, imgId);
  ok('描述存回了人设上', db.personas.get(me.id).avatarNote==='几乎全黑');

  const chat=db.chats.get(ids.chatId), char=db.characters.get(ids.charId);
  const ctx=()=>({chat:db.chats.get(ids.chatId),char:db.characters.get(ids.charId),
    messages:[],persona:db.personas.get(me.id),settings:db.settings.get()});
  const t1=blocks.BLOCKS.avatar.build(ctx());
  ok('换了就提一句',
    t1.includes('The other party changed their avatar') && t1.includes('几乎全黑'), t1);
  // 只陈述客观事实，不替角色解读（第 16 条）：写「几乎全黑」，不写「看起来心情不好」
  ok('提示里不替她下结论',
    !/心情|mood|upset/.test(t1) && t1.includes('This is a fact visible to you'), t1);
  avatar.markSeen(chat.id, imgId);
  ok('记过一笔之后就不再提', blocks.BLOCKS.avatar.build(ctx())==='');

  // 头像库
  ok('空库没有名字', avatar.poolNames(char)==='');
  avatar.addToPool(char.id,{imageId:imgId,name:'黑底'});
  const id2=await db.images.put(new File([blob],'b.png',{type:'image/png'}));
  avatar.addToPool(char.id,{imageId:id2,name:'白猫'});
  ok('库里两张', avatar.poolOf(db.characters.get(char.id)).length===2);
  ok('名字单子给模型看', avatar.poolNames(db.characters.get(char.id))==='黑底、白猫');
  ok('不起名就自动编号', (()=>{
    const id3='x'; avatar.addToPool(char.id,{imageId:id3,name:'  '});
    const n=avatar.poolOf(db.characters.get(char.id)).slice(-1)[0].name;
    avatar.removeFromPool(char.id,id3);
    return /第 3 张/.test(n);
  })());

  ok('按名字换得上', (()=>{ avatar.wear(char.id,'白猫'); return db.characters.get(char.id).avatar===id2; })());
  ok('说一小段也认得出', (()=>{ avatar.wear(char.id,'黑'); return db.characters.get(char.id).avatar===imgId; })());
  ok('认不出名字就不换', avatar.wear(char.id,'根本没有这一张')===null
    && db.characters.get(char.id).avatar===imgId);
  ok('已经在用的那一张不重复换', avatar.wear(char.id,'黑底')===null);

  // 库里有东西了，能力目录才提这回事
  const t=caps.capabilityBlock({chat,char:db.characters.get(char.id),messages:[],settings:db.settings.get()});
  ok('有库才提换头像，还把名字带上', t.includes('换头像') && t.includes('黑底、白猫'), t.slice(0,400));
  return R;
}, a);
av.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat',`/extras/${id}`);
}, a.chatId);
await page.waitForTimeout(700);
const ex1 = await page.locator('.app-layer').innerText();
ok('互动页打得开', ex1.includes('心声')&&ex1.includes('拍一拍')&&ex1.includes('骰子'), ex1.slice(0,120));
ok('写清楚了单独生成要多花钱', ex1.includes('每轮多一次接口调用'), ex1.slice(0,400));
await page.screenshot({path:`${OUT}/ex-page.png`});

await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat',`/chat/${id}`);
}, a.chatId);
await page.waitForTimeout(900);
ok('骰子在会话里有气泡', await page.locator('.bubble-dice').count()>=1, await page.locator('.bubble-dice').count());
ok('拍一拍是居中一行', (await page.locator('.conv-notice').first().innerText()).includes('拍了拍'),
  await page.locator('.conv-notice').first().innerText().catch(()=>''));
ok('心声默认藏着', await page.locator('.inner-voice').count()===0, await page.locator('.inner-voice').count());

// 点角色头像展开心声
const withInner = await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  return db.messagesOf(id).find(m=>m.inner)?.id || '';
}, a.chatId);
await page.locator(`#msg-${withInner} .msg-face`).click();
await page.waitForTimeout(500);
ok('点头像就展开了', (await page.locator('.inner-voice').innerText()).includes('还想再聊'),
  await page.locator('.inner-voice').innerText().catch(()=>''));
await page.screenshot({path:`${OUT}/ex-conv.png`});
await page.locator(`#msg-${withInner} .msg-face`).click();
await page.waitForTimeout(400);
ok('再点一下收起来', await page.locator('.inner-voice').count()===0);

// 双击头像是拍一拍
const n0 = await page.evaluate(async id => (await import('/src/system/db/index.js')).messagesOf(id).filter(m=>m.pat).length, a.chatId);
await page.locator(`#msg-${withInner} .msg-face`).dblclick();
await page.waitForTimeout(700);
const n1 = await page.evaluate(async id => (await import('/src/system/db/index.js')).messagesOf(id).filter(m=>m.pat).length, a.chatId);
ok('双击头像拍了一下', n1===n0+1, `${n0} -> ${n1}`);
ok('双击不会顺带展开心声', await page.locator('.inner-voice').count()===0);

// 特别关心在消息列表上看得见
// openApp(app,'/') 不会把已有的栈弹掉，得真的 pop 回列表
await page.evaluate(async () => { (await import('/src/system/nav.js')).popToRoot(); });
await page.waitForTimeout(600);
ok('消息列表上有特别关心的标记', await page.locator('.msg-star').count()>=1, await page.locator('.msg-star').count());

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
