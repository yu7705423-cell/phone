// 我们：长篇与番外。正文那一套复用线下的，差别在设定、身份与谁执笔
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const cons=[]; page.on('console',m=>{ if (m.type()==='error') cons.push(m.text()); });
const sent=[];
const REPLY='雨还没停。\n「你来得比我想的早。」他没有抬头。';
const sse=[...REPLY].map(ch=>`data: ${JSON.stringify({choices:[{delta:{content:ch}}]})}\n\n`).join('')+'data: [DONE]\n\n';
await page.route('**/*', async r => {
  const u=r.request().url();
  if (/chat\/completions/.test(u)) {
    const body=JSON.parse(r.request().postData()||'{}');
    sent.push(body);
    if (body.stream) return r.fulfill({status:200,contentType:'text/event-stream',body:sse});
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'压成一段：他们在车站见面。'}}]})});
  }
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};
const shot = n => page.screenshot({ path:`${OUT}/us-${n}.png` });
const text = () => page.evaluate(()=>document.body.innerText);
const go = async r => {
  await page.evaluate(async r => {
    const nav=await import('/src/system/nav.js');
    nav.goHome(); nav.openApp('us', '/'); nav.popToRoot();
    if (r !== '/') nav.push(r);
  }, r);
  await page.waitForTimeout(450);
};

await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:`${BASE}/v1`,apiKey:'k',model:'m'});
  const c=db.characters.create({name:'阿岚',persona:'二十二岁，美术学院三年级。'});
  const chat=db.chats.create({characterIds:[c.id],lastMessageAt:Date.now()});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'我在楼下了',status:'done'});
  db.memories.create({charId:c.id,content:'用户害怕打雷',category:'fact',rank:'A',keywords:['雷']});
  return { charId:c.id, chatId:chat.id };
});

// ---- 首页与新建 ----
await go('/');
// 等首屏真的画出来再读文字。不等的话偶尔读到空串，是测试自己的竞态
await page.waitForSelector('.navbar', { timeout: 5000 });
await page.waitForTimeout(300);
await shot('empty');
ok('空状态写明了两种体裁', /长篇/.test(await text()) && /番外/.test(await text()), (await text()).slice(0,160));
await page.locator('button', { hasText:'新建一部' }).first().click(); await page.waitForTimeout(400);
await shot('new');
const form = await text();
ok('新建表单出来了', /体裁/.test(form) && /标题/.test(form), form.slice(0,200));
// 切到长篇，身份那几栏才出现
await page.locator('.seg-item, .segmented > *', { hasText:'长篇' }).first().click().catch(async()=>{
  await page.locator('button', { hasText:'长篇' }).first().click();
});
await page.waitForTimeout(300);
await shot('new-saga');
const saga = await text();
ok('长篇才有身份那几栏', /主线/.test(saga) && /在这部作品里的名字/.test(saga), saga.slice(0,300));
ok('长篇才有「带上原来的记忆」那个开关', /带上原来的记忆/.test(saga));

// 直接用 api 建，界面那条路已经验过表单在
const built = await page.evaluate(async ({chatId, charId}) => {
  const work=await import('/src/system/work.js');
  const saga=work.create({ chatId, kind: work.SAGA, title:'雨落之前',
    premise:'两个人在另一座城市重新认识。',
    charAs:{ name:'沈砚', persona:'旧书店的老板，话少。' },
    meAs:{ name:'林一', persona:'刚搬来的房客。' },
    carry:false, solo:false, opening:'me' });
  const extra=work.create({ chatId, kind: work.EXTRA, title:'如果那天没下雨',
    premise:'把那天重演一遍。', carry:false, solo:true, opening:'me' });
  const c1=work.addChapter(saga.id, { title:'到站', place:'车站' });
  const c2=work.addChapter(saga.id, { title:'旧书店' });
  const e1=work.addChapter(extra.id);
  return { saga:saga.id, extra:extra.id, c1:c1.id, c2:c2.id, e1:e1.id,
    extraCarry: work.get(extra.id).carry, extraSolo: work.get(extra.id).solo };
}, ids);
ok('番外一律带原来的记忆，那个开关不给它', built.extraCarry===true, built.extraCarry);
ok('番外也能整篇它写', built.extraSolo===true);

// 「让它开场」那一档：新建一篇之后自己就写了第一段
const auto = await page.evaluate(async ({chatId}) => {
  const work=await import('/src/system/work.js');
  const w=work.create({ chatId, kind: work.EXTRA, title:'自动开场', opening:'char' });
  const c=work.addChapter(w.id);
  return { workId:w.id, chapterId:c.id, opening:c.opening };
}, ids);
ok('新的一篇跟着作品定的那一档走', auto.opening==='char', auto.opening);
await go(`/read/${auto.chapterId}`);
await page.waitForTimeout(2800);
const autoBeats = await page.evaluate(async ({chapterId}) => {
  const scene=await import('/src/system/scene.js');
  return scene.beatsOf(chapterId).length;
}, auto);
ok('「让它开场」时进来就写了一段，而且只写一段', autoBeats===1, autoBeats);
await page.evaluate(async ({workId}) => {
  const work=await import('/src/system/work.js'); work.remove(workId);
}, auto);

await go('/');
await shot('home');
const home = await text();
ok('首页分了长篇与番外两段', /长篇 · 1/.test(home) && /番外 · 1/.test(home), home.replace(/\n+/g,' / ').slice(0,200));
ok('首页写了作品里的角色', /阿岚/.test(home), home.slice(0,200));

// ---- 目录 ----
await go(`/work/${built.saga}`);
await shot('toc');
const toc = await text();
ok('目录按章排', /第 1 章　到站/.test(toc) && /第 2 章　旧书店/.test(toc), toc.replace(/\n+/g,' / ').slice(0,260));
ok('目录上写了这一部怎么写', /不带原来的记忆/.test(toc), toc.slice(0,200));
// 上下移
await page.locator('[aria-label="下移"]').first().click(); await page.waitForTimeout(300);
const moved = await page.evaluate(async ({saga}) => {
  const work=await import('/src/system/work.js');
  return work.chaptersOf(saga).map(c=>c.title);
}, built);
ok('章能上下挪', moved[0]==='旧书店' && moved[1]==='到站', JSON.stringify(moved));
await page.locator('[aria-label="上移"]').first().click().catch(()=>{});
await page.waitForTimeout(300);

// ---- 正文：让它写一段 ----
await go(`/read/${built.c1}`);
await page.waitForTimeout(600);
await shot('read-empty');
ok('正文页开着', /写一段/.test(await text()), (await text()).slice(0,160));
sent.length=0;
await page.locator('[aria-label^="让"]').first().click();
await page.waitForTimeout(2500);
await shot('read-written');
const beats = await page.evaluate(async ({c1}) => {
  const scene=await import('/src/system/scene.js');
  return scene.beatsOf(c1).map(b=>[b.role,(b.text||'').slice(0,12)]);
}, built);
ok('一段落进去了', beats.length===1 && beats[0][0]==='char' && /雨还没停/.test(beats[0][1]), JSON.stringify(beats));
ok('正文画在页面上', /雨还没停/.test(await text()), (await text()).slice(0,200));

// ---- 提示词：新身份、主线、不带原来的记忆 ----
const sys = sent[0]?.messages?.find(m=>m.role==='system')?.content || sent[0]?.system || '';
const sysText = typeof sys === 'string' ? sys : JSON.stringify(sys);
ok('开场用的是新名字', /You are 沈砚/.test(sysText), sysText.slice(0,120));
ok('带上了这部作品的主线', /另一座城市重新认识/.test(sysText));
ok('带上了换过的身份', /在这部作品里是「沈砚」/.test(sysText) && /在这部作品里是「林一」/.test(sysText), sysText.slice(0,400));
ok('不带原来的记忆时，记忆一条都不注入', !/害怕打雷/.test(sysText));
ok('不带原来的记忆时，聊天记录也不注入', !/我在楼下了/.test(JSON.stringify(sent[0])));
ok('这一篇的事实进去了', /第 1 章/.test(sysText) && /车站/.test(sysText), sysText.slice(0,400));
ok('轮流写那一档写明了不要替我写', /Never write 林一's/.test(sysText), sysText.slice(-300));

// ---- 带上原来的记忆那一档 ----
await page.evaluate(async ({saga}) => {
  const work=await import('/src/system/work.js');
  work.update(saga, { carry: true });
}, built);
sent.length=0;
await page.locator('[aria-label^="让"]').first().click();
await page.waitForTimeout(2500);
const sys2 = JSON.stringify(sent[0] || {});
ok('开着时记忆就进来了', /害怕打雷/.test(sys2), sys2.slice(0,200));

// ---- 整篇它写那一档 ----
await page.evaluate(async ({saga}) => {
  const work=await import('/src/system/work.js');
  work.update(saga, { solo: true, carry: false });
}, built);
sent.length=0;
await page.locator('[aria-label^="让"]').first().click();
await page.waitForTimeout(2500);
const sys3 = JSON.stringify(sent[0] || {});
ok('整篇它写时允许写所有人', /Write everyone in the story/.test(sys3), sys3.slice(0,200));
ok('整篇它写时不再提醒「不要写我」', !/Never write 林一/.test(sys3));

// ---- 前面几章的进展 ----
await page.evaluate(async ({c1}) => {
  const db=await import('/src/system/db/index.js');
  db.chapters.update(c1, { summary: '两个人在车站见了第一面。' });
}, built);
await go(`/read/${built.c2}`);
await page.waitForTimeout(500);
sent.length=0;
await page.locator('[aria-label^="让"]').first().click();
await page.waitForTimeout(2500);
const sys4 = JSON.stringify(sent[0] || {});
ok('后面那一章带上了前面的进展', /车站见了第一面/.test(sys4), sys4.slice(0,300));

// ---- 自己写一段 ----
await page.locator('.sg-write').click(); await page.waitForTimeout(300);
await page.locator('.fullsheet textarea, textarea:visible').first().fill('我把行李放下。');
await page.locator('button', { hasText:'放上去' }).last().click(); await page.waitForTimeout(500);
const mine = await page.evaluate(async ({c2}) => {
  const scene=await import('/src/system/scene.js');
  return scene.beatsOf(c2).map(b=>b.role);
}, built);
ok('自己那一段落进去了', mine.includes('me'), JSON.stringify(mine));

// ---- 收篇：默认关着要给说明 ----
await page.locator('[aria-label="菜单"]').click(); await page.waitForTimeout(400);
await shot('menu');
ok('菜单里有目录、设定与收篇', /目录/.test(await text()) && /收篇/.test(await text()), (await text()).slice(-260));
await page.locator('.list-item', { hasText:'收篇' }).first().click(); await page.waitForTimeout(500);
const ts = await page.evaluate(()=>[...document.querySelectorAll('.toast')].map(t=>t.textContent));
ok('摘要默认关着，给出说明', ts.some(t=>/摘要/.test(t)), JSON.stringify(ts));
// 开了再收一次
await page.evaluate(async()=>{ const db=await import('/src/system/db/index.js'); db.settings.set({ workSummary:true }); });
const got = await page.evaluate(async ({c2}) => {
  const t=await import('/src/system/ai/tasks/work.js');
  const db=await import('/src/system/db/index.js');
  await t.wrap(c2);
  return db.chapters.get(c2).summary;
}, built);
ok('开了之后收篇写回了摘要', /车站见面/.test(got || ''), got);

// ---- 番外：一则直接进正文 ----
await go(`/read/${built.e1}`);
await page.waitForTimeout(500);
await shot('extra');
ok('番外那一则也打得开', !/已停止/.test(await text()) && /写一段/.test(await text()), (await text()).slice(0,140));

// ---- 删作品连着篇与正文 ----
const gone = await page.evaluate(async ({saga, c1, c2}) => {
  const work=await import('/src/system/work.js');
  const db=await import('/src/system/db/index.js');
  work.remove(saga);
  return { work: db.works.has(saga), chapters: db.chapters.byIndex(saga).length,
    beats: db.beats.byIndex(c1).length + db.beats.byIndex(c2).length };
}, built);
ok('删一部连着篇与正文一起走', !gone.work && gone.chapters===0 && gone.beats===0, JSON.stringify(gone));

ok('没有页面错误', errs.length===0, errs[0]);
ok('没有 console.error', cons.length===0, cons[0]);
const bad=R.filter(r=>!r.pass).length;
console.log(bad? `\n${bad} 项挂` : `\n全部通过（${R.length} 项）`);
await browser.close();
process.exit(bad?1:0);
