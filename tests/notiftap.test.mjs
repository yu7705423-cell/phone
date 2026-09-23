// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 装成 ipa 之后点通知那一下：装一座假的原生桥，在各种时机喊 phoneNotifyOpen
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 外壳在文档一开始注入的那几样
await ctx.addInitScript(() => {
  window.phoneNativeBack = true; window.phoneNotify = true; window.phoneKeepAlive = true;
  window.phoneNet = false; window.phoneAppVersion = 'test';
  window.__native = [];
  window.webkit = { messageHandlers: {
    notify: { postMessage: async m => { window.__native.push(m);
      if (m.action === 'status' || m.action === 'request') return { permission: 'granted' };
      if (m.action === 'show') return { shown: true };
      return { error: '不认识的动作' }; } },
    keepalive: { postMessage: async () => ({ on:false }) },
  } };
});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
await page.route('**/chat/completions', r => r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({choices:[{message:{content:'好'}}]})}));
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};
const state = () => page.evaluate(async () => {
  const { nav } = await import('/src/system/nav.js');
  const s = nav.get();
  return { screen:s.screen, appId:s.appId, stack:s.stacks[s.appId]||null, body:document.body.innerText.slice(0,80),
    empty: !document.querySelector('#app')?.children.length };
});

await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const c=db.characters.create({ name:'阿岚' });
  const chat=db.chats.create({ characterIds:[c.id], title:'阿岚' });
  db.messages.create({ chatId:chat.id, authorId:c.id, role:'char', kind:'text', text:'在吗' });
  const c2=db.characters.create({ name:'小雨' });
  const chat2=db.chats.create({ characterIds:[c2.id], title:'小雨' });
  return { chat: chat.id, chat2: chat2.id };
});
const tap = (id) => page.evaluate(id => window.phoneNotifyOpen({ appId:'chat', route:`/chat/${id}` }), id);

// A 暖：在桌面
await page.evaluate(async()=>{ const n=await import('/src/system/nav.js'); n.unlock(); });
await tap(ids.chat); await page.waitForTimeout(700);
let s=await state();
ok('A 桌面上点通知 -> 进了会话', s.screen==='app' && s.appId==='chat' && s.stack?.slice(-1)[0]===`/chat/${ids.chat}`, JSON.stringify(s));
ok('A 会话页画出来了', await page.locator('.msg').count()>0, s.body);
ok('A 栈底垫了根页', s.stack?.[0]==='/', JSON.stringify(s.stack));

// B 暖：正在另一段会话里
await tap(ids.chat2); await page.waitForTimeout(600);
s=await state();
ok('B 在会话里再点另一条 -> 换到那段', s.stack?.slice(-1)[0]===`/chat/${ids.chat2}`, JSON.stringify(s));
ok('B 栈没有越叠越高', s.stack?.length===2, JSON.stringify(s.stack));

// C 暖：正在设置深处
await page.evaluate(async()=>{ const n=await import('/src/system/nav.js'); n.goHome(); n.openApp('settings','/'); n.push('/image'); });
await page.waitForTimeout(400);
await tap(ids.chat); await page.waitForTimeout(600);
s=await state();
ok('C 设置深处点通知 -> 进了会话', s.appId==='chat' && s.stack?.slice(-1)[0]===`/chat/${ids.chat}`, JSON.stringify(s));

// D 暖：锁屏上
await page.evaluate(async()=>{ const n=await import('/src/system/nav.js'); n.lock(); });
await page.waitForTimeout(300);
await tap(ids.chat); await page.waitForTimeout(600);
s=await state();
ok('D 锁屏上点通知 -> 进了会话', s.screen==='app' && s.appId==='chat', JSON.stringify(s));
ok('D 页面不是空的', !s.empty && (await page.locator('.msg').count())>0, s.body);

// 回执：外壳只认 true
ok('正式那份 phoneNotifyOpen 回 true（回执）', await page.evaluate(() => window.phoneNotifyOpen({ appId:'todo', route:'/' }) === true));
ok('外壳那句「你还在吗」在正常页面上回 true', await page.evaluate(() => !!(document.body && document.body.children.length)));

// E 冷：重新载入，页面一开始就喊（占位那一份）
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
ok('占位那份 phoneNotifyOpen 也回 true', await page.evaluate(id => window.phoneNotifyOpen({ appId:'chat', route:`/chat/${id}` }) === true, ids.chat));
await page.waitForTimeout(2500);
s=await state();
ok('E 冷启动、js 起来之前那一下 -> 兑现', s.screen==='app' && s.appId==='chat' && s.stack?.slice(-1)[0]===`/chat/${ids.chat}`, JSON.stringify(s));
ok('E 会话页画出来了', (await page.locator('.msg').count())>0, s.body);
ok('E 占位那一份用完清掉', await page.evaluate(()=>!sessionStorage.getItem('notify-open') && !window.__notifyOpen));

// F 冷：正常载入之后回到桌面，再刷新一次，不应该又跳一遍
await page.evaluate(async()=>{ const n=await import('/src/system/nav.js'); n.goHome(); });
await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(2000);
s=await state();
ok('F 刷新之后不再重复跳', s.appId!=='chat', JSON.stringify(s));

// G 点了一条已经删掉的会话
await page.evaluate(async id => { const db=await import('/src/system/db/index.js'); db.chats.remove(id); }, ids.chat2);
await tap(ids.chat2); await page.waitForTimeout(700);
s=await state();
ok('G 会话已删：页面不炸、不空', !s.empty && !/已停止/.test(s.body), JSON.stringify(s));
await page.screenshot({path:`${OUT}/notiftap-g.png`});

// H 点了一个不存在的 app
await page.evaluate(() => window.phoneNotifyOpen({ appId:'nope', route:'/x' })); await page.waitForTimeout(700);
s=await state();
ok('H 没有这个 app：不炸、不空', !s.empty, JSON.stringify(s));
await page.screenshot({path:`${OUT}/notiftap-h.png`});

// I 待办那一条（route '/'）
await page.evaluate(() => window.phoneNotifyOpen({ appId:'todo', route:'/' })); await page.waitForTimeout(700);
s=await state();
ok('I 待办通知 -> 进了待办首页', s.appId==='todo' && s.stack?.length===1, JSON.stringify(s));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
