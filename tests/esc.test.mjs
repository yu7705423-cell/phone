import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js'); const acc=await import('/src/system/accounts.js');
  const nav=await import('/src/system/nav.js');
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id,lastMessageAt:Date.now()});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'一句话',status:'done'});
  nav.goHome(); nav.openApp('chat',`/chat/${chat.id}`);
  return { chat: chat.id, char: c.id };
});
await page.waitForTimeout(800);
const inConv = async () => (await page.locator('.composer-bar').count()) === 1;
ok('先在会话里', await inConv());

const hold = async n => {
  const el = page.locator('.msg').nth(n);
  await el.dispatchEvent('touchstart'); await page.waitForTimeout(700); await el.dispatchEvent('touchend');
  await page.waitForTimeout(400);
};

// 1. Sheet：Esc 只关浮层
await hold(0);
ok('长按菜单开着', await page.locator('.sheet').count() === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok('Esc 关掉了菜单', await page.locator('.sheet').count() === 0);
ok('但没有退出会话', await inConv());

// 2. FullSheet：同样
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(500);
ok('右上角菜单开着', await page.locator('.fullsheet').count() === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok('Esc 关掉了它', await page.locator('.fullsheet').count() === 0);
ok('还在会话里', await inConv());

// 3. 命令式 confirm：原先完全没处理 Esc
const pending = page.evaluate(async () => {
  const ui = await import('/src/ui/overlay.js');
  return ui.confirm({ title: '删除这条消息', danger: true });
});
await page.waitForTimeout(400);
ok('确认弹窗开着', await page.locator('.modal').count() === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok('Esc 关掉了确认弹窗', await page.locator('.modal').count() === 0);
ok('确认弹窗按取消返回', (await pending) === false);
ok('还在会话里', await inConv());

// 4. 浮层套浮层：一次只关一层
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.push('/context');
});
await page.waitForTimeout(600);
await page.evaluate(async () => {
  const ui = await import('/src/ui/overlay.js');
  window.__p1 = ui.prompt({ title: '外层' });
  await new Promise(r=>setTimeout(r,120));
  window.__p2 = ui.prompt({ title: '内层' });
});
await page.waitForTimeout(400);
ok('两层弹窗都在', await page.locator('.modal').count() === 2, await page.locator('.modal').count());
await page.keyboard.press('Escape');
await page.waitForTimeout(450);
ok('第一次 Esc 只关掉一层', await page.locator('.modal').count() === 1, await page.locator('.modal').count());
const top = await page.locator('.modal-title').innerText();
ok('关掉的是最上面那层', top === '外层', top);
await page.keyboard.press('Escape');
await page.waitForTimeout(450);
ok('第二次 Esc 关掉剩下那层', await page.locator('.modal').count() === 0);
ok('两层都关完之前没有触发返回', (await page.locator('.app-layer').innerText()).includes('上下文与记忆'),
  (await page.locator('.app-layer').innerText()).slice(0,40));

// 5. 一层浮层都没有时，Esc 仍然是返回
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok('没有浮层时 Esc 回到上一页', await inConv(), (await page.locator('.app-layer').innerText()).slice(0,40));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok('再按一次退出会话', !(await inConv()));

// 6. 没有泄漏：关完之后页面上一个浮层都不剩
const leak = await page.evaluate(() => document.querySelectorAll('.overlay').length);
ok('浮层全关干净了，没有泄漏', leak === 0, leak);

await browser.close();
const bad = R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
