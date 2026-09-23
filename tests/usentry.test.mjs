// 从会话菜单进「我们」，以及删会话/删角色时作品跟着走
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};
const text = () => page.evaluate(()=>document.body.innerText);
const appId = () => page.evaluate(async()=>{ const nav=await import('/src/system/nav.js'); return nav.nav.get().appId; });

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const work=await import('/src/system/work.js');
  const scene=await import('/src/system/scene.js');
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id],lastMessageAt:Date.now()});
  db.messages.create({chatId:chat.id,role:'char',authorId:c.id,kind:'text',content:'在',status:'done'});
  const w=work.create({ chatId: chat.id, kind: work.SAGA, title:'雨落之前', opening:'me' });
  const cp=work.addChapter(w.id, { title:'到站' });
  scene.addBeat({ sceneId: cp.id, role:'char', authorId:c.id, text:'雨还没停。' });
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat', `/chat/${chat.id}`);
  return { charId:c.id, chatId:chat.id, workId:w.id, chapterId:cp.id };
});
await page.waitForSelector('.composer-bar',{timeout:5000});

// ---- 会话菜单里的入口 ----
await page.locator('.navbar .icon-btn').last().click(); await page.waitForTimeout(500);
const item = page.locator('.list-item', { hasText:'我们' }).first();
ok('会话菜单里有「我们」', await item.count()>0, (await text()).slice(0,200));
const sub = await item.innerText();
ok('那一行写了这段关系下有几部', /1 部/.test(sub), sub.replace(/\n+/g,' / '));
await item.click(); await page.waitForTimeout(700);
await page.screenshot({ path:`${OUT}/ue-open.png` });
ok('跳到了「我们」', await appId()==='us', await appId());
ok('开的是这段关系的作品列表', /雨落之前/.test(await text()), (await text()).slice(0,200));
// 返回应该回到那段会话
await page.locator('.navbar .icon-btn').first().click().catch(()=>{});
await page.waitForTimeout(700);
ok('返回落回那段会话', await appId()==='chat' && await page.locator('.composer-bar').count()>0, await appId());

// ---- 删会话：作品跟着走 ----
const gone = await page.evaluate(async ({chatId, workId, chapterId}) => {
  const purge=await import('/src/system/purge.js');
  const db=await import('/src/system/db/index.js');
  purge.dropChat(chatId);
  return { work: db.works.has(workId), chapter: db.chapters.has(chapterId),
    beats: db.beats.byIndex(chapterId).length };
}, ids);
ok('删会话时作品、篇与正文一起走', !gone.work && !gone.chapter && gone.beats===0, JSON.stringify(gone));

// ---- 删角色：同理 ----
const g2 = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const work=await import('/src/system/work.js');
  const scene=await import('/src/system/scene.js');
  const purge=await import('/src/system/purge.js');
  const c=db.characters.create({name:'乙',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id]});
  const w=work.create({ chatId: chat.id, kind: work.EXTRA, title:'小剧场' });
  const cp=work.addChapter(w.id);
  scene.addBeat({ sceneId: cp.id, role:'char', authorId:c.id, text:'一段' });
  purge.dropCharacter(c.id);
  return { works: db.works.count(), chapters: db.chapters.count(), beats: db.beats.count() };
});
ok('删角色时它名下的作品也一起走', g2.works===0 && g2.chapters===0 && g2.beats===0, JSON.stringify(g2));

ok('没有页面错误', errs.length===0, errs[0]);
const bad=R.filter(r=>!r.pass).length;
console.log(bad? `\n${bad} 项挂` : `\n全部通过（${R.length} 项）`);
await browser.close();
process.exit(bad?1:0);
