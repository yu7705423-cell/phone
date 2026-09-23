// 接口自动轮循：按顺序换、换几套听用户的、取消不换、账要算对
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
// 每套接口一个端口号后缀，看得出到底打了谁。ok 的那一套才回内容
let hits=[]; let okOne='';
await page.route('**/*', async r => {
  const u=r.request().url();
  if (process.env.DBG && /completions/.test(u)) console.log('URL:', u);
  const m=/\/p(\d)\//.test(u) && /chat\/completions/.test(u)
    ? /\/p(\d)\//.exec(u) : null;
  if (m) { const who='p'+m[1]; hits.push(who);
    if (who===okOne) return r.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({choices:[{message:{content:'好'}}]})});
    return r.fulfill({status:500,contentType:'application/json',
      body:JSON.stringify({error:{message:who+' 挂了'}})}); }
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const setup = await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const ids=[];
  for (let i=1;i<=4;i++) {
    const p=svc.newChatPreset({ name:'接口'+i, provider:'openai',
      baseUrl:`${BASE}/p${i}`, apiKey:'sk-t', model:'gpt-4o' });
    ids.push(p.id);
  }
  // 第 5 套故意没填全，应该被跳过
  const half=svc.newChatPreset({ name:'没填全', provider:'openai',
    baseUrl:`${BASE}/p9`, apiKey:'', model:'' });
  svc.setActiveChat(ids[0]);
  svc.setFallbackChat(ids[1]);
  return { ids, half: half.id };
});

const run = async (label) => {
  hits=[];
  const got = await page.evaluate(async () => {
    const e=await import('/src/system/ai/engine.js');
    try { const t=await e.runTextTask('chat.reply',{ system:'s', user:'u', key:'k'+Math.random() });
      return { ok:true, t }; }
    catch(err){ return { ok:false, err:String(err.message||err) }; }
  });
  return { got, hits:[...hits] };
};
const conf = patch => page.evaluate(async p => {
  const db=await import('/src/system/db/index.js'); db.settings.set(p);
}, patch);

// ---- 一、开关关着：只打一次 ----
await conf({ chatFallback:false, retryMax:0 });
okOne='';
let r = await run();
ok('关着的时候只打主用一次', r.hits.join(',')==='p1', r.hits.join(','));
ok('报错里写明是哪一套', /接口1/.test(r.got.err||''), r.got.err);

// ---- 二、开着，默认只换 1 套（和从前的副用一样）----
await conf({ chatFallback:true, failoverMax:1 });
r = await run();
ok('默认只换一套：主用 -> 副用', r.hits.join(',')==='p1,p2', r.hits.join(','));
ok('都失败时把试过的都列出来',
  /接口1/.test(r.got.err||'') && /接口2/.test(r.got.err||'') && /都失败/.test(r.got.err||''),
  r.got.err);

// ---- 三、换 3 套：按主用->副用->其余的顺序 ----
await conf({ failoverMax:3 });
r = await run();
ok('换 3 套，顺序是主用、副用、其余', r.hits.join(',')==='p1,p2,p3,p4', r.hits.join(','));
ok('没填全的那一套被跳过了', !r.hits.includes('p9'), r.hits.join(','));

// ---- 四、填 0 表示全试 ----
await conf({ failoverMax:0 });
r = await run();
ok('填 0 = 其余的全试', r.hits.join(',')==='p1,p2,p3,p4', r.hits.join(','));

// ---- 五、中途有一套是好的，就停在那儿 ----
okOne='p3';
await conf({ failoverMax:0 });
r = await run();
ok('第三套能用：换到它就停，不再往下打', r.hits.join(',')==='p1,p2,p3', r.hits.join(','));
ok('并且真的拿到了结果', r.got.ok===true && r.got.t==='好', JSON.stringify(r.got));

// ---- 六、主用本身就是好的：一次都不换 ----
okOne='p1';
r = await run();
ok('主用没问题时一套都不换', r.hits.join(',')==='p1', r.hits.join(','));

// ---- 七、账要算对 ----
okOne='';
const money = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const cost=await import('/src/system/ai/cost.js');
  const out={};
  db.settings.set({ chatFallback:false, retryMax:0, failoverMax:1 });
  out.off = { swap: cost.swapCount(), attempts: cost.attemptsPerCall() };
  db.settings.set({ chatFallback:true, failoverMax:1 });
  out.one = { swap: cost.swapCount(), attempts: cost.attemptsPerCall() };
  db.settings.set({ failoverMax:0 });
  out.all = { swap: cost.swapCount(), attempts: cost.attemptsPerCall() };
  db.settings.set({ failoverMax:0, retryMax:1 });
  out.allRetry = { swap: cost.swapCount(), attempts: cost.attemptsPerCall() };
  out.usable = cost.usableChatCount();
  db.settings.set({ retryMax:0 });
  return out;
});
ok('关着时一次就是一次', money.off.swap===0 && money.off.attempts===1, JSON.stringify(money.off));
ok('换一套时最多两次', money.one.swap===1 && money.one.attempts===2, JSON.stringify(money.one));
ok('全试时最多四次（填全的四套）',
  money.usable===4 && money.all.swap===3 && money.all.attempts===4, JSON.stringify(money));
ok('再叠上重试是相乘不是相加', money.allRetry.attempts===8, JSON.stringify(money.allRetry));

// ---- 八、只配了一套时，开着也换不出去，账不能吹 ----
const alone = await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const db=await import('/src/system/db/index.js');
  const keep = svc.chatPresets().map(p=>p.id);
  keep.slice(1).forEach(id => svc.removeChatPreset(id));
  db.settings.set({ chatFallback:true, failoverMax:0 });
  const cost=await import('/src/system/ai/cost.js');
  return { usable: cost.usableChatCount(), swap: cost.swapCount(), attempts: cost.attemptsPerCall() };
});
ok('只剩一套：换不出去，仍然算一次',
  alone.swap===0 && alone.attempts===1, JSON.stringify(alone));

// ---- 九、界面 ----
await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const db=await import('/src/system/db/index.js');
  for (let i=2;i<=3;i++) svc.newChatPreset({ name:'再来'+i, provider:'openai',
    baseUrl:`${BASE}/p${i}`, apiKey:'sk-t', model:'gpt-4o' });
  db.settings.set({ chatFallback:false, failoverMax:1 });
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/limits');
});
await page.waitForSelector('.page'); await page.waitForTimeout(600);
let body = await page.locator('.page').innerText();
ok('用量页上是「自动换下一套」而不是旧的「改用副用」',
  /接口失败时自动换下一套/.test(body) && !/改用副用/.test(body), body.slice(0,200));
ok('关着时不显示「最多再换几套」', !/最多再换几套/.test(body));
await page.locator('.list-item').filter({hasText:'接口失败时自动换下一套'}).locator('.switch').click();
await page.waitForTimeout(500);
body = await page.locator('.page').innerText();
ok('打开后出现「最多再换几套」', /最多再换几套/.test(body), body.slice(0,400));
ok('并且说清楚顺序与跳过规则',
  /主用、副用、其余/.test(body) && /没填全/.test(body), body.slice(0,500));
ok('说得出当前填全了几套', /当前填全的共 \d+ 套/.test(body), body.slice(0,600));
await page.screenshot({path:`${OUT}/failover.png`});

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
