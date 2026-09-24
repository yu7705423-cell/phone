// 挂载点：样板间要盖住类名表列出的每一处，列不到的要说清楚为什么
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/chat/completions', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const skin=await import('/src/system/skin.js');
  const c=db.characters.create({ name:'阿岚' });
  const chat=db.chats.create({ characterIds:[c.id], lastMessageAt:Date.now() });
  db.messages.create({ chatId:chat.id, role:'char', kind:'text', content:'角色的一条', status:'done' });
  db.messages.create({ chatId:chat.id, role:'user', kind:'text', content:'我的一条', status:'done' });
  const s=skin.create({ name:'挂载点' });
  skin.attach(chat.id, s.id);
  db.settings.set({ msgStamp:'off', msgRead:false });
  return { chatId:chat.id, skinId:s.id };
});
const goSkin = async () => {
  await page.evaluate(async ({chatId}) => {
    const n=await import('/src/system/nav.js');
    n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/skin/${chatId}`);
  }, ids);
  await page.waitForSelector('.skin-sample-wrap'); await page.waitForTimeout(900);
};
await goSkin();

// ---- 样板间里底栏在不在 ----
const has = sel => page.locator(`.skin-sample-wrap ${sel}`).count();
ok('样板间里有底栏', await has('.composer-bar') === 1);
ok('样板间里有输入框与发送键',
  await has('.composer-input') === 1 && await has('.send-btn') === 1);
ok('样板间里有引用条', await has('.quote-ref') === 1);

// ---- 样板间用的是真组件：会话页与样板间的底栏结构一致 ----
const shapeOf = root => page.evaluate(sel => {
  const bar = document.querySelector(`${sel} .composer-bar`);
  if (!bar) return null;
  return [...bar.children].map(el => el.className.split(' ')[0]).join(',');
}, root);
const sampleShape = await shapeOf('.skin-sample-wrap');
await page.evaluate(async ({chatId}) => {
  const n=await import('/src/system/nav.js'); n.pop(); n.push(`/chat/${chatId}`);
}, ids);
await page.waitForSelector('.composer-bar'); await page.waitForTimeout(800);
const liveShape = await shapeOf('.conv-page, .page');
ok('样板间和会话页的底栏是同一份结构',
  !!sampleShape && sampleShape === liveShape, `样板间 ${sampleShape} / 会话 ${liveShape}`);

// ---- 会话页那条底栏还能用（抽组件不许把真页面弄坏）----
await page.locator('.composer-input').fill('抽完组件还发得出去');
await page.waitForTimeout(300);
ok('打了字就换成发送键', await page.locator('.send-btn:not(.is-ghost)').count() === 1);
await page.locator('.send-btn').first().click();
await page.waitForTimeout(900);
const sent = await page.evaluate(async ({chatId}) => {
  const db=await import('/src/system/db/index.js');
  return db.messages.where(m => m.chatId===chatId && m.role==='user')
    .some(m => m.content==='抽完组件还发得出去');
}, ids);
ok('点发送真的发出去了', sent, '库里没有这条');

// ---- 样板间那条是死的 ----
await goSkin();
const inert = await page.evaluate(() => {
  const ta = document.querySelector('.skin-sample-wrap .composer-input');
  return { readOnly: ta?.readOnly, val: ta?.value };
});
ok('样板间的输入框是只读的', inert.readOnly === true, JSON.stringify(inert));
const before = await page.evaluate(async ({chatId}) => {
  const db=await import('/src/system/db/index.js');
  return db.messages.where(m => m.chatId===chatId).length;
}, ids);
await page.locator('.skin-sample-wrap .send-btn').first().click({force:true});
await page.locator('.skin-sample-wrap .composer-side').first().click({force:true});
await page.waitForTimeout(700);
const after = await page.evaluate(async ({chatId}) => {
  const db=await import('/src/system/db/index.js');
  return db.messages.where(m => m.chatId===chatId).length;
}, ids);
ok('点样板间里的按钮什么也不会发生', before === after, `${before} -> ${after}`);

// ---- 底栏那两项令牌现在看得出效果 ----
const sideW = () => page.evaluate(() => {
  const el = document.querySelector('.skin-sample-wrap .composer-side');
  return el ? Math.round(el.getBoundingClientRect().width) : 0;
});
const w0 = await sideW();
await page.evaluate(async (skinId) => {
  const skin=await import('/src/system/skin.js');
  skin.update(skinId, { tokens: { barH: 56 } });
}, ids.skinId);
await page.waitForTimeout(900);
const w1 = await sideW();
ok('调「底栏按钮大小」，样板间当场跟着变', w0 !== w1 && w1 === 56, `${w0} -> ${w1}`);
await page.evaluate(async (skinId) => {
  const skin=await import('/src/system/skin.js');
  skin.update(skinId, { tokens: {} });
}, ids.skinId);
await page.waitForTimeout(700);

// 从前这里还有一页「类名」，逐条数内部类名（.msg、.bubble……）在样板间里命中几处。
// 内部类名不对外承诺（CLAUDE.md 第 18 条），那一页与那张表一并去掉；对外的是 ph- 那一套，
// 在「美化」app 的「写给作者」里，由 stage.mjs 与 contract 两个测试盯着
await page.screenshot({path:`${OUT}/mounts.png`, fullPage:true});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
