// 气泡上的时刻与已读回执：默认不出现，开了才画；绝大多数已读是推出来的
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

const REPLY='看到了';
const sse=[...REPLY].map(ch=>`data: ${JSON.stringify({choices:[{delta:{content:ch}}]})}\n\n`).join('')+'data: [DONE]\n\n';
await page.route('**/v1/chat/completions', async r => {
  const body=JSON.parse(r.request().postData()||'{}');
  if (body.stream) return r.fulfill({status:200,contentType:'text/event-stream; charset=utf-8',body:sse});
  return r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content:REPLY}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:`${BASE}/v1`,apiKey:'k',model:'m'});
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id]});
  const now=Date.now();
  const mk=(role,content,ago)=>db.messages.create({chatId:chat.id,role,
    authorId:role==='user'?'me':c.id,kind:'text',content,status:'done',createdAt:now-ago}).id;
  const u1=mk('user','前天说的',5000);
  const a1=mk('char','那时候回过',4000);
  const u2=mk('user','刚发的一条',3000);
  const u3=mk('user','再补一句',2000);
  return { charId:c.id, chatId:chat.id, u1, a1, u2, u3, now };
});

// ---- 算出来的那一半 ----
const unit = await page.evaluate(async (ids) => {
  const db=await import('/src/system/db/index.js');
  const rc=await import('/src/system/receipt.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:String(e??'')});
  const at=id=>db.messages.get(id);

  ok('默认按间隔显示时刻', rc.stampMode()==='gap', rc.stampMode());
  ok('默认不显示回执', rc.on()===false, rc.on());

  const t=new Date(); t.setHours(14,5,0,0);
  ok('当天只写时分', rc.stampOf(t.getTime())==='14:05', rc.stampOf(t.getTime()));
  const y=new Date(t.getTime()-24*3600*1000);
  ok('隔天带上日期', rc.stampOf(y.getTime())===`${y.getMonth()+1}月${y.getDate()}日 14:05`,
    rc.stampOf(y.getTime()));
  ok('没有时刻就不写', rc.stampOf(0)==='' && rc.stampOf(undefined)==='');

  ok('读到的那条线是最后一条角色消息', rc.readUpTo(ids.chatId)===at(ids.a1).createdAt,
    `${rc.readUpTo(ids.chatId)} vs ${at(ids.a1).createdAt}`);

  const n=rc.markRead(ids.chatId);
  ok('只标最后一条角色消息之后的那两条', n===2, String(n));
  ok('更早的那条一个字没写进去', !at(ids.u1).readAt, at(ids.u1).readAt);
  ok('悬着的两条都标上了', !!at(ids.u2).readAt && !!at(ids.u3).readAt);
  const keep=at(ids.u2).readAt;
  await new Promise(r=>setTimeout(r,5));
  ok('再标一次一条都不动', rc.markRead(ids.chatId)===0 && at(ids.u2).readAt===keep);

  db.settings.set({ msgRead:false });
  ok('回执关着时什么都不写', rc.textOf(at(ids.u2), rc.readUpTo(ids.chatId))==='');
  db.settings.set({ msgRead:true });
  const line=rc.readUpTo(ids.chatId);
  ok('库里没存 readAt 的那条也是已读，靠推', rc.textOf(at(ids.u1), line)==='已读',
    rc.textOf(at(ids.u1), line));
  ok('角色发的那些不算回执', rc.textOf(at(ids.a1), line)==='');

  // 悬着、还没人动笔的那条
  const u4=db.messages.create({chatId:ids.chatId,role:'user',authorId:'me',kind:'text',
    content:'这条还没人看',status:'done'});
  ok('角色没动笔就是未读', rc.textOf(u4, rc.readUpTo(ids.chatId))==='未读',
    rc.textOf(u4, rc.readUpTo(ids.chatId)));
  db.messages.remove(u4.id);
  db.settings.set({ msgRead:false, msgStamp:'off' });
  return R;
}, ids);
unit.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 打点在引擎里，不在界面里 ----
const eng = await page.evaluate(async (ids) => {
  const db=await import('/src/system/db/index.js');
  const engine=await import('/src/system/ai/engine.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:String(e??'')});
  const c=db.characters.create({name:'另一个'});
  const chat=db.chats.create({characterIds:[c.id]});
  const u=db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',
    content:'在吗',status:'done'});
  ok('刚发出去时还没有 readAt', !db.messages.get(u.id).readAt);
  const t0=Date.now();
  const text=await engine.streamReply({ chat:db.chats.get(chat.id), char:db.characters.get(c.id) });
  ok('回复拿到了', text.includes('看到'), text);
  const got=db.messages.get(u.id).readAt;
  ok('角色动笔那一瞬就标上了', !!got && got>=t0 && got<=Date.now(), String(got));
  return R;
}, ids);
eng.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 画出来的那一半 ----
const open = async id => {
  await page.evaluate(async ({ id }) => {
    const nav = await import('/src/system/nav.js');
    nav.popToRoot(); nav.goHome(); nav.openApp('chat', `/chat/${id}`);
  }, { id });
  await page.waitForSelector('.composer-bar', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
};
const setS = p => page.evaluate(async p => {
  const db=await import('/src/system/db/index.js'); db.settings.set(p);
}, p);

await open(ids.chatId);
ok('默认一个 .msg-meta 都不画', await page.locator('.msg-meta').count()===0);

await setS({ msgStamp:'side', msgRead:true });
await page.waitForTimeout(300);
const side = await page.evaluate(() => ({
  aside: document.querySelectorAll('.msg-meta.at-side').length,
  inCol: document.querySelectorAll('.msg-col .msg-meta').length,
  marked: document.querySelectorAll('.msg.has-aside').length,
  stamp: document.querySelector('.msg-stamp')?.textContent || '',
  reads: [...document.querySelectorAll('.msg-read')].map(e=>e.textContent),
  colW: getComputedStyle(document.querySelector('.msg-col')).maxWidth,
}));
ok('靠着气泡那一档画出来了', side.aside>=4, JSON.stringify(side));
ok('靠着气泡那一档在气泡列外面', side.inCol===0, String(side.inCol));
ok('挂了让位的记号', side.marked>=4, String(side.marked));
ok('时刻是时分', /^\d\d:\d\d$/.test(side.stamp), side.stamp);
ok('自己发的三条都写了回执', side.reads.length===3 && side.reads.every(t=>t==='已读'),
  JSON.stringify(side.reads));
ok('让位之后气泡列窄了一点', side.colW==='62%', side.colW);

await setS({ msgStamp:'below' });
await page.waitForTimeout(300);
const below = await page.evaluate(() => ({
  inCol: document.querySelectorAll('.msg-col .msg-meta.at-below').length,
  outside: document.querySelectorAll('.msg > .msg-meta').length,
  marked: document.querySelectorAll('.msg.has-aside').length,
}));
ok('气泡下方那一档在气泡列里面', below.inCol>=4, JSON.stringify(below));
ok('气泡下方那一档不再占旁边的位置', below.outside===0 && below.marked===0, JSON.stringify(below));

await setS({ msgStamp:'off' });
await page.waitForTimeout(300);
const only = await page.evaluate(() => ({
  meta: document.querySelectorAll('.msg-meta').length,
  stamp: document.querySelectorAll('.msg-stamp').length,
  side: document.querySelectorAll('.msg-meta.at-side').length,
}));
ok('时刻关了只剩回执，落在气泡旁边', only.meta===3 && only.stamp===0 && only.side===3,
  JSON.stringify(only));

await setS({ msgRead:false });
await page.waitForTimeout(300);
ok('两样都关回去就干干净净', await page.locator('.msg-meta').count()===0);

// ---- 美化页那一组开关 ----
await page.evaluate(async ({ id }) => {
  const nav = await import('/src/system/nav.js');
  nav.popToRoot(); nav.goHome(); nav.openApp('chat', `/skin/${id}`);
}, { id: ids.chatId });
await page.waitForTimeout(600);
const sk = await page.evaluate(() => ({
  title: document.querySelector('.navbar')?.textContent || '',
  body: document.body.innerText,
}));
ok('美化页里有那一组开关', /消息时刻/.test(sk.body) && /显示已读回执/.test(sk.body),
  sk.body.slice(0,200));
ok('写清楚了对所有会话生效', /所有会话生效/.test(sk.body));

await page.screenshot({ path:`${OUT}/rc-skin.png` });
await setS({ msgStamp:'side', msgRead:true });
await open(ids.chatId);
await page.screenshot({ path:`${OUT}/rc-side.png` });
await setS({ msgStamp:'below' });
await page.waitForTimeout(300);
await page.screenshot({ path:`${OUT}/rc-below.png` });
await setS({ msgStamp:'off', msgRead:false });

ok('没有页面错误', errs.length===0, errs[0]);
const bad=R.filter(r=>!r.pass).length;
console.log(bad? `\n${bad} 项挂` : `\n全部通过（${R.length} 项）`);
await browser.close();
process.exit(bad?1:0);
