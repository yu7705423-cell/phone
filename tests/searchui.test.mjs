// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const nav=await import('/src/system/nav.js');
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const mk=n=>{const c=db.characters.create({name:n});
    return db.chats.create({characterIds:[c.id],personaId:me.id,lastMessageAt:Date.now()});};
  const A=mk('阿岚'), B=mk('林一');
  const t=Date.now()-9000000;
  const add=(ch,i,txt,role)=>db.messages.create({chatId:ch.id,role,
    authorId:role==='user'?'me':ch.characterIds[0],kind:'text',content:txt,
    status:'done',createdAt:t+i*1000},{persist:false});
  // A 是一段很长的对话，最早那条里藏一句话
  add(A,0,'这是最早的那条，里面写着约定地点是天文台','char');
  for(let i=1;i<3000;i++) add(A,i,'普通的第'+i+'条消息',i%2?'char':'user');
  add(A,3000,'昨天的火锅很好吃','user');
  add(B,3100,'周末一起去天文台看星星','char');
  nav.goHome(); nav.openApp('chat','/');
  return { A:A.id, B:B.id };
});
await page.waitForTimeout(800);
ok('消息列表上有搜索入口', await page.locator('.search-bar').count()===1);
await page.screenshot({path:`${OUT}/s0-list.png`});

await page.locator('.search-bar').click();
await page.waitForTimeout(500);
ok('进了搜索页', (await page.locator('.app-layer').innerText()).includes('搜索聊天记录'));
await page.screenshot({path:`${OUT}/s1-empty.png`});

await page.locator('.search-bar input').fill('天文台');
await page.waitForTimeout(900);
const rows = await page.locator('.msg-row').count();
ok('搜到两条', rows===2, String(rows));
const txt = await page.locator('.msg-list').innerText();
ok('命中处高亮了', await page.locator('mark.hit').count()===2, String(await page.locator('mark.hit').count()));
ok('标题写的是在哪个会话', txt.includes('林一') && txt.includes('阿岚'), txt.slice(0,200));
ok('最新的排在前面', (await page.locator('.msg-row').first().innerText()).includes('林一'),
  await page.locator('.msg-row').first().innerText());
ok('底下报了条数', txt.includes('共 2 条'), txt.slice(-80));
await page.screenshot({path:`${OUT}/s2-hits.png`});

// 点最早那条，跳进长会话并滚到它
await page.locator('.msg-row').last().click();
await page.waitForTimeout(1200);
const conv = await page.evaluate(async () => {
  const el=document.querySelector('.is-flash')||document.querySelector('.msg.is-flash');
  return { msgs:document.querySelectorAll('.msg').length,
           flash:!!el, text:el?.innerText?.slice(0,30)||'',
           earlier:!!document.querySelector('.conv-earlier') };
});
ok('跳进了那段会话', conv.msgs>0, JSON.stringify(conv));
ok('选中的那条闪了一下', conv.flash && conv.text.includes('天文台'), JSON.stringify(conv));
ok('窗口开到了能装下它', conv.msgs>=3000, String(conv.msgs));
await page.screenshot({path:`${OUT}/s3-jump.png`});

// 直接进长会话：只画最近一段
await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat',`/chat/${id}`);
}, ids.A);
await page.waitForTimeout(1000);
const win = await page.evaluate(()=>({ msgs:document.querySelectorAll('.msg').length,
  earlier:document.querySelector('.conv-earlier')?.innerText||'' }));
// 一次画多少条是设置里的默认值（chatPage），不是写死的上限（第 13 条），
// 所以这里跟着设置算，别再写死一个数
const pageN = await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.get().chatPage);
ok(`长会话只画最近 ${pageN} 条`, win.msgs===pageN, String(win.msgs));
ok('上面有「查看更早的消息」', /查看更早的消息（还有 \d+ 条）/.test(win.earlier), win.earlier);
await page.screenshot({path:`${OUT}/s4-window.png`});

await page.locator('.conv-earlier').click();
await page.waitForTimeout(600);
const win2 = await page.evaluate(()=>document.querySelectorAll('.msg').length);
ok(`点一下再多出 ${pageN} 条`, win2===pageN*2, String(win2));

// 会话菜单里的限定搜索
await page.locator('[aria-label=更多]').click();
await page.waitForTimeout(500);
const menu = await page.locator('.fullsheet').innerText();
ok('会话菜单里有搜索聊天记录', menu.includes('搜索聊天记录'), menu.slice(0,120));
await page.getByText('搜索聊天记录', { exact:true }).click();
await page.waitForTimeout(500);
await page.locator('.search-bar input').fill('天文台');
await page.waitForTimeout(900);
const scoped = await page.locator('.msg-row').count();
ok('限定这段对话只剩一条', scoped===1, String(scoped));
await page.screenshot({path:`${OUT}/s5-scoped.png`});

await page.locator('.msg-row').first().click();
await page.waitForTimeout(1200);
const back = await page.evaluate(()=>({ flash:!!document.querySelector('.is-flash'),
  route:document.querySelector('.conv')?'会话':'别的' }));
ok('退回会话并滚到那一条', back.route==='会话' && back.flash, JSON.stringify(back));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
