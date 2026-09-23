import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const bodies=[];
await page.route('**/chat/completions', async r => {
  bodies.push(JSON.parse(r.request().postData()||'{}'));
  await r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content:'一个二十来岁的人，短发，圆脸。'}}]})});
});
await page.route('**/images/**', async r => {
  await r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const svc=await import('/src/system/ai/services.js');
  const engine=await import('/src/system/ai/engine.js');
  const reply=await import('/src/system/ai/reply.js');
  const gift=await import('/src/system/gift.js');
  const tok=await import('/src/system/ai/tokens.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  db.personas.update(me.id,{name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://api.example.com/v1',apiKey:'k',model:'m'});
  const sys=()=>engine.buildChatSystem(db.chats.get(chat.id),db.characters.get(c.id),db.messagesOf(chat.id),{}).system;

  // ---- 按需注入 ----
  db.settings.set({promptLean:true});
  const lean=sys();
  ok('清单出来了', lean.includes('[可用的功能]'), lean.slice(lean.indexOf('[可用的功能]'),lean.indexOf('[可用的功能]')+200));
  // 标记名留中文（它是协议），说明文字改成了英文（第 14 条）
  ok('清单里有转账的写法', lean.includes('[转账：amount note]'));
  ok('清单里有礼物的写法', lean.includes('[礼物：cover name | what is inside]'));
  ok('冷着的时候没有整段转账细则', !lean.includes('Handle each transfer once'), '');
  ok('冷着的时候没有整段礼物细则',
    !lean.includes('You do not know what is inside before opening it'), '');

  db.settings.set({promptLean:false});
  const fat=sys();
  ok('关掉之后细则全回来了',
    fat.includes('Handle each transfer once')
    && fat.includes('You do not know what is inside before opening it'));
  ok('关掉之后就没有清单了', !fat.includes('[可用的功能]'));
  const saved=tok.estimate(fat)-tok.estimate(lean);
  ok('省下的不止一点点', saved > 300, String(saved));
  db.settings.set({promptLean:true});

  // 用过一次就热了
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'transfer',
    amount:8,note:'',transfer:'pending',content:'[转账：8.00]',status:'done'});
  const hot=sys();
  ok('挂着一笔没收的钱，转账细则就进来了', hot.includes('Handle each transfer once'));
  ok('别的还是清单', hot.includes('[可用的功能]')
    && !hot.includes('You do not know what is inside before opening it'));

  // 时间和译文不受影响
  db.settings.set({injectTime:true});
  db.chats.update(chat.id,{translateTo:'英文'});
  const must=sys();
  ok('时间永远是整段', must.includes('At the very start of the reply'));
  ok('译文永远是整段', must.includes('translation into'));
  db.chats.update(chat.id,{translateTo:''});

  // ---- 礼物 ----
  const g=gift.send({chatId:chat.id,role:'user',authorId:'me',cover:'iPhone18promax',inner:'一颗牛奶糖'});
  ok('落成了礼物消息', g.kind==='gift'&&g.gift==='pending');
  ok('没拆之前上下文里一个字都不露',
    g.content==='[礼物：iPhone18promax（未拆封）]' && !g.content.includes('牛奶糖'), g.content);
  const sysG=sys();
  ok('整段 prompt 里也搜不到里面是什么', !sysG.includes('牛奶糖'), '');
  const hist=engine.buildHistory(chat,db.characters.get(c.id),db.messagesOf(chat.id),{});
  ok('历史消息里也搜不到', !JSON.stringify(hist).includes('牛奶糖'), '');

  // 角色拆开
  const made=await reply.renderTurn({chat,char:db.characters.get(c.id),
    raw:'哇谢谢\n[拆开]',turnId:'g1',instant:true});
  const after=db.messages.get(g.id);
  ok('拆开之后状态变了', after.gift==='opened', after.gift);
  ok('这时候里面是什么才写进正文',
    after.content==='[礼物：iPhone18promax，拆开是 一颗牛奶糖]', after.content);
  const notice=made.find(m=>m.kind==='notice');
  ok('落了一行提示', !!notice && notice.content.includes('牛奶糖'), notice&&notice.content);

  // 撤销
  reply.clearTurn(chat.id,'g1');
  ok('整轮撤掉就回到没拆的样子',
    db.messages.get(g.id).gift==='pending' && !db.messages.get(g.id).content.includes('牛奶糖'),
    db.messages.get(g.id).content);

  // 拒收
  await reply.renderTurn({chat,char:db.characters.get(c.id),raw:'[拒收]',turnId:'g2',instant:true});
  ok('拒收也认', db.messages.get(g.id).gift==='declined');
  ok('拒收之后仍然不露内容', !db.messages.get(g.id).content.includes('牛奶糖'), db.messages.get(g.id).content);

  // 关掉保密
  db.settings.set({giftBlind:false});
  const g2=gift.send({chatId:chat.id,role:'user',authorId:'me',cover:'盒子',inner:'一块石头'});
  ok('关掉之后里面就写在正文里了', g2.content.includes('一块石头'), g2.content);
  db.settings.set({giftBlind:true});

  // 角色送的礼物：它自己知道，因为是它包的
  const made2=await reply.renderTurn({chat,char:db.characters.get(c.id),
    raw:'给你带了个东西\n[礼物：限量款球鞋 | 一张手写的纸条]',turnId:'g3',instant:true});
  const cg=made2.find(m=>m.kind==='gift');
  ok('角色也能送', !!cg && cg.role==='char' && cg.cover==='限量款球鞋', JSON.stringify(cg&&{c:cg.cover,i:cg.inner}));
  ok('角色送的也是未拆状态', cg.gift==='pending'&&cg.content==='[礼物：限量款球鞋（未拆封）]', cg.content);
  ok('里面的内容存着，只是不写进正文', cg.inner==='一张手写的纸条', cg.inner);
  // 正文是搜索读的那一份，只要它在正文里用户搜一下就提前看见了
  const se=await import('/src/system/search.js');
  const hit=await se.searchMessages('手写的纸条',{chatId:chat.id}).done;
  ok('没拆开的礼物搜不出里面是什么', hit.hits.length===0, JSON.stringify(hit.hits.length));
  const n2=gift.settle(cg.id,true);
  ok('用户拆开', db.messages.get(cg.id).gift==='opened'&&db.messages.get(cg.id).content.includes('纸条'));
  ok('提示写清了谁拆了谁的', n2.content.includes('小明拆开了阿岚送的'), n2.content);

  // 解析边界
  const p1=reply.splitReply('[礼物：一支笔]');
  ok('没有竖线就是表里如一', p1[0]?.type==='gift'&&p1[0].cover==='一支笔'&&p1[0].inner==='', JSON.stringify(p1));
  const p2=reply.splitReply('[礼物：封面｜全角竖线]');
  ok('全角竖线也认', p2[0]?.inner==='全角竖线', JSON.stringify(p2));
  ok('拆开必须带括号', reply.splitReply('我把礼物拆开看了看')[0].type==='text');
  ok('退回退的是钱，拒收拒的是礼物',
    reply.splitReply('[退回]')[0].type==='settle' && reply.splitReply('[拒收]')[0].type==='unwrap',
    JSON.stringify([reply.splitReply('[退回]')[0],reply.splitReply('[拒收]')[0]]));

  return { results:R, chat:chat.id, char:c.id };
});
out.results.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 生图提示词与锁脸 ----
const img = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const ip=await import('/src/system/ai/imageprompt.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const png='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABlklEQVR4nBXR4RiFMQiG4Q9hCEMIYQghhDCEEIbwIIQQQgghDOHs9Lu7662+72N8zA/5WB/6YR/7wz/OBx/xkR/10R/34/sGYzAHMlgDHdhgD3xwBgxikIMa9OCOByZjMicyWROd2GRPfHImTGKSk5r05M4HhCFMQYQlqGDCFlw4AkIIKZTQwpUHFmMxF7JYC13YYi98cRYsYpGLWvTirgeUoUxFlKWoYspWXDkKSiiplNLK1QeMYUxDjGWoYcY23DgGRhhplNHGtQc2YzM3slkb3dhmb3xzNmxik5va9ObuB5zhTEec5ahjznbcOQ5OOOmU0871Bw7jMA9yWAc92GEf/HAOHOKQhzr04Z4H/s95534HfCd5S77YL8gb/Zr/FZBQ0HDf679gBDOQYAUaWLADD0782yPIoIIObjyQjGQmkqxEE0t24snJ//BIMqmkk5sPFKOYhRSr0MKKXXhx6h8liiyq6OLWA81oZiPNarSxZjfenP4Hjyabarq5/cBlXOZFLuuiF7vsi1/O/a8Zl7zUpS/38gNq4ZAQG74ASAAAAABJRU5ErkJggg==';
  const blob=await (await fetch('data:image/png;base64,'+png)).blob();
  const faceId=await db.images.put(new File([blob],'f.png',{type:'image/png'}));
  const c=db.characters.get(ids.char);

  db.settings.set({imagePrompt:'柔和自然光'});
  db.characters.update(c.id,{imagePrompt:'黑色长发',faceImage:faceId,faceDesc:'圆脸短发',faceLock:'self'});
  const ch=()=>db.characters.get(c.id);

  ok('全局和角色的提示词都拼上了',
    ip.compose({prompt:'在窗边',char:ch()})==='在窗边\n黑色长发\n柔和自然光',
    ip.compose({prompt:'在窗边',char:ch()}));
  ok('有脸部描述时排在角色提示词前面',
    ip.compose({prompt:'自拍',char:ch(),face:'圆脸短发'})
      ==='自拍\nThe appearance of the person in frame: 圆脸短发\n黑色长发\n柔和自然光');

  ok('自拍算涉及本人', ip.faceApplies(ch(),'一张自拍'));
  ok('写到名字也算', ip.faceApplies(ch(),'阿岚站在窗边'));
  ok('风景不算', !ip.faceApplies(ch(),'窗外的雨'));
  db.characters.update(c.id,{faceLock:'always'});
  ok('改成始终就都算', ip.faceApplies(ch(),'窗外的雨'));
  db.characters.update(c.id,{faceLock:'off'});
  ok('关掉就都不算', !ip.faceApplies(ch(),'一张自拍'));
  db.characters.update(c.id,{faceLock:'self'});
  db.characters.update(c.id,{faceImage:null});
  ok('没传脸图就不生效', !ip.faceApplies(ch(),'一张自拍'));
  db.characters.update(c.id,{faceImage:faceId});

  const preset=svc.newImagePreset({kind:'relay',name:'p',baseUrl:'https://img.example.com/v1',apiKey:'k',model:'m'});
  ok('接口没开参考图就不走那条路', !ip.wantsRef(ch(),svc.activeImage()));
  svc.updateImagePreset(preset.id,{ref:'edits'});
  ok('开了才走', ip.wantsRef(ch(),svc.activeImage()));

  // 缓存：有 faceDesc 就不再调接口
  db.characters.update(c.id,{faceDesc:'已经读过了'});
  const d=await ip.ensureFaceDesc(ch());
  ok('读过一次就用缓存', d==='已经读过了', d);
  return R;
}, out);
img.forEach(r=>ok(r.name,r.pass,r.extra));

const before = bodies.length;
const desc = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const ip=await import('/src/system/ai/imageprompt.js');
  svc.setVision({mode:'chat'});
  db.characters.update(ids.char,{faceDesc:''});
  const d=await ip.ensureFaceDesc(db.characters.get(ids.char));
  return { d, cached: db.characters.get(ids.char).faceDesc };
}, out);
ok('没有缓存时真的去读了一次', desc.d.includes('短发'), desc.d);
ok('读完存回角色卡', desc.cached===desc.d, desc.cached);
ok('那一次请求里带了脸图',
  bodies.slice(before).some(b=>JSON.stringify(b).includes('image_url')), String(bodies.length-before));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
