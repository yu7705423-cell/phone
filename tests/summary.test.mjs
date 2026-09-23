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

// --- shouldAutoExtract 的门 ---
const gate = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js'); const acc=await import('/src/system/accounts.js');
  const mex=await import('/src/system/ai/tasks/memory-extract.js');
  const me=acc.roots()[0]||acc.createRoot({name:'我'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  const t=Date.now();
  for (let i=0;i<5;i++) {
    db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'a'+i,status:'done',createdAt:t+i*2});
    db.messages.create({chatId:chat.id,role:'char',authorId:c.id,kind:'text',content:'b'+i,status:'done',createdAt:t+i*2+1});
  }
  const out = {};
  db.settings.set({ memoryEnabled: true });
  out.at3 = mex.shouldAutoExtract(chat.id, 3);
  out.at9 = mex.shouldAutoExtract(chat.id, 9);
  out.at0 = mex.shouldAutoExtract(chat.id, 0);
  out.at100 = mex.shouldAutoExtract(chat.id, 100);
  db.settings.set({ memoryEnabled: false });
  out.memOff = mex.shouldAutoExtract(chat.id, 3);
  db.settings.set({ memoryEnabled: true });
  out.pending = mex.pendingOf(chat.id).filter(m=>m.role==='char').length;
  return out;
});
ok('5 轮回复，间隔 3 会触发', gate.at3 === true);
ok('间隔 9 还不到不触发', gate.at9 === false);
ok('间隔 0 等于关闭', gate.at0 === false);
ok('大数值也不触发', gate.at100 === false);
ok('记忆关掉就不自动提取了', gate.memOff === false);
ok('未总结轮数算得对', gate.pending === 5, gate.pending);

// --- 界面：自己填轮数 ---
await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  db.settings.set({ memoryEnabled: true, autoSummarizeInterval: 0 });
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat','/context');
});
await page.waitForTimeout(700);
const read = async () => page.locator('.app-layer').innerText();
// 这一页现在有好几个数字输入框（历史范围、扫描窗口、注入预算、记忆条数），
// 所以按「间隔轮数」那个 Field 定位，别再拿 .num-row 全局数个数。
const roundsField = page.locator('.field').filter({ has: page.locator('.field-label', { hasText: '间隔轮数' }) });
const rounds = roundsField.locator('input');
ok('关着的时候不显示轮数输入框', await rounds.count() === 0);
ok('副标题说明了关着会怎样', (await read()).includes('立即总结记忆'), (await read()).slice(0,60));

// 打开自动总结
const autoRow = page.locator('.list-item').filter({ has: page.locator('.li-title', { hasText: /^自动总结$/ }) }).first();
await autoRow.locator('.switch').click();
await page.waitForTimeout(400);
ok('打开后出现输入框', await rounds.count() === 1);
ok('默认填 6', await rounds.inputValue() === '6',
  await rounds.inputValue());
ok('旁边写着单位', (await roundsField.locator('.num-unit').innerText()) === '轮');

// 自己填一个滑块给不了的数
await rounds.fill('45');
await page.waitForTimeout(400);
let saved = await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().autoSummarizeInterval);
ok('填 45 存下来了（原来的滑块上限是 30）', saved === 45, saved);
ok('副标题跟着变', (await read()).includes('每回复 45 轮'), (await read()).match(/自动总结[\s\S]{0,40}/)?.[0]);

// 清空不应该把开关顺手关掉
await rounds.fill('');
await page.waitForTimeout(350);
saved = await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().autoSummarizeInterval);
ok('清空输入框不会把自动总结关掉', saved === 45, saved);
ok('清空时输入框确实是空的', await rounds.inputValue() === '');
await rounds.blur();
await page.waitForTimeout(350);
ok('失焦后复原成真实值', await rounds.inputValue() === '45',
  await rounds.inputValue());

// 填 0 / 负数不落盘
await rounds.fill('0');
await page.waitForTimeout(300);
saved = await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().autoSummarizeInterval);
ok('填 0 不落盘', saved === 45, saved);
await rounds.blur();
await page.waitForTimeout(300);

// 关掉再打开，记得上次填的
await autoRow.locator('.switch').click();
await page.waitForTimeout(400);
ok('关掉后输入框收起', await rounds.count() === 0);
saved = await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().autoSummarizeInterval);
ok('关掉后存 0', saved === 0, saved);
await autoRow.locator('.switch').click();
await page.waitForTimeout(400);
ok('再打开记得上次填的 45', await rounds.inputValue() === '45',
  await rounds.inputValue());

await page.screenshot({path:`${OUT}/q1-context.png`});

// --- 会话菜单里两者连在一起 ---
const chatId = await page.evaluate(async () => (await import('/src/system/db/index.js')).chats.all()[0].id);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(async id => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat', `/chat/${id}`);
}, chatId);
await page.waitForTimeout(800);
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(600);
const menu = await page.locator('.fullsheet').innerText();
ok('菜单里写出了自动总结的设定', /立即总结记忆[\s\S]{0,60}每 45 轮自动总结/.test(menu),
  menu.match(/立即总结记忆[\s\S]{0,60}/)?.[0]);
await page.screenshot({path:`${OUT}/q2-menu.png`});

await browser.close();
const bad = R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
