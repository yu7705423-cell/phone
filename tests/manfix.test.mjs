// 手动整理：规则认不出的走形，自己改原文再重新分条
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 一轮掉了格式的回复：骰子写成了本地一条规则都认不出的样子
const RAW = '来决定一下\n《掷个骰子吧》\n看谁先说';
const ids = await page.evaluate(async (raw) => {
  const db=(await import('/src/system/db/index.js'));
  const r=(await import('/src/system/ai/reply.js'));
  const ch = db.characters.create({ name:'桐生' });
  const chat = db.chats.create({ characterIds:[ch.id], personaId:'me', title:'桐生' });
  const turnId = 'turn-1';
  const parts = r.splitReply(raw);
  parts.forEach((p, i) => r.materialize(p, {
    chatId: chat.id, role:'char', authorId: ch.id, turnId, status:'done',
    createdAt: Date.now() + i,
    ...(i === 0 ? { raw, swipes:[raw], swipeIndex:0 } : {}),
  }, db.characters.get(ch.id)));
  const rows = r.turnMessages(chat.id, turnId);
  return { ch: ch.id, chat: chat.id, turnId, first: rows[0].id, n: rows.length };
}, RAW);
ok('这一轮落成了三条，骰子那行是普通文本（本地认不出）', ids.n === 3, String(ids.n));

// ---- 本地规则确实一条都没命中 ----
const auto = await page.evaluate(async (id) => {
  const db=(await import('/src/system/db/index.js'));
  const rp=(await import('/src/system/ai/repair.js'));
  const m = db.messages.all().find(x => /掷个骰子/.test(x.content || ''));
  return { fixes: rp.fixesFor(m).map(f => f.id), mid: m.id };
}, ids.first);
ok('那一条上「修正格式」一条都列不出来（正是报上来的那种情况）',
  auto.fixes.length === 0, JSON.stringify(auto.fixes));

// ---- 手动那条路：原文拿得到，而且是整轮的 ----
const src = await page.evaluate(async (mid) => {
  const db=(await import('/src/system/db/index.js'));
  const rp=(await import('/src/system/ai/repair.js'));
  return rp.manualSource(db.messages.get(mid));
}, auto.mid);
ok('从中间那一条也取得到整轮原文', src.text === '来决定一下\n《掷个骰子吧》\n看谁先说', JSON.stringify(src.text));
ok('作用范围是整轮，不是这一条', src.scope === 'turn' && src.count === 3, JSON.stringify(src));

// ---- 边打字边预览 ----
const pv = await page.evaluate(async () => {
  const rp=(await import('/src/system/ai/repair.js'));
  return {
    good: rp.previewSplit('来决定一下\n[骰子]\n看谁先说'),
    empty: rp.previewSplit('   '),
  };
});
ok('预览说得出会分成几条', pv.good.n === 3 && /3 条/.test(pv.good.note), JSON.stringify(pv.good));
ok('空的时候不让走', pv.empty.n === 0, JSON.stringify(pv.empty));

// ---- 应用 ----
const done = await page.evaluate(async ([mid, chat, turnId]) => {
  const db=(await import('/src/system/db/index.js'));
  const r=(await import('/src/system/ai/reply.js'));
  const rp=(await import('/src/system/ai/repair.js'));
  const note = rp.applyManual(mid, '来决定一下\n[骰子]\n看谁先说');
  const rows = r.turnMessages(chat, turnId);
  return { note, kinds: rows.map(m => m.kind), n: rows.length,
    raw: rows[0]?.raw || '', stray: rows.some(m => /掷个骰子/.test(m.content || '')) };
}, [auto.mid, ids.chat, ids.turnId]);
ok('分回三条，中间那条成了骰子', done.kinds.join(',') === 'text,dice,text', JSON.stringify(done.kinds));
ok('原来那三条被换掉了，没有留下旧的', done.n === 3 && done.stray === false, JSON.stringify(done));
ok('改过的原文存回去了，下次接着这一版改', done.raw === '来决定一下\n[骰子]\n看谁先说', JSON.stringify(done.raw));

// ---- 没有 raw 的（用户自己发的）只动这一条 ----
const one = await page.evaluate(async (chat) => {
  const db=(await import('/src/system/db/index.js'));
  const rp=(await import('/src/system/ai/repair.js'));
  const m = db.messages.create({ chatId: chat, role:'user', authorId:'me', kind:'text',
    content:'甲\n乙', status:'done' });
  const src = rp.manualSource(m);
  const note = rp.applyManual(m.id, '甲\n[骰子]\n乙');
  const rows = db.messages.all().filter(x => x.chatId === chat && x.role === 'user');
  return { scope: src.scope, text: src.text, note, kinds: rows.map(r2 => r2.kind) };
}, ids.chat);
ok('没有原文时作用范围只是这一条', one.scope === 'one' && one.text === '甲\n乙', JSON.stringify(one));
ok('照样分得开', one.kinds.join(',') === 'text,dice,text', JSON.stringify(one.kinds));

// ---- 界面上那一条路 ----
await page.evaluate(async ([chat]) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/chat/${chat}`);
}, [ids.chat]);
await page.waitForTimeout(900);
const bubble = page.locator('.msg').first();
await bubble.click({ button:'right' }).catch(()=>{});
await page.evaluate(() => {
  const el = document.querySelector('.msg');
  el?.dispatchEvent(new TouchEvent('touchstart', { bubbles:true, touches:[] }));
});
await page.waitForTimeout(1200);
const menuText = await page.locator('.sheet, .overlay').last().textContent().catch(()=>'');
ok('长按能弹出菜单', /修正格式|复制|删除/.test(menuText), menuText.slice(0,120));
await page.screenshot({path:`${OUT}/manfix.png`});

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
