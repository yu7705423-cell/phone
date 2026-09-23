import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
// 聊天走的是流式，得按 SSE 回，普通 JSON 解不出东西
const reply = '重新生成出来的新回复';
const sse = [...reply].map(ch =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
await page.route('**/chat/completions', r => r.fulfill({
  status: 200, contentType: 'text/event-stream; charset=utf-8', body: sse }));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js'); const acc=await import('/src/system/accounts.js');
  const svc=await import('/src/system/ai/services.js'); const reply=await import('/src/system/ai/reply.js');
  const nav=await import('/src/system/nav.js');
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id,lastMessageAt:Date.now()});
  svc.newChatPreset({ name:'测试', provider:'openai', baseUrl:'https://api.example.com/v1', apiKey:'k', model:'m' });
  // 顺序靠真实时间，别自己写 createdAt —— renderTurn 用的是 Date.now()，
  // 写死的值会和它撞在一起，顺序就乱了
  const gap = () => new Promise(r => setTimeout(r, 30));
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'第一句',status:'done'});
  await gap();
  await reply.renderTurn({ chat, char:c, raw:'旧的第一轮', turnId:'turn_a', instant:true });
  await gap();
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'第二句',status:'done'});
  await gap();
  await reply.renderTurn({ chat, char:c, raw:'旧的第二轮', turnId:'turn_b', instant:true });
  nav.goHome(); nav.openApp('chat',`/chat/${chat.id}`);
  return { chat: chat.id, char: c.id };
});
await page.waitForTimeout(700);
{
  const order = await page.evaluate(async id => {
    const db=await import('/src/system/db/index.js');
    return db.messagesOf(id).map(m=>m.content);
  }, ids.chat);
  ok('先确认消息顺序是对的', JSON.stringify(order) === JSON.stringify(['第一句','旧的第一轮','第二句','旧的第二轮']),
    JSON.stringify(order));
}

// 右上角菜单里不该再有「重新生成」
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(500);
const menu = await page.locator('.fullsheet').innerText();
ok('右上角菜单里没有重新生成了', !menu.includes('重新生成'), menu.replace(/\n/g,' / '));
ok('右上角菜单其余项还在', menu.includes('多选消息') && menu.includes('清空聊天记录'));
// Esc 会被当成「返回」，直接退出会话。关浮层点遮罩。
const closeSheet = async sel => { await page.locator(sel).click({ position: { x: 8, y: 8 } }); await page.waitForTimeout(450); };
await page.locator('.fullsheet [aria-label="返回"]').click();
await page.waitForTimeout(500);

const hold = async n => {
  const el = page.locator('.msg').nth(n);
  await el.dispatchEvent('touchstart'); await page.waitForTimeout(700); await el.dispatchEvent('touchend');
  await page.waitForTimeout(400);
};
const sheetText = () => page.locator('.sheet').innerText();

// 最后一条角色消息：有「重新生成」
await hold(3);
ok('最后一轮的角色消息，菜单里有重新生成', (await sheetText()).includes('重新生成'), (await sheetText()).replace(/\n/g,' / '));
await page.screenshot({path:`${OUT}/r1-menu.png`});
await page.getByText('重新生成', { exact: true }).click();
await page.waitForTimeout(2500);
const after = await page.evaluate(async id => {
  const db=await import('/src/system/db/index.js');
  return db.messagesOf(id).map(m => ({ c:m.content, t:m.turnId, sw:m.swipes?.length }));
}, ids.chat);
ok('第二轮被换成了新内容', after.at(-1).c === '重新生成出来的新回复', JSON.stringify(after));
ok('还是同一个 turnId', after.at(-1).t === 'turn_b', after.at(-1).t);
ok('旧版留作候选', after.at(-1).sw === 2, after.at(-1).sw);
ok('第一轮没被动过', after.some(m => m.c === '旧的第一轮'), JSON.stringify(after.map(m=>m.c)));

// 早先那一轮：没有「重新生成」
await hold(1);
ok('中间某一轮的角色消息，菜单里没有重新生成', !(await sheetText()).includes('重新生成'),
  (await sheetText()).replace(/\n/g,' / '));
await closeSheet('.overlay');
console.log('  [dump] msg=', await page.locator('.msg').count(),
  ' sheet=', await page.locator('.sheet').count(),
  ' crash=', await page.locator('.crash').count(),
  ' layer=', (await page.locator('.app-layer').innerText().catch(()=>'(无)')).slice(0,60).replace(/\n/g,' / '));

// 用户自己的消息：也没有
await hold(0);
ok('用户自己的消息没有重新生成', !(await sheetText()).includes('重新生成'),
  (await sheetText()).replace(/\n/g,' / '));
await closeSheet('.overlay');

// 长按禁选：三处都带上了 no-callout
const classes = await page.evaluate(() => ({
  msg: !!document.querySelector('.msg.no-callout'),
}));
ok('会话气泡带 no-callout', classes.msg);
// 会话是 push 在栈上的，openApp 同一个 app 不会把它弹掉，重开页面最省事
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat','/');
});
await page.waitForTimeout(900);
await page.getByText('消息', { exact: true }).last().click().catch(()=>{});
await page.waitForTimeout(700);
console.log('  [dump2]', (await page.locator('.app-layer').innerText().catch(()=>'(无)')).slice(0,120).replace(/\n/g,' / '),
  ' | tabs=', await page.locator('.tabbar').count(), ' rows=', await page.locator('.msg-row').count(),
  ' cap=', await page.locator('.capsule').count());
const lists = await page.evaluate(() => {
  const rows = document.querySelectorAll('.msg-row');
  return { n: rows.length, all: [...rows].every(r => r.classList.contains('no-callout')),
    css: rows[0] ? getComputedStyle(rows[0]).webkitUserSelect : '' };
});
ok('消息列表每一行都带 no-callout 且样式生效',
  lists.n > 0 && lists.all && lists.css === 'none', JSON.stringify(lists));
const home = await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js');
  nav.goHome();
  await new Promise(r=>setTimeout(r,500));
  const el = document.querySelector('.home');
  return el ? { has: el.classList.contains('no-callout'),
    css: getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect } : null;
});
ok('主界面带 no-callout 且样式真的生效', home && home.has && home.css === 'none', JSON.stringify(home));

await browser.close();
const bad = R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
