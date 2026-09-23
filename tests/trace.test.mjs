// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 批 8a 请求记录：默认关着，开了才记，记的是真正发出去的那一份
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

const bodies=[];
// 聊天走流式，普通 JSON 解不出东西，要按 SSE 回
const REPLY='嗯。\n知道了';
const sse=[...REPLY].map(ch=>`data: ${JSON.stringify({choices:[{delta:{content:ch}}]})}\n\n`).join('')+'data: [DONE]\n\n';
await page.route('**/v1/chat/completions', async r => {
  bodies.push(JSON.parse(r.request().postData()||'{}'));
  await r.fulfill({status:200,contentType:'text/event-stream; charset=utf-8',body:sse});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 默认关着 ----
const off = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const trace=await import('/src/system/ai/trace.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  db.settings.set({ traceOn: undefined });
  ok('默认是关着的', !trace.isOn());
  ok('关着的时候一条都没有', trace.list().length===0);
  const t = trace.begin({ taskId:'x', system:'s', messages:[{role:'user',content:'u'}] });
  t.done('回复');
  ok('关着的时候记不进去', trace.list().length===0);
  ok('关着时返回的空壳也不会炸', typeof t.done==='function' && typeof t.fail==='function');
  return R;
});
off.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 开了之后 ----
const on = await page.evaluate(async () => {
  const trace=await import('/src/system/ai/trace.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  trace.setOn(true);
  ok('开得起来', trace.isOn());

  const t=trace.begin({ taskId:'chat.reply', preset:'主用', model:'m',
    system:'你是阿岚。', messages:[{role:'user',content:'在吗'}] });
  ok('记下了一条', trace.list().length===1);
  const row=trace.list()[0];
  ok('system 原样记下', row.system==='你是阿岚。');
  ok('消息也记下了', row.messages[0].content==='在吗');
  ok('估了长度', row.tokens>0, row.tokens);
  ok('还没有回复', row.reply==='');
  t.done('嗯');
  ok('结束后补上了回复', trace.list()[0].reply==='嗯');
  ok('也记了耗时', trace.list()[0].ms>=0);

  const t2=trace.begin({ taskId:'x', system:'', messages:[] });
  t2.fail(new Error('接口挂了'));
  ok('失败也记下来', trace.list()[0].error==='接口挂了', trace.list()[0].error);

  // 图片只记「有一张」，不把 dataURL 抄进来
  trace.begin({ taskId:'y', system:'', messages:[
    { role:'user', content:'看这个', image:{ dataUrl:'data:image/png;base64,'+'A'.repeat(50000), mediaType:'image/png' } },
  ]});
  const withPic=trace.list()[0];
  ok('图片不抄正文，只记类型', withPic.messages[0].image==='image/png', String(withPic.messages[0].image).slice(0,30));
  ok('没有把几十 KB 的 dataURL 记进去', JSON.stringify(withPic).length<2000, JSON.stringify(withPic).length);

  // 新的在最上面
  ok('最新的排在最前', trace.list()[0].taskId==='y', trace.list()[0].taskId);

  // 保留条数
  trace.clear();
  trace.setMax(3);
  for (let i=0;i<6;i++) trace.begin({ taskId:`n${i}`, system:'', messages:[] });
  ok('超出就丢掉最早的', trace.list().length===3, trace.list().length);
  ok('留下的是最近三条',
    trace.list().map(r=>r.taskId).join(',')==='n5,n4,n3', trace.list().map(r=>r.taskId).join(','));

  trace.clear();
  trace.setMax(0);
  for (let i=0;i<30;i++) trace.begin({ taskId:`m${i}`, system:'', messages:[] });
  ok('填 0 就是不限条数', trace.list().length===30, trace.list().length);

  trace.setMax(20);
  trace.clear();
  ok('清得掉', trace.list().length===0);

  // 关掉就把记录一并清了，免得它留在内存里
  trace.begin({ taskId:'z', system:'', messages:[] });
  trace.setOn(false);
  ok('关掉时顺手清空', trace.list().length===0);
  trace.setOn(true);
  return R;
});
on.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 真发一轮，看记的和发出去的是不是同一份 ----
const live = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  svc.newChatPreset({name:'测试接口',provider:'openai',baseUrl:`${BASE}/v1`,apiKey:'k',model:'gpt-test'});
  const c=db.characters.create({ name:'阿岚', persona:'二十二岁，美院三年级。' });
  const chat=db.chats.create({ characterIds:[c.id], title:'阿岚' });
  db.messages.create({ chatId:chat.id, role:'user', authorId:'me', kind:'text', content:'在吗', status:'done' });
  return { chatId:chat.id, charId:c.id };
});
await page.evaluate(async ({chatId,charId}) => {
  const db=await import('/src/system/db/index.js');
  const eng=await import('/src/system/ai/engine.js');
  await eng.streamReply({ chat:db.chats.get(chatId), char:db.characters.get(charId) });
}, live);
await page.waitForTimeout(400);

const cmp = await page.evaluate(async () => {
  const trace=await import('/src/system/ai/trace.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const row=trace.list().find(r=>r.taskId==='chat.reply');
  ok('聊天那一轮记下来了', !!row);
  ok('记了是哪个接口哪个模型', row.preset==='测试接口' && row.model==='gpt-test', `${row?.preset} / ${row?.model}`);
  ok('标成了流式', row.stream===true);
  ok('system 里有人设', row.system.includes('美院三年级'), row.system.slice(0,80));
  ok('消息数组里有我发的那句', row.messages.some(m=>m.content.includes('在吗')));
  ok('回复也记下来了', row.reply.includes('嗯'), row.reply);
  const txt=trace.asText(row);
  ok('导出的文本三段齐全',
    txt.includes('=== system ===')&&txt.includes('=== 消息 ===')&&txt.includes('=== 回复 ==='), txt.slice(0,120));
  ok('导出里带了任务与接口', txt.includes('chat.reply')&&txt.includes('gpt-test'), txt.slice(0,200));
  return { R, sys: row.system, msgs: row.messages.length };
});
cmp.R.forEach(r=>ok(r.name,r.pass,r.extra));
const sent = bodies[bodies.length-1];
ok('记的 system 和真发出去的一字不差',
  sent.messages.find(m=>m.role==='system')?.content===cmp.sys, '两边不一致');
ok('记的消息条数和真发出去的一致',
  sent.messages.filter(m=>m.role!=='system').length + 1 >= cmp.msgs, `${sent.messages.length} / ${cmp.msgs}`);

// ---- 界面 ----
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('settings','/trace');
});
await page.waitForTimeout(700);
const ui = await page.locator('.app-layer').innerText();
ok('请求记录页打得开', ui.includes('请求记录'), ui.slice(0,100));
ok('写清楚了它是干什么的与默认关闭', ui.includes('用于排查提示词')&&ui.includes('无需开启'), ui.slice(0,400));
ok('列出了刚才那一轮', ui.includes('chat.reply'), ui.slice(0,600));
ok('保留条数能填', ui.includes('保留条数')&&ui.includes('填 0'), ui.slice(0,700));
await page.screenshot({path:`${OUT}/trace-list.png`});

await page.locator('.list-item').filter({ hasText:'chat.reply' }).first().click();
await page.waitForTimeout(500);
const detail = await page.locator('.app-layer').innerText();
ok('点开看得到详情', detail.includes('这一轮发了什么'), detail.slice(0,100));
ok('详情里有 system 这一段', detail.includes('system'), detail.slice(0,300));
ok('默认只摊开 system 一段', detail.includes('美院三年级'), detail.slice(0,600));
await page.screenshot({path:`${OUT}/trace-detail.png`});

// 存储页那个入口
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('settings','/storage');
});
await page.waitForTimeout(600);
const stor = await page.locator('.app-layer').innerText();
ok('存储页底下有入口', stor.includes('请求记录'), stor.slice(-300));
ok('入口处写明默认关闭', stor.includes('默认关闭'), stor.slice(-300));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
