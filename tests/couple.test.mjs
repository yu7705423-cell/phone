// 三个钱包：我的钱、角色的钱、情侣账户（ARCHITECTURE 4.278）
//
//   一、关联对话的账本自动有角色的钱包；起始余额记进我的钱
//   二、角色的钱没生成：不注入余额、不拦支付；生成（假接口）之后起始余额与固定收支落账，上下文里有了
//   三、开设情侣账户：旧写法 [开通共同账户] 与新写法 [开设情侣账户] 都认；批准后建出「情侣账户」
//   四、存入：用户存 300、角色写 [存入情侣账户：200]，两边钱包各减、情侣账户加；发出即落定，不用批准
//   五、严格模式下存入超过余额：落一行说明，钱不动；没有情侣账户时存入也不发生
//   六、界面：记账首页列出三个钱包；对话的申请页在没关联账本时发不出、给「建立账本」
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  const json = { balance: 12000, income: [{ day: 10, amount: 8000, note: '工资' }], expenses: [{ day: 1, amount: 2500, note: '房租' }], summary: '在书店工作，每月十号发工资。' };
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(json) } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const r = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const L = await import('/src/system/ledger.js');
  const request = await import('/src/system/request.js');
  const reply = await import('/src/system/ai/reply.js');
  const bill = await import('/src/system/ai/context/bill.js');
  const money = await import('/src/system/ai/tasks/money.js');
  const svc = await import('/src/system/ai/services.js');
  const a = svc.newChatPreset({ name: '甲', provider: 'openai' });
  svc.updateChatPreset(a.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm1' });
  svc.setActiveChat(a.id);
  const out = {};
  const c = db.characters.create({ name: '阿岚', persona: '在书店工作的年轻人。' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const bal = owner => { const acc = L.defaultFor(book.id, owner); return acc ? L.balanceOf(book.id, acc.id) : null; };

  // 一
  const book = L.create({ name: '一起', chatId: chat.id, start: 1000 });
  out.charAcc = L.accountsOf(book.id).find(x => x.owner === 'char')?.name;
  out.mine = bal('me');
  // 二
  out.readyBefore = L.charReady(book.id);
  out.affordUnknown = L.affordable(chat.id, 'char', 99999);
  const ctxBefore = bill.build({ chat }) || '';
  out.noSelfLine = !/Your balance/.test(ctxBefore) && /Balance of/.test(ctxBefore);
  await money.generate(book.id);
  out.readyAfter = L.charReady(book.id);
  out.charBal = bal('char');
  out.rules = L.rulesOf(book.id).filter(x => x.by === 'ai').map(x => `${x.day}:${x.amount}`).sort();
  out.summary = L.charMoneyOf(book.id)?.summary;
  const ctxAfter = bill.build({ chat }) || '';
  out.selfLine = /Your balance: .*12000/.test(ctxAfter);
  out.affordKnown = L.affordable(chat.id, 'char', 99999);
  // 再生成一次：上一次的整批换掉，不叠加
  await money.generate(book.id);
  out.rulesAgain = L.rulesOf(book.id).filter(x => x.by === 'ai').length;
  out.charBalAgain = bal('char');

  // 三
  const p1 = reply.splitReply('好\n[开通共同账户]');
  const p2 = reply.splitReply('好\n[开设情侣账户]');
  out.oldForm = p1.some(x => x.type === 'request' && x.kind === 'joint');
  out.newForm = p2.some(x => x.type === 'request' && x.kind === 'joint');
  const ask = request.send({ chatId: chat.id, role: 'user', authorId: 'me', kind: request.JOINT });
  out.askContent = ask.content;
  await reply.renderTurn({ chat, char: c, raw: '好啊\n[批准]', turnId: 'j1', instant: true });
  out.jointName = L.accountsOf(book.id).find(x => x.owner === 'joint')?.name;
  out.jointBal = bal('joint');
  out.hasJointBefore = L.hasJoint(book.id);

  // 四
  const dep = request.send({ chatId: chat.id, role: 'user', authorId: 'me', kind: request.DEPOSIT, amount: 300 });
  out.depState = dep.request; out.depContent = dep.content;
  out.afterMe = bal('me'); out.afterJoint1 = bal('joint');
  const made = await reply.renderTurn({ chat, char: c, raw: '我也放一点\n[存入情侣账户：200]', turnId: 'd1', instant: true });
  out.charDep = made.find(m => m.kind === 'request')?.requestKind;
  out.afterChar = bal('char'); out.afterJoint2 = bal('joint');
  out.noPending = request.pendingFrom(chat.id, 'char') === null;
  out.ctxJoint = /Couple account.*500/.test(bill.build({ chat }) || '');
  // 撤掉角色那一轮，存入跟着消失
  reply.clearTurn(chat.id, 'd1');
  out.afterUndo = [bal('char'), bal('joint')];

  // 五
  const made2 = await reply.renderTurn({ chat, char: c, raw: '[存入情侣账户：99999]', turnId: 'd2', instant: true });
  out.tooMuch = made2.some(m => m.kind === 'notice' && /余额不足/.test(m.content)) && !made2.some(m => m.kind === 'request');
  out.jointStill = bal('joint');
  let threw = '';
  try { request.send({ chatId: chat.id, role: 'user', authorId: 'me', kind: request.DEPOSIT, amount: 0 }); } catch (e) { threw = e.message; }
  out.zero = /大于/.test(threw);
  // 没有情侣账户的另一段对话：存入不发生
  const c2 = db.characters.create({ name: '乙' });
  const chat2 = db.chats.create({ characterIds: [c2.id], lastMessageAt: Date.now() });
  L.create({ name: '二', chatId: chat2.id });
  const made3 = await reply.renderTurn({ chat: chat2, char: c2, raw: '[存入情侣账户：50]', turnId: 'd3', instant: true });
  out.noJoint = made3.some(m => m.kind === 'notice' && /还没有情侣账户/.test(m.content)) && !made3.some(m => m.kind === 'request');
  out.calls = 0;
  return { ...out, chat: chat.id, book: book.id, chat2: chat2.id, char: c.id };
});

ok('一、关联对话的账本自动有角色的钱包，名字是角色名', r.charAcc === '阿岚', r.charAcc);
ok('一、起始余额记进我的钱', r.mine === 1000, r.mine);
ok('二、没生成：视作未知，不拦支付', r.readyBefore === false && r.affordUnknown === true, JSON.stringify([r.readyBefore, r.affordUnknown]));
ok('二、没生成：上下文里不写角色余额，对方余额照写', r.noSelfLine);
ok('二、生成之后：起始余额落账', r.readyAfter && r.charBal === 12000, JSON.stringify([r.readyAfter, r.charBal]));
ok('二、生成之后：固定收支两条', JSON.stringify(r.rules) === JSON.stringify(['10:8000', '1:-2500']), JSON.stringify(r.rules));
ok('二、生成之后：说明存在账本上', /书店/.test(r.summary || ''), r.summary);
ok('二、生成之后：上下文里有角色余额', r.selfLine);
ok('二、生成之后：严格模式拦得住', r.affordKnown === false);
ok('二、再生成一次不叠加', r.rulesAgain === 2 && r.charBalAgain === 12000, JSON.stringify([r.rulesAgain, r.charBalAgain]));
ok('二、生成调了两次接口（两次生成）', reqs.length === 2, reqs.length);
ok('三、旧写法与新写法都认', r.oldForm && r.newForm);
ok('三、申请的正文是新写法', r.askContent === '[开设情侣账户]', r.askContent);
ok('三、批准后建出「情侣账户」，余额 0', r.jointName === '情侣账户' && r.jointBal === 0 && r.hasJointBefore, JSON.stringify([r.jointName, r.jointBal]));
ok('四、用户存入：发出即落定', r.depState === 'approved' && r.depContent === '[存入情侣账户：300.00]', JSON.stringify([r.depState, r.depContent]));
ok('四、用户存入：我的钱减、情侣账户加', r.afterMe === 700 && r.afterJoint1 === 300, JSON.stringify([r.afterMe, r.afterJoint1]));
ok('四、角色存入：解析成存入，钱包各自变化', r.charDep === 'deposit' && r.afterChar === 11800 && r.afterJoint2 === 500, JSON.stringify([r.charDep, r.afterChar, r.afterJoint2]));
ok('四、存入不挂在待处理上', r.noPending);
ok('四、上下文里写的是情侣账户', r.ctxJoint);
ok('四、撤掉那一轮，存入跟着消失', JSON.stringify(r.afterUndo) === JSON.stringify([12000, 300]), JSON.stringify(r.afterUndo));
ok('五、超过余额：落一行说明，钱不动', r.tooMuch && r.jointStill === 300, JSON.stringify([r.tooMuch, r.jointStill]));
ok('五、金额为 0 发不出', r.zero);
ok('五、没有情侣账户：存入不发生', r.noJoint);

// 六、界面
await ev(async ({ book }) => { const n = await import('/src/system/nav.js'); const L = await import('/src/system/ledger.js'); L.setCurrent(book); n.unlock(); n.goHome(); n.openApp('bill', '/'); }, r);
await page.waitForTimeout(800);
const home = await page.locator('.page').innerText();
ok('六、记账首页列出三个钱包', /我的钱/.test(home) && /阿岚的钱/.test(home) && /情侣账户/.test(home), home.slice(0, 200));
await page.locator('.list-item', { hasText: '情侣账户' }).first().click();
await page.waitForTimeout(600);
const pool = await page.locator('.page').innerText();
ok('六、情侣账户页：余额与存入按钮', /300/.test(pool) && await page.locator('button', { hasText: '从我的钱存入' }).count() === 1, pool.slice(0, 200));
// 没关联账本的对话：申请页
await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const c3 = db.characters.create({ name: '丙' });
  const chat3 = db.chats.create({ characterIds: [c3.id], lastMessageAt: Date.now() });
  window.__chat3 = chat3.id;
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', '/'); n.push(`/chat/${chat3.id}`);
});
await page.waitForTimeout(900);
await page.locator('.composer-side').first().click();
await page.waitForTimeout(500);
// 申请默认收在「更多」里
if (!await page.locator('.panel-item', { hasText: /^申请$/ }).count()) {
  await page.locator('.panel-item').last().click();
  await page.waitForTimeout(500);
}
const hasAsk = await page.locator('.overlay .list-item, .panel-item', { hasText: '申请' }).count();
if (hasAsk) {
  await page.locator('.overlay .list-item, .panel-item', { hasText: '申请' }).first().click();
  await page.waitForTimeout(600);
  ok('六、没关联账本：发不出申请', await page.locator('.sheet button', { hasText: '发出申请' }).isDisabled());
  ok('六、没关联账本：给「建立账本」', await page.locator('.sheet button', { hasText: '建立账本' }).count() === 1);
  await page.locator('.sheet button', { hasText: '建立账本' }).click();
  await page.waitForTimeout(800);
  const sheet = await page.locator('.sheet').innerText().catch(() => '');
  ok('六、过去就是新建账本页，对话已选好', /新建账本/.test(sheet) && /丙/.test(sheet), sheet.slice(0, 120));
} else {
  ok('六、找到了「申请」入口', false, '面板里没有申请');
}

console.log(`\n${R.filter(x => x.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(x => x.pass) && !errs.length ? 0 : 1);
