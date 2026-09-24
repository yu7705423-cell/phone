// 头像框：老那一套（美化行上的三个字段）现在只负责「搬进生成器」。
// 编辑入口只剩生成器里的「头像」一组 —— 第 5 条，同一个开关只能有一个入口。
import { BASE, OUT, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 一张四角不透明、中间透明的 PNG。当框用正合适
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();

// ---- 纯逻辑 ----
const lg = await page.evaluate(async (b64) => {
  const skin = await import('/src/system/skin.js');
  const url = `data:image/png;base64,${b64}`;
  const out = {};
  const row = skin.create({ name:'带框', frame:url, frameWho:'char', frameScale:200 });
  out.stored = { who:row.frameWho, scale:row.frameScale, hasFrame: row.frame===url };
  out.css = skin.compile(row);
  // 三种「戴给谁」各自的选择器
  out.sels = skin.FRAME_WHO.map(w => {
    skin.update(row.id, { frameWho: w.id });
    const c = skin.compile(skin.get(row.id));
    return c.split('::after')[0].trim().split('\n').pop();
  });
  // 大小要夹住
  skin.update(row.id, { frameScale: 9999 });
  out.big = skin.frameScaleOf(skin.get(row.id));
  skin.update(row.id, { frameScale: 1 });
  out.small = skin.frameScaleOf(skin.get(row.id));
  skin.update(row.id, { frameScale: '' });
  out.blank = skin.frameScaleOf(skin.get(row.id));
  skin.update(row.id, { frameScale: 180, frameWho: 'mine' });

  // 没有框的那一份，一个字都不该多发
  const bare = skin.create({ name:'没框', tokens:{ bubbleR:12 } });
  out.bareCss = skin.compile(bare);

  // 手写的那一段必须排在框后面，才盖得住
  const both = skin.create({ name:'两层', frame:url, css:'.msg-face::after{opacity:0}' });
  out.order = skin.compile(both).indexOf('opacity:0') > skin.compile(both).indexOf('::after{content');

  // 导出导入一个来回
  const packed = skin.pack(skin.get(row.id));
  out.packed = JSON.parse(packed);
  const back = skin.unpack(packed);
  out.back = { who:back.frameWho, scale:back.frameScale, same: back.frame===url };
  // 别人给的包里塞一个网络地址，不许放行
  const evil = skin.unpack(JSON.stringify({ kind:'phone-skin', version:1, name:'坏的',
    frame:'https://example.com/a.png', frameWho:'乱写', frameScale:-5 }));
  out.evil = { frame:evil.frame, who:evil.frameWho, scale:evil.frameScale };
  const evil2 = skin.unpack(JSON.stringify({ kind:'phone-skin', version:1, name:'坏的2',
    frame:'data:image/png;base64,AA");}body{display:none}.x{a:url("' }));
  out.evil2 = evil2.frame;
  // 复制要带着框
  const dup = skin.duplicate(row.id);
  out.dup = { same: dup.frame===url, who:dup.frameWho, scale:dup.frameScale };
  out.bytes = skin.gen.weigh({ avatar: { frameTheirs: url } }).bytes;
  out.id = row.id;
  return out;
}, PNG);

ok('框、戴给谁、大小三件都存下来了',
  lg.stored.hasFrame && lg.stored.who==='char' && lg.stored.scale===200, JSON.stringify(lg.stored));
ok('戴双方时选中所有头像', lg.sels[0].startsWith('.msg-face'), JSON.stringify(lg.sels));
ok('仅角色时排除我发的那些', /:not\(\.is-mine\)/.test(lg.sels[1]), JSON.stringify(lg.sels));
ok('仅自己时只选我发的那些', /\.msg\.is-mine \.msg-face/.test(lg.sels[2]), JSON.stringify(lg.sels));
ok('大小夹在上下限之间', lg.big===300 && lg.small===100, JSON.stringify([lg.big,lg.small]));
ok('留空退回默认值', lg.blank===160, String(lg.blank));
ok('生成的 CSS 里 ::after 带图', /::after\{content/.test(lg.css) && /background:url\("data:image/.test(lg.css), lg.css.slice(0,160));
ok('给头像那个盒子补上 position', /\.msg-face\{position:relative\}/.test(lg.css), lg.css.slice(0,120));
ok('框不吃点击', /pointer-events:none/.test(lg.css), lg.css.slice(0,200));
ok('没设框的那一份不发这一段', !/::after/.test(lg.bareCss) && /--ph-bubble-r:12px/.test(lg.bareCss), lg.bareCss);
ok('手写的 CSS 排在框后面，盖得住它', lg.order, String(lg.order));
ok('美化包带着框与两项设置',
  lg.back.same && lg.back.who==='mine' && lg.back.scale===180, JSON.stringify(lg.back));
ok('包里的网络地址一律不认', lg.evil.frame==='', JSON.stringify(lg.evil));
ok('包里乱写的「戴给谁」退回双方', lg.evil.who==='both', JSON.stringify(lg.evil));
ok('包里负数的大小退回默认', lg.evil.scale===160, JSON.stringify(lg.evil));
ok('想借 data URL 逃出 url() 的也不认', lg.evil2==='', JSON.stringify(lg.evil2));
ok('复制一份连框一起带走',
  lg.dup.same && lg.dup.who==='mine' && lg.dup.scale===180, JSON.stringify(lg.dup));
ok('说得出内嵌的图占多少字节', lg.bytes>0, String(lg.bytes));

// ---- 挂到会话上，看真页面 ----
const ids = await page.evaluate(async (skinId) => {
  const db=await import('/src/system/db/index.js');
  const skin=await import('/src/system/skin.js');
  const c=db.characters.create({ name:'阿岚' });
  const chat=db.chats.create({ characterIds:[c.id], lastMessageAt:Date.now() });
  db.messages.create({ chatId:chat.id, role:'char', kind:'text', content:'一条角色的', status:'done' });
  db.messages.create({ chatId:chat.id, role:'user', kind:'text', content:'一条我的', status:'done' });
  skin.update(skinId, { frameWho:'char' });
  skin.attach(chat.id, skinId);
  return { chatId:chat.id, skinId };
}, lg.id);
await page.evaluate(async ({chatId}) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/chat/${chatId}`);
}, ids);
await page.waitForSelector('.msg-face'); await page.waitForTimeout(900);
const live = await page.evaluate(() => {
  const node = document.getElementById('skin-css');
  const faces = [...document.querySelectorAll('.msg-face')];
  const read = el => {
    const cs = getComputedStyle(el, '::after');
    return { bg: cs.backgroundImage, w: cs.width, pos: getComputedStyle(el).position };
  };
  const mine = faces.find(f => f.closest('.msg')?.classList.contains('is-mine'));
  const theirs = faces.find(f => !f.closest('.msg')?.classList.contains('is-mine'));
  return { hasNode: !!node, mine: mine?read(mine):null, theirs: theirs?read(theirs):null };
});
ok('会话页真的注入了这一段', live.hasNode, JSON.stringify(live).slice(0,160));
ok('角色的头像戴上了框', /^url\("data:image/.test(live.theirs?.bg || ''), JSON.stringify(live.theirs));
ok('框按百分比放大了', parseFloat(live.theirs?.w) > 36, JSON.stringify(live.theirs));
ok('头像那个盒子被定位了', live.theirs?.pos==='relative', JSON.stringify(live.theirs));
ok('选了「仅角色」，我的头像不戴',
  !live.mine || live.mine.bg==='none', JSON.stringify(live.mine));

// ---- 搬家：老字段进生成器，老入口没了 ----
await page.evaluate(async ({chatId}) => {
  const n=await import('/src/system/nav.js'); n.push(`/skin/${chatId}`);
}, ids);
await page.waitForTimeout(900);
let t = await page.locator('.page').last().innerText();
ok('会话的美化页不再有头像框的开关', !/谁戴这个框/.test(t), t.slice(0,300));
ok('会话的美化页指路到生成器', /头像框.*在「美化」的生成器/.test(t), t.slice(0,400));

const moved = await page.evaluate(async (skinId) => {
  const skin=await import('/src/system/skin.js');
  // 造一份老数据：三个老字段，没有 gen
  skin.update(skinId, { gen: {}, frameWho: 'char', frameScale: 210 });
  const before = skin.get(skinId);
  const n = skin.migrateFrames();
  const after = skin.get(skinId);
  return { n, hadFrame: !!before.frame,
    frame: after.frame, theirs: !!after.gen?.avatar?.frameTheirs,
    mine: !!after.gen?.avatar?.frameMine, scale: after.gen?.avatar?.frameScale,
    css: skin.compile(after), again: skin.migrateFrames() };
}, ids.skinId);
ok('搬过去了', moved.n >= 1 && moved.theirs, JSON.stringify(moved).slice(0,200));
ok('老字段清空，不会两处各画一个框', moved.frame === '', String(moved.frame));
ok('「戴给谁」跟着搬：只给角色，就只给角色',
  moved.theirs && !moved.mine, JSON.stringify([moved.theirs, moved.mine]));
ok('大小也跟着搬', moved.scale === 210, String(moved.scale));
ok('搬完那张框仍然画得出来',
  /\.ph-msg-theirs \.ph-face::after/.test(moved.css), moved.css.slice(0,200));
ok('再搬一次什么也不做', moved.again === 0, String(moved.again));

await page.screenshot({path:`${OUT}/frame.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
