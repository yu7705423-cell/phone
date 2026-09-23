// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 流式开关、当日日程就地开启、通知横幅三种情形
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

// 记下每次请求是不是流式
const asks=[];
const REPLY='在的\n刚看到';
const sse=[...REPLY].map(ch=>`data: ${JSON.stringify({choices:[{delta:{content:ch}}]})}\n\n`).join('')+'data: [DONE]\n\n';
await page.route('**/v1/chat/completions', async r => {
  const body=JSON.parse(r.request().postData()||'{}');
  asks.push(!!body.stream);
  if (body.stream) return r.fulfill({status:200,contentType:'text/event-stream; charset=utf-8',body:sse});
  return r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content:REPLY}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:`${BASE}/v1`,apiKey:'k',model:'m'});
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id]});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'在吗',status:'done'});
  return { charId:c.id, chatId:chat.id };
});

// ---- 流式开关 ----
const st = await page.evaluate(async ({chatId,charId}) => {
  const db=await import('/src/system/db/index.js');
  const eng=await import('/src/system/ai/engine.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=()=>db.chats.get(chatId), char=()=>db.characters.get(charId);

  ok('默认是流式', db.settings.get().streamMode==='stream', db.settings.get().streamMode);

  let seen=0;
  let text=await eng.streamReply({ chat:chat(), char:char(), onDelta:()=>{seen++;} });
  ok('流式时 onDelta 一直在回调', seen>3, String(seen));
  ok('流式拿到了完整正文', text.includes('刚看到'), text);

  db.settings.set({ streamMode:'once' });
  seen=0;
  text=await eng.streamReply({ chat:chat(), char:char(), onDelta:()=>{seen++;} });
  ok('一次返回时不再逐字回调', seen===0, String(seen));
  ok('一次返回也拿到了完整正文', text.includes('刚看到'), text);

  db.settings.set({ streamMode:'stream' });
  return R;
}, ids);
st.forEach(r=>ok(r.name,r.pass,r.extra));

ok('流式那两次真的带了 stream 参数', asks[0]===true, JSON.stringify(asks));
ok('一次返回那次没带 stream', asks[1]===false, JSON.stringify(asks));

// ---- 当日日程就地开启 ----
await page.evaluate(async ({charId}) => {
  const nav=await import('/src/system/nav.js'); nav.openApp('daily',`/today/${charId}`);
}, ids);
await page.waitForTimeout(700);
let ui = await page.locator('.app-layer').innerText();
ok('没开时说清楚了', ui.includes('还没有开启当日日程'), ui.slice(0,200));
ok('就地给了开启按钮', ui.includes('现在开启'), ui.slice(0,300));
ok('说明写了每天一次接口调用', ui.includes('每天一次单独的接口调用'), ui.slice(0,400));
await page.screenshot({path:`${OUT}/day-off.png`});
await page.locator('button', { hasText:'现在开启' }).click();
await page.waitForTimeout(600);
ui = await page.locator('.app-layer').innerText();
ok('点完就开了', !ui.includes('还没有开启当日日程'), ui.slice(0,200));
const on = await page.evaluate(async ({charId}) => {
  const db=await import('/src/system/db/index.js');
  return !!db.characters.get(charId).dayOn;
}, ids);
ok('开关真的落库了', on);

// ---- 界面 ----
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat','/context');
});
await page.waitForTimeout(700);
const ctx = await page.locator('.app-layer').innerText();
ok('上下文页有流式开关', ctx.includes('流式接收'), ctx.slice(0,600));
ok('说明了两种方式费用相同', ctx.includes('费用完全相同'), ctx.slice(0,1200));
// 一次性接收那一档的说明里才写「不支持流式返回时保持关闭」，先切过去再看
await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js'); db.settings.set({ streamMode:'once' });
});
await page.waitForTimeout(400);
const ctxOnce = await page.locator('.app-layer').innerText();
ok('说明了接口不支持时该关掉', ctxOnce.includes('不支持流式返回'), ctxOnce.slice(0,1200));
// 「自检会让开头空几秒」那一句随自检那一段一起删了（第 16 条）：
// 现在消息整段生成完才显示，开头不会空着
ok('说明了消息整段生成完才显示', ctx.includes('整段生成完毕后一次显示'), ctx.slice(0,1200));
await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js'); db.settings.set({ streamMode:'stream' });
});
await page.screenshot({path:`${OUT}/stream-ctx.png`});

// ---- 会话菜单里角色卡那一行 ----
await page.evaluate(async ({chatId}) => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat',`/chat/${chatId}`);
}, ids);
await page.waitForTimeout(700);
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(600);
const menu = await page.locator('.app-layer').innerText();
ok('角色卡那一行写明了里面有日程开关', menu.includes('当日日程'), menu.slice(0,700));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
