// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 引擎 ----
const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const se=await import('/src/system/search.js');
  const acc=await import('/src/system/accounts.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});

  const mk=(name)=>{const c=db.characters.create({name});
    return db.chats.create({characterIds:[c.id],personaId:me.id,lastMessageAt:Date.now()});};
  const A=mk('阿岚'), B=mk('林一');
  const t=Date.now()-1000000;
  const add=(chat,i,txt,role='user')=>db.messages.create(
    {chatId:chat.id,role,authorId:role==='user'?'me':chat.characterIds[0],
     kind:'text',content:txt,status:'done',createdAt:t+i*1000},{persist:false});

  add(A,1,'昨天的火锅很好吃');
  add(A,2,'下次还去那家',   'char');
  add(B,3,'周末一起看电影吧');
  add(A,4,'火锅店周一休息');
  add(B,5,'Hello World',    'char');
  add(A,6,'空');
  db.messages.create({chatId:A.id,role:'char',kind:'typing',content:'火锅火锅',status:'sending'},{persist:false});

  const run=(q,opt)=>se.searchMessages(q,opt).done;

  let r=await run('火锅');
  ok('搜到两条', r.hits.length===2, JSON.stringify(r.hits.map(id=>db.messages.get(id).content)));
  ok('按时间倒序，最新的在前',
    db.messages.get(r.hits[0]).content==='火锅店周一休息', db.messages.get(r.hits[0]).content);
  ok('正在输入的占位不参与搜索',
    !r.hits.some(id=>db.messages.get(id).kind==='typing'));
  ok('全扫完时 truncated 为假', r.truncated===false);

  r=await run('火锅',{chatId:B.id});
  ok('限定会话就搜不到别处的', r.hits.length===0, JSON.stringify(r.hits));
  r=await run('电影',{chatId:B.id});
  ok('限定会话能搜到自己的', r.hits.length===1);

  r=await run('hello');
  ok('英文不分大小写', r.hits.length===1, JSON.stringify(r.hits));
  r=await run('WORLD');
  ok('查询是大写也认', r.hits.length===1);

  r=await run('  火锅  ');
  ok('前后空白不影响', r.hits.length===2);
  r=await run('   ');
  ok('只有空白就什么都不搜', r.hits.length===0 && r.finished);

  // 跨会话归并的顺序
  const all=await run('一');   // 「周末一起看电影」「林一」不在消息里
  ok('跨会话结果也是整体倒序',
    all.hits.every((id,i)=>i===0||db.messages.get(all.hits[i-1]).createdAt>=db.messages.get(id).createdAt),
    JSON.stringify(all.hits.map(id=>db.messages.get(id).createdAt)));

  // 够数就停
  for(let i=0;i<50;i++) add(A,100+i,'重复重复重复'+i);
  r=await run('重复',{limit:10});
  ok('凑满 limit 就停下', r.hits.length===10 && r.truncated===true, JSON.stringify([r.hits.length,r.truncated]));
  ok('停下来的也是最新那几条',
    db.messages.get(r.hits[0]).content==='重复重复重复49', db.messages.get(r.hits[0]).content);

  // 截取与高亮
  ok('截取会把命中处留在中间',
    se.excerpt('前面很长很长很长很长很长很长很长很长很长的一段话火锅在这里','火锅').includes('火锅'));
  ok('太靠后就加省略号', se.excerpt('０１２３４５６７８９'.repeat(5)+'火锅','火锅').startsWith('…'));
  ok('切三段', JSON.stringify(se.splitHit('去吃火锅吧','火锅'))==='["去吃","火锅","吧"]');
  ok('切不中就整段当前缀', JSON.stringify(se.splitHit('去吃火锅吧','面条'))==='["去吃火锅吧","",""]');

  return { results:R, chatA:A.id, chatB:B.id };
});
out.results.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 规模：十五万条，每一片都不许超过一帧 ----
const perf = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const se=await import('/src/system/search.js');
  const acc=await import('/src/system/accounts.js');
  const me=acc.roots()[0];
  const W=['今天','天气','不错','我们','一起','出去','走走','晚饭','火锅','明天',
           '面试','紧张','睡觉','晚安','想你','下班','地铁','周末','电影','等你'];
  const pick=()=>{let s='';const n=6+Math.floor(Math.random()*14);
    for(let i=0;i<n;i++)s+=W[Math.floor(Math.random()*W.length)];return s;};
  const ids=[];
  for(let i=0;i<40;i++){const c=db.characters.create({name:'群众'+i});
    ids.push(db.chats.create({characterIds:[c.id],personaId:me.id,lastMessageAt:Date.now()}).id);}
  for(let j=0;j<150000;j++)
    db.messages.create({chatId:ids[j%40],role:j%2?'char':'user',kind:'text',
      content:pick(),status:'done'},{persist:false});

  const time=async(q)=>{let worst=0,last=performance.now(),first=-1;const t=last;
    const h=se.searchMessages(q,{onBatch:(hits)=>{const n=performance.now();
      worst=Math.max(worst,n-last);last=n;if(first<0&&hits.length)first=n-t;}});
    const r=await h.done;
    return {全程:+(performance.now()-t).toFixed(1),最长一片:+worst.toFixed(1),首屏:+first.toFixed(1),条数:r.hits.length};};

  const 冷启动=await time('火锅');       // 这一轮顺带把各会话的排序缓存建起来
  const 常见词=await time('火锅');
  const 单字=await time('晚');
  const 罕见词组=await time('地铁周末电影等你');
  const 搜不到=await time('这句话根本不存在');

  // 取消：挑一个要扫全库的词，扫到一半叫停
  let job=null, stopped=false;
  job=se.searchMessages('这句话根本不存在',{onBatch:()=>{ if(!stopped&&job){stopped=true;job.cancel();} }});
  const cut=await job.done;

  return { 总数:db.messages.count(), 冷启动, 常见词, 单字, 罕见词组, 搜不到,
           取消了:cut.finished===false };
});
console.log('\n  十五万条下的表现:');
Object.entries(perf).forEach(([k,v])=>console.log('   ', k, JSON.stringify(v)));
const worst = Math.max(...Object.values(perf).filter(v=>v&&v.最长一片).map(v=>v.最长一片));
ok('没有哪一片超过 30ms（一帧的两倍）', worst < 30, String(worst));
ok('常见词一片就出来，不必扫全库', perf.常见词.全程 < 5, JSON.stringify(perf.常见词));
// 量的是「随扫随出」这个性质本身：第一条远早于整轮扫完。
// 不卡一个绝对毫秒数 —— 机器一忙就会误报。
ok('罕见词也能立刻见到第一条',
  perf.罕见词组.首屏 > 0 && perf.罕见词组.首屏 < perf.罕见词组.全程 * 0.7,
  JSON.stringify(perf.罕见词组));
ok('扫到一半能叫停', perf.取消了 === true, String(perf.取消了));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
