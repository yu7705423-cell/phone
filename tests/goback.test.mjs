// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 「过去看一眼就回来」：回来之后那个 app 不该停在被看的那一页上，
// 那条栈底下也必须垫着首页
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue()
  : r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id]});
  db.messages.create({chatId:chat.id,role:'char',authorId:c.id,kind:'text',content:'在',status:'done'});
  return { chatId:chat.id };
});

// ---- 栈上的事，直接问 nav ----
const st = await page.evaluate(async ({chatId}) => {
  const nav=await import('/src/system/nav.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:JSON.stringify(e??'')});
  const S=()=>nav.nav.get();
  const stack=id=>S().stacks[id];
  const peek=()=>{
    nav.goHome();
    nav.openApp('chat', `/chat/${chatId}`);
    nav.openApp('settings', '/limits', { back: true });
  };

  peek();
  ok('看的那一页底下垫着首页', JSON.stringify(stack('settings'))===JSON.stringify(['/','/limits']),
    stack('settings'));
  ok('记下了去的是哪个 app、落在第几层',
    S().returnTo?.to==='settings' && S().returnTo?.appId==='chat' && S().returnTo?.depth===2,
    S().returnTo);

  nav.pop();
  ok('一按返回回到出发的那个 app', S().appId==='chat' && S().stacks.chat.slice(-1)[0]===`/chat/${chatId}`,
    [S().appId, S().stacks.chat]);
  ok('回来之后设置收回了首页', JSON.stringify(stack('settings'))===JSON.stringify(['/']),
    stack('settings'));

  // 这就是报上来的那个：回来之后再从桌面点设置
  nav.goHome(); nav.openApp('settings','/');
  ok('再点设置开的是设置首页', nav.currentRoute()==='/', nav.currentRoute());
  nav.push('/appearance');
  ok('往下走一层', nav.currentRoute()==='/appearance', nav.currentRoute());
  nav.pop();
  ok('返回是上一级，不是桌面', S().screen==='app' && nav.currentRoute()==='/',
    [S().screen, nav.currentRoute()]);

  // 半路按桌面：那一趟也算结束
  peek();
  nav.goHome();
  ok('半路回桌面，设置也收回首页', JSON.stringify(stack('settings'))===JSON.stringify(['/']),
    stack('settings'));
  nav.openApp('settings','/');
  ok('这时点进设置也是首页', nav.currentRoute()==='/', nav.currentRoute());
  nav.pop();
  ok('一按就回桌面（本来就在首页）', S().screen==='home', S().screen);

  // 半路锁屏
  peek(); nav.lock();
  ok('锁屏也算那一趟结束', JSON.stringify(stack('settings'))===JSON.stringify(['/']), stack('settings'));
  nav.unlock();

  // 在被看的那一页里继续往下走
  peek();
  nav.push('/api');
  ok('看的那一页里还能往下走', nav.currentRoute()==='/api', nav.currentRoute());
  nav.pop();
  ok('先退回被看的那一页', S().appId==='settings' && nav.currentRoute()==='/limits',
    [S().appId, nav.currentRoute()]);
  nav.pop();
  ok('再退才是回去', S().appId==='chat', S().appId);
  ok('回去之后设置仍然收回首页', JSON.stringify(stack('settings'))===JSON.stringify(['/']),
    stack('settings'));

  // 半路去了第三个 app
  peek();
  nav.openApp('album','/');
  ok('转身去了别的 app，设置收回首页', JSON.stringify(stack('settings'))===JSON.stringify(['/']),
    stack('settings'));
  ok('那条回头路也不再作数', S().returnTo===null, S().returnTo);

  // 从被看的那一页再看一眼别处：这条栈是新的回头路，不能收
  peek();
  nav.openApp('memory','/', { back: true });
  ok('它成了新的出发地，栈原样留着',
    JSON.stringify(stack('settings'))===JSON.stringify(['/','/limits']), stack('settings'));
  nav.pop();
  ok('退回来落在原来看着的那一页', S().appId==='settings' && nav.currentRoute()==='/limits',
    [S().appId, nav.currentRoute()]);
  nav.pop();
  ok('再退落在设置首页，不是桌面（上一趟的回头路已经用掉了）',
    S().appId==='settings' && nav.currentRoute()==='/', [S().appId, nav.currentRoute()]);

  // 普通的跨 app 交接（不带 back）照旧
  nav.openApp('chat', `/chat/${chatId}`);
  nav.openApp('settings', '/limits');
  ok('不带回头路的那种，栈底下也垫着首页',
    JSON.stringify(stack('settings'))===JSON.stringify(['/','/limits']), stack('settings'));
  nav.pop();
  ok('不带回头路就退到那个 app 自己的首页', S().appId==='settings' && nav.currentRoute()==='/',
    [S().appId, nav.currentRoute()]);

  nav.goHome();
  return R;
}, ids);
st.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 真点一遍：会话菜单里的「用量与上限」 ----
const title = () => page.evaluate(() => document.querySelector('.nav-title')?.textContent?.trim() || '');
await page.evaluate(async ({chatId}) => {
  const nav=await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat', `/chat/${chatId}`);
}, ids);
await page.waitForSelector('.composer-bar', { timeout:5000 });
await page.locator('.navbar .icon-btn').last().click();
await page.waitForTimeout(400);
await page.locator('.list-item', { hasText:'更多' }).last().click();
await page.waitForTimeout(400);
await page.locator('.list-item', { hasText:'每轮的接口调用' }).first().click();
await page.waitForTimeout(500);
ok('从会话里点进了用量', (await title()).includes('用量'), await title());
await page.locator('.navback').click();
await page.waitForTimeout(500);
ok('返回落回会话菜单的「更多」', (await title())==='更多', await title());
await page.locator('.navback').click();
await page.waitForTimeout(500);
ok('再返回落回那段会话', await page.locator('.composer-bar').count()>0, await title());

await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('settings','/');
});
await page.waitForTimeout(500);
ok('这时再开设置，开的是设置', (await title())==='设置', await title());
await page.screenshot({ path:`${OUT}/gb-settings.png` });

ok('没有页面错误', errs.length===0, errs[0]);
const bad=R.filter(r=>!r.pass).length;
console.log(bad? `\n${bad} 项挂` : `\n全部通过（${R.length} 项）`);
await browser.close();
process.exit(bad?1:0);
