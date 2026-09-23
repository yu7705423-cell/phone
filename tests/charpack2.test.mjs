// 角色包要带走挂在这个角色与这几段会话上的全部东西，装回去一条不少
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932}});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const seed = async () => page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const scene=await import('/src/system/scene.js');
  const trip=await import('/src/system/trip.js');
  const space=await import('/src/system/space.js');
  const skin=await import('/src/system/skin.js');
  const hl=await import('/src/system/health.js');
  const theirs=await import('/src/system/theirs.js');
  const png=async()=>new File([await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')).blob()],'a.png',{type:'image/png'});
  const av=await db.images.put(await png());
  const moImg=await db.images.put(await png());
  const phImg=await db.images.put(await png());
  const msgImg=await db.images.put(await png());
  const c=db.characters.create({name:'阿岚',persona:'二十二岁',avatar:av,
    shelf:[{id:'s1',title:'雨城旧事',cover:null}]});
  const npc=db.characters.create({name:'小林',isNpc:true});
  const chat=db.chats.create({characterIds:[c.id],lastMessageAt:Date.now()});
  const m1=db.messages.create({chatId:chat.id,role:'char',authorId:c.id,kind:'text',content:'在',status:'done'});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'image',imageId:msgImg,content:'[图片]',status:'done'});
  db.memories.create({charId:c.id,content:'用户喜欢下雨天',category:'fact',rank:'A',keywords:['雨'],vec:new Float32Array([0.1,0.2,0.3,0.4])});
  // 线下
  const sc=scene.create({chatId:chat.id,castIds:[c.id],title:'旧书店'});
  scene.addBeat({sceneId:sc.id,role:'char',authorId:c.id,text:'门上的铃响了一声。'});
  scene.addBeat({sceneId:sc.id,role:'me',text:'我把伞收起来。'});
  // 出行、纪念日
  trip.create({chatId:chat.id,title:'京都',place:'京都'});
  space.addDay({chatId:chat.id,title:'认识的日子',date:'2025-03-04',yearly:true});
  // 美化
  const sk=skin.create({name:'窄底栏',tokens:{barH:30}}); skin.attach(chat.id,sk.id);
  // 角色自己的
  db.days.create({charId:c.id,date:'2026-01-01',items:[{id:'i1',slot:'morning',text:'去邮局'}]});
  db.meals.create({charId:c.id,meal:'lunch',name:'担担面'});
  hl.set(c.id, hl.dateKey(), { mood:'flat', note:'嗓子哑' });
  db.moments.create({authorId:c.id,text:'今天下雨了',images:[moImg],likes:['me'],comments:[{id:'cm1',authorId:'me',text:'注意保暖'}]});
  db.todos.create({charId:c.id,chatId:chat.id,srcMsgId:m1.id,text:'买牛奶',state:'open'});
  const ph=db.phones.create({charId:c.id,photos:[{id:'p1',imageId:phImg}],wallpaper:null,icons:{},notes:[]});
  db.phoneChats.create({charId:c.id,npcId:npc.id,name:'小林',lines:[]});
  // 指着本机没有的书的那两条
  db.reviews.create({kind:'book',subjectId:'nope',charId:c.id,title:'某书',text:'评'});
  db.readnotes.create({subject:'book:nope',bookId:'nope',at:0,text:'段评',kind:'char',authorId:c.id});
  return { charId:c.id, chatId:chat.id, sceneId:sc.id, av, moImg, phImg, msgImg };
});
const ids = await seed();

const est = await page.evaluate(async ({charId}) => {
  const cp=await import('/src/system/charpack.js');
  return cp.estimate(charId);
}, ids);
console.log('  账：', JSON.stringify(est));
ok('账上算到了线下与美化', est.scenes===1 && est.skins===1, JSON.stringify(est));
ok('账上算到了其余那一堆', est.extras>=10, est.extras);
ok('图片四张都跟着走', est.images===4, est.images);

// 打包 -> 清库 -> 装回去
const back = await page.evaluate(async ({charId}) => {
  const cp=await import('/src/system/charpack.js');
  const backup=await import('/src/system/backup.js');
  const db=await import('/src/system/db/index.js');
  const blob = await cp.build(charId);
  await backup.wipeAll();
  const wiped = { chars: db.characters.count(), scenes: db.scenes.count(), skins: db.skins.count() };
  const pack = await cp.read(new File([blob], 'p.zip', { type:'application/zip' }));
  const got = await cp.install(pack);
  const c = db.characters.all().find(x => x.name === '阿岚');
  const chat = db.chats.all()[0];
  const sc = db.scenes.all()[0];
  const mem = db.memories.all()[0];
  const mo = db.moments.all()[0];
  const td = db.todos.all()[0];
  const pc = db.phoneChats.all()[0];
  return {
    wiped, got, size: blob.size,
    read: { scenes: pack.scenes, skins: pack.skins, extras: pack.extras },
    name: c?.name, avatar: c?.avatar,
    chats: db.chats.count(), msgs: db.messages.count(),
    memText: mem?.content, vec: mem?.vec instanceof Float32Array ? mem.vec.length : String(mem?.vec),
    sceneTitle: sc?.title, sceneChat: sc?.chatId === chat?.id, sceneCast: sc?.castIds?.[0] === c?.id,
    beats: db.beats.byIndex(sc?.id || '').length,
    beatAuthor: db.beats.byIndex(sc?.id || '')[0]?.authorId === c?.id,
    trips: db.trips.byIndex(chat?.id || '').length,
    space: db.spaceItems.byIndex(chat?.id || '').length,
    skinName: db.skins.all()[0]?.name, chatSkin: chat?.skinId === db.skins.all()[0]?.id,
    days: db.days.byIndex(c?.id || '').length, meals: db.meals.byIndex(c?.id || '').length,
    health: db.health.byIndex(c?.id || '').length,
    moText: mo?.text, moImg: (mo?.images || [])[0], moLike: (mo?.likes || [])[0],
    todoChat: td?.chatId === chat?.id, todoMsg: !!td?.srcMsgId && db.messages.has(td.srcMsgId),
    phones: db.phones.byIndex(c?.id || '').length, phoneChats: db.phoneChats.byIndex(c?.id || '').length,
    pcNpc: pc?.npcId,
    reviews: db.reviews.count(), notes: db.readnotes.count(),
    imgs: db.images.ids().length,
  };
}, ids);
console.log('  装回来：', JSON.stringify(back.got));
ok('清库之后确实是空的', back.wiped.chars===0 && back.wiped.scenes===0 && back.wiped.skins===0, JSON.stringify(back.wiped));
ok('读包时就报得出线下与美化', back.read.scenes===1 && back.read.skins===1 && back.read.extras>=10, JSON.stringify(back.read));
ok('角色与头像回来了', back.name==='阿岚' && back.avatar===ids.av, `${back.name} ${back.avatar}`);
ok('会话与消息回来了', back.chats===1 && back.msgs===2, `${back.chats}/${back.msgs}`);
ok('记忆连向量一起回来了', back.memText==='用户喜欢下雨天' && back.vec===4, `${back.memText} vec=${back.vec}`);
ok('线下那一场回来了，挂对了会话与角色', back.sceneTitle==='旧书店' && back.sceneChat && back.sceneCast, JSON.stringify(back));
ok('两段正文回来了，作者指对了人', back.beats===2 && back.beatAuthor, `${back.beats} ${back.beatAuthor}`);
ok('出行与纪念日回来了', back.trips===1 && back.space===1, `${back.trips}/${back.space}`);
ok('美化回来了，还挂在那段会话上', back.skinName==='窄底栏' && back.chatSkin, `${back.skinName} ${back.chatSkin}`);
ok('每一天、吃饭、健康回来了', back.days===1 && back.meals===1 && back.health===1, JSON.stringify(back));
ok('动态连图和赞一起回来了', back.moText==='今天下雨了' && back.moImg===ids.moImg && back.moLike==='me', JSON.stringify(back));
ok('待办指回了新的会话与消息', back.todoChat && back.todoMsg, `${back.todoChat} ${back.todoMsg}`);
ok('那台手机与手机里的会话回来了', back.phones===1 && back.phoneChats===1, `${back.phones}/${back.phoneChats}`);
ok('书评与段评没落下去（本机没有那本书）', back.reviews===0 && back.notes===0 && back.got.dropped===2, `${back.reviews}/${back.notes} dropped=${back.got.dropped}`);
ok('四张图都放回去了', back.imgs===4, back.imgs);

// 再装一次：应该整包换 id，另建副本，原来那份不动
const twice = await page.evaluate(async ({charId}) => {
  const cp=await import('/src/system/charpack.js');
  const db=await import('/src/system/db/index.js');
  const c0=db.characters.all().find(x=>x.name==='阿岚');
  const blob = await cp.build(c0.id);
  const pack = await cp.read(new File([blob], 'p.zip', { type:'application/zip' }));
  await cp.install(pack);
  const names=db.characters.all().map(x=>x.name);
  const chats=db.chats.all();
  const scs=db.scenes.all();
  const sks=db.skins.all();
  // 副本那一套不能指回原来的行
  const copyChat = chats.find(x => x.id !== chats[0].id);
  const copyScene = scs.find(x => x.chatId === copyChat?.id);
  return { names, chats: chats.length, scenes: scs.length, skins: sks.length,
    copySceneOk: !!copyScene && copyScene.id !== scs[0].id,
    copySkinOk: !!copyChat?.skinId && copyChat.skinId === chats[0].skinId,
    beats: db.beats.byIndex(copyScene?.id || '').length };
}, ids);
ok('再装一次另建了副本', twice.names.filter(n=>/阿岚/.test(n)).length===2, JSON.stringify(twice.names));
ok('副本那一套各自成立，没指回原来的行', twice.chats===2 && twice.scenes===2
  && twice.copySceneOk && twice.beats===2, JSON.stringify(twice));
ok('美化不重复建，两边共用本机那一份', twice.skins===1 && twice.copySkinOk, JSON.stringify(twice));
// ---- 老版本的包（1，没有那几域）照样读得进来 ----
const old = await page.evaluate(async () => {
  const cp=await import('/src/system/charpack.js');
  const db=await import('/src/system/db/index.js');
  const zipMod=await import('/src/system/zip.js');
  const schema=await import('/src/system/db/schema.js');
  const data={ _format:'mini-phone-character', _version:1, _data:schema.DATA_VERSION, _history:true,
    exportedAt:new Date().toISOString(),
    character:{ id:'char_legacy', name:'老包里的人', persona:'x', lorebookIds:[] },
    alts:[], lorebooks:[], memories:[],
    chats:[{ id:'chat_legacy', characterIds:['char_legacy'], personaId:'whoever', lastMessageAt:1 }],
    messages:[{ id:'msg_legacy', chatId:'chat_legacy', role:'char', authorId:'char_legacy',
      kind:'text', content:'旧的', status:'done', createdAt:1 }] };
  const blob=await zipMod.zip([{ name:'character.json', text:JSON.stringify(data) }]);
  const pack=await cp.read(new File([blob],'old.zip',{type:'application/zip'}));
  const got=await cp.install(pack);
  const c=db.characters.get(got.charId);
  const chat=db.chats.all().find(x=>(x.characterIds||[]).includes(got.charId));
  return { read:{ scenes:pack.scenes, skins:pack.skins, extras:pack.extras },
    name:c?.name, msgs:chat?db.messagesOf(chat.id).length:0, skinId:chat?.skinId, dropped:got.dropped };
});
ok('老包读出来那几域是零，不报错', old.read.scenes===0 && old.read.skins===0 && old.read.extras===0, JSON.stringify(old.read));
ok('老包照样装得进去', old.name==='老包里的人' && old.msgs===1 && old.dropped===0, JSON.stringify(old));
ok('老包里的会话没有美化，skinId 是空的', old.skinId==='', JSON.stringify(old.skinId));

ok('没有页面错误', errs.length===0, errs[0]);
const bad=R.filter(r=>!r.pass).length;
console.log(bad? `\n${bad} 项挂` : `\n全部通过（${R.length} 项）`);
await browser.close();
process.exit(bad?1:0);
