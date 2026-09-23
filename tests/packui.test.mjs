// 导出前那一行把账摆出来；导出的包点得下来
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2,acceptDownloads:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const scene=await import('/src/system/scene.js');
  const skin=await import('/src/system/skin.js');
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id],lastMessageAt:Date.now()});
  db.messages.create({chatId:chat.id,role:'char',authorId:c.id,kind:'text',content:'在',status:'done'});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'嗯',status:'done'});
  db.memories.create({charId:c.id,content:'记',category:'fact',rank:'A',keywords:[]});
  scene.create({chatId:chat.id,castIds:[c.id],title:'旧书店'});
  const sk=skin.create({name:'窄底栏'}); skin.attach(chat.id,sk.id);
  db.moments.create({authorId:c.id,text:'下雨了',images:[],likes:[],comments:[]});
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat',`/chat/${chat.id}`);
  return { charId:c.id, chatId:chat.id };
});
await page.waitForSelector('.composer-bar',{timeout:5000});
await page.locator('.navbar .icon-btn').last().click(); await page.waitForTimeout(500);
// 导出收在会话菜单底下的「更多」里
await page.locator('.fullsheet .list-item', { hasText:'导出与清空数据' }).click(); await page.waitForTimeout(600);
const row = page.locator('.list-item', { hasText:'导出这个角色' }).first();
const sub = await row.innerText();
await page.screenshot({ path:`${OUT}/pack-menu.png` });
console.log('  那一行：', sub.replace(/\n+/g,' / '));
ok('账上写了会话、消息、记忆', /1 段会话/.test(sub) && /2 条消息/.test(sub) && /1 条记忆/.test(sub), sub);
ok('账上写了线下与美化', /1 场线下/.test(sub) && /1 份美化/.test(sub), sub);
ok('账上写了其余记录', /条其余记录/.test(sub), sub);
const dl = page.waitForEvent('download', { timeout: 8000 }).catch(()=>null);
await row.click();
const d = await dl;
ok('点下去真的导出了', !!d, '');
if (d) console.log('  文件名：', d.suggestedFilename());
ok('没有页面错误', errs.length===0, errs[0]);
const bad=R.filter(r=>!r.pass).length;
console.log(bad? `\n${bad} 项挂` : `\n全部通过（${R.length} 项）`);
await browser.close();
process.exit(bad?1:0);
