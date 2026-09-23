// 两处「删除角色」现在是同一件事：全都删。删完不留孤儿会话
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const cons=[]; page.on('console',m=>{ if (m.type()==='error') cons.push(m.text()); });
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};
const text = () => page.evaluate(()=>document.body.innerText);
const go = async (app, r='/') => { await page.evaluate(async ([a,r])=>{ const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp(a,r); }, [app,r]); await page.waitForTimeout(500); };
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
await page.evaluate(async()=>{ const nav=await import('/src/system/nav.js'); nav.unlock(); });

const seed = () => page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const scene=await import('/src/system/scene.js');
  const trip=await import('/src/system/trip.js');
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id],lastMessageAt:Date.now()});
  db.messages.create({chatId:chat.id,role:'char',authorId:c.id,kind:'text',content:'在',status:'done'});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'嗯',status:'done'});
  const sc=scene.create({chatId:chat.id,castIds:[c.id]});
  trip.create({chatId:chat.id,title:'京都',place:'京都'});
  db.memories.create({charId:c.id,content:'记',category:'fact',rank:'A',keywords:[]});
  return { charId:c.id, chatId:chat.id, sceneId:sc.id };
});
const left = () => page.evaluate(async ({charId, chatId, sceneId}) => {
  const db=await import('/src/system/db/index.js');
  return { char: db.characters.has(charId), chat: db.chats.has(chatId),
    msgs: db.messages.all().filter(m=>m.chatId===chatId).length,
    scene: db.scenes.has(sceneId), trips: db.trips.byIndex(chatId).length,
    mems: db.memories.all().filter(m=>m.charId===charId).length };
}, ids);

// ---- 联系 app 的「删除这个角色」 ----
let ids = await seed();
await go('contact', `/edit/${ids.charId}`);
await page.locator('button', { hasText:/删除/ }).last().click(); await page.waitForTimeout(300);
await page.screenshot({ path:`${OUT}/orphan-confirm.png` });
const confirmTxt = await text();
ok('确认框写明了会一并删掉什么', /全部内容/.test(confirmTxt) && /2 条消息/.test(confirmTxt), confirmTxt.slice(-220));
await page.locator('.modal-btn-primary').last().click(); await page.waitForTimeout(600);
let g = await left();
ok('联系：角色、会话、消息、线下、出行、记忆全删了',
  !g.char && !g.chat && g.msgs===0 && !g.scene && g.trips===0 && g.mems===0, JSON.stringify(g));
await go('chat','/');
const listTxt = await text();
ok('消息列表里没有留下孤儿会话', !/已删除的角色/.test(listTxt), listTxt.replace(/\n+/g,' / ').slice(0,160));
ok('列表没炸', !/已停止/.test(listTxt) && errs.length===0, errs[0]);

// ---- 聊天 app 资料页的「删除这个角色」 ----
ids = await seed();
await go('contact', `/edit/${ids.charId}`);   // 删除角色的入口只在编辑资料那一页（ARCHITECTURE 4.149）
await page.locator('button', { hasText:/删除/ }).last().click(); await page.waitForTimeout(300);
const confirm2 = await text();
ok('两处的确认框是同一句话', /全部内容/.test(confirm2) && /2 条消息/.test(confirm2), confirm2.slice(-200));
await page.locator('.modal-btn-primary').last().click(); await page.waitForTimeout(600);
g = await left();
ok('聊天：删的是同样那些', !g.char && !g.chat && g.msgs===0 && !g.scene && g.trips===0 && g.mems===0, JSON.stringify(g));
await go('chat','/');
ok('回到列表没炸', !/已停止/.test(await text()) && errs.length===0, errs[0]);
ok('没有 console.error', cons.length===0, cons[0]);
const bad=R.filter(r=>!r.pass).length;
console.log(bad? `\n${bad} 项挂` : `\n全部通过（${R.length} 项）`);
await browser.close();
process.exit(bad?1:0);
