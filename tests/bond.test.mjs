// 批 8c 记忆分层：关系底色常驻、召回下沉到对话、换标签换措辞、核心设定自动生成
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

const bodies=[];
const BOND='两人从网友走到恋人。\n中间有过一次断联，是她先回来的。\n有一个还没兑现的约定。';
const CORE='说话简短，不解释。\n被追问时回避。';
await page.route('**/v1/chat/completions', async r => {
  const body=JSON.parse(r.request().postData()||'{}');
  bodies.push(body);
  const sys=body.messages.find(m=>m.role==='system')?.content||'';
  let content='嗯';
  // 任务模板正文已经全部改成英文（第 14 条），照现在的措辞认
  if (sys.includes('statement of where the two people stand')) content=BOND;
  else if (sys.includes('the few points the character must')) content=CORE;
  await r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content}}]})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 底色：签名、失效判定、手写锁 ----
const b = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const bond=await import('/src/system/bond.js');
  const svc=await import('/src/system/ai/services.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:`${BASE}/v1`,apiKey:'k',model:'m'});

  const me=acc.current();
  const c=db.characters.create({ name:'阿岚', persona:'美院三年级。' });
  const chat=db.chats.create({ characterIds:[c.id], personaId:me.id });

  ok('一开始没有底色', bond.textOf(db.characters.get(c.id), me.id)==='');
  ok('没有 S 级记忆时不算过期', !bond.stale(c.id, me.id));

  const s1=db.memories.create({ charId:c.id, personaId:me.id, rank:'S', category:'relation',
    content:'两人确认了关系', keywords:[] });
  ok('有了 S 级就算过期，该压一遍', bond.stale(c.id, me.id));
  ok('来源里就是那一条', bond.sourceOf(c.id, me.id).length===1);

  // A 级不算来源
  db.memories.create({ charId:c.id, personaId:me.id, rank:'A', category:'fact',
    content:'她是美院的', keywords:[] });
  ok('A 级不进来源', bond.sourceOf(c.id, me.id).length===1);

  const sig1=bond.signature(c.id, me.id);
  await bond.refresh(c.id, me.id);
  const t1=bond.textOf(db.characters.get(c.id), me.id);
  ok('压出来了', t1.includes('网友走到恋人'), t1.slice(0,40));
  ok('压完就不算过期了', !bond.stale(c.id, me.id));

  // 再加一条 S，签名变，又该压
  db.memories.create({ charId:c.id, personaId:me.id, rank:'S', category:'relation',
    content:'吵了一架，冷战三天', keywords:[] });
  ok('加一条就又过期了', bond.stale(c.id, me.id));
  ok('签名跟着变了', bond.signature(c.id, me.id)!==sig1);

  // 改一条 S 的内容，签名也要变
  await bond.refresh(c.id, me.id);
  const sig2=bond.signature(c.id, me.id);
  db.memories.update(s1.id, { content:'两人确认了关系（更新）' });
  ok('改内容签名也变', bond.signature(c.id, me.id)!==sig2);
  ok('改内容也算过期', bond.stale(c.id, me.id));

  // 删一条也要变
  await bond.refresh(c.id, me.id);
  const sig3=bond.signature(c.id, me.id);
  db.memories.remove(s1.id);
  ok('删一条签名也变', bond.signature(c.id, me.id)!==sig3);

  // 手写之后不再被自动覆盖
  bond.set(c.id, me.id, '我自己写的底色');
  ok('手写存下来了', bond.textOf(db.characters.get(c.id), me.id)==='我自己写的底色');
  ok('手写之后不算过期', !bond.stale(c.id, me.id));
  db.memories.create({ charId:c.id, personaId:me.id, rank:'S', category:'relation',
    content:'又发生了一件大事', keywords:[] });
  ok('手写之后加 S 级也不自动覆盖', !bond.stale(c.id, me.id));
  await bond.refresh(c.id, me.id);
  ok('自动那条路确实没动它', bond.textOf(db.characters.get(c.id), me.id)==='我自己写的底色');
  await bond.refresh(c.id, me.id, { force:true });
  ok('强制生成能覆盖', bond.textOf(db.characters.get(c.id), me.id).includes('网友走到恋人'));
  bond.set(c.id, me.id, '手写的');
  bond.unlock(c.id, me.id);
  ok('交回自动之后又算过期', bond.stale(c.id, me.id));

  // 按根账号分开存
  const alt=acc.createRoot({ name:'另一个我' });
  ok('另一个大号那边是空的', bond.textOf(db.characters.get(c.id), alt.id)==='',
    bond.textOf(db.characters.get(c.id), alt.id));
  bond.set(c.id, alt.id, '另一段关系');
  ok('两边互不干扰',
    bond.textOf(db.characters.get(c.id), me.id)==='手写的'
    && bond.textOf(db.characters.get(c.id), alt.id)==='另一段关系');

  bond.set(c.id, me.id, '两人从网友走到恋人。');
  return { R, chatId:chat.id, charId:c.id };
});
b.R.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 注入：底色在 system，召回在对话里 ----
const inj = await page.evaluate(async ({chatId,charId}) => {
  const db=await import('/src/system/db/index.js');
  const eng=await import('/src/system/ai/engine.js');
  const mem=await import('/src/system/ai/context/memory.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const chat=db.chats.get(chatId), char=db.characters.get(charId);
  for (let i=1;i<=4;i++) {
    db.messages.create({ chatId, role:i%2?'user':'char', authorId:i%2?'me':charId,
      kind:'text', content:`第${i}条`, status:'done' });
  }
  const msgs=db.messagesOf(chatId);
  // 老用户的注入顺序里没有 bond，迁移 5 把它挪到角色卡前面
  const { MIGRATIONS } = await import('/src/system/db/schema.js');
  MIGRATIONS[5]({ settings: db.settings });
  const { system } = eng.buildChatSystem(chat, char, msgs);

  ok('底色进了 system', system.includes('[你们之间的关系]') && system.includes('网友走到恋人'), system.slice(0,200));
  ok('底色排在角色卡之前',
    system.indexOf('[你们之间的关系]') < system.indexOf('[你是谁]'), '');
  ok('S 级那几条没有逐条注入', !system.includes('吵了一架，冷战三天'), '');
  ok('旧的那句「请自然地运用这些信息」没了', !system.includes('请自然地运用'), '');

  // 召回：默认深度 1，插在对话里
  ok('默认深度是 1', mem.depthOf(db.settings.get())===1, mem.depthOf(db.settings.get()));
  const recall=mem.recall({ settings: db.settings.get(), char, scanText:'美院',
    budgets:{ memory: 2000 }, queryVec:null, persona: db.personas.get(chat.personaId) });
  ok('召回里有 A 级', recall.some(m=>m.content.includes('美院')), JSON.stringify(recall.map(m=>m.content)));
  ok('召回里没有 S 级', !recall.some(m=>m.rank==='S'), JSON.stringify(recall.filter(m=>m.rank==='S').map(m=>m.content)));

  const text=mem.recallText(recall);
  ok('抬头写明这几条只是候选',
    text.includes('for reference') && text.includes('Ignore any that'), text.slice(0,160));
  ok('抬头写明冲突时以日期新的为准',
    text.includes('the one with the later date is current'), text.slice(0,200));
  // 「像刚好回忆起那样自然引入」是在替角色决定怎么用这几条，已经删掉（第 16 条）
  ok('不教它怎么把记忆说出口', !/像刚好回忆起那样|naturally|as if you just remembered/.test(text), text);
  // 类别 id 那一段撤了：模型不知道拿 pattern 该怎么办，它占位置却不改变行为。
  // 类别改成按性质分栏，行里只留日期与「多久以前」
  ok('不再有等级字母，也不再有类别 id', !/【/.test(text) && !/\bfact\b/.test(text), text);
  ok('按性质分栏', /Always true:/.test(text), text);
  ok('每一行带日期与多久以前', /- \d{4}-\d{2}-\d{2} \(/.test(text),
    text.split('\n').filter(l => l.startsWith('- '))[0]);
  ok('不再出现 S/A/B 这种等级字母', !/\[[SABC]\//.test(text), text);

  const hist=eng.buildHistory(chat, char, msgs, { recall });
  const at=hist.findIndex(m=>String(m.content).includes('[相关记忆]'));
  ok('召回插进了对话', at>=0, String(at));
  ok('插在最后一条之前', at===hist.length-2, `${at} / ${hist.length}`);
  ok('以 system 身份插入', hist[at]?.role==='system');
  ok('system 里就不再重复一份', !system.includes('[相关记忆]'));

  // 深度填 0 就回到设定区
  db.settings.set({ memoryDepth: 0 });
  const s2=eng.buildChatSystem(chat, char, msgs, { recall }).system;
  ok('填 0 就回到设定区', s2.includes('[相关记忆]'), '');
  const h2=eng.buildHistory(chat, char, msgs, { recall });
  ok('这时对话里就没有了', !h2.some(m=>String(m.content).includes('[相关记忆]')));
  db.settings.set({ memoryDepth: 1 });

  // 记忆整项关掉
  db.settings.set({ memoryEnabled: false });
  ok('记忆关掉就不召回', mem.recall({ settings: db.settings.get(), char, scanText:'美院',
    budgets:{memory:2000}, queryVec:null, persona:null }).length===0);
  db.settings.set({ memoryEnabled: true });
  return R;
}, b);
inj.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 世界书与记忆同时按深度插，互不干扰 ----
const both = await page.evaluate(async ({chatId,charId}) => {
  const db=await import('/src/system/db/index.js');
  const eng=await import('/src/system/ai/engine.js');
  const mem=await import('/src/system/ai/context/memory.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const chat=db.chats.get(chatId), char=db.characters.get(charId);
  db.lorebooks.create({ name:'深度书', global:true, entries:[
    { id:'d1', content:'不许提起那场火。', enabled:true, constant:true, keys:[],
      part:'after', depth:1, priority:100, probability:100 },
  ]});
  const msgs=db.messagesOf(chatId);
  const lore=(await import('/src/system/ai/context/lorebook.js')).activate(char,'',4000).items;
  const recall=mem.recall({ settings: db.settings.get(), char, scanText:'美院',
    budgets:{memory:2000}, queryVec:null, persona: db.personas.get(chat.personaId) });
  const hist=eng.buildHistory(chat, char, msgs, { lore, recall });
  const at=hist.findIndex(m=>String(m.content).includes('[相关记忆]'));
  ok('同一深度里两样都在', at>=0 && hist[at].content.includes('不许提起那场火'), hist[at]?.content?.slice(0,80));
  ok('世界书那段还带着自己的抬头', hist[at].content.includes('[世界设定]'));
  ok('记忆那段也带着自己的抬头', hist[at].content.includes('[相关记忆]'));
  ok('两段没有粘在一起', hist[at].content.includes('\n\n'));
  return R;
}, b);
both.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 核心设定自动生成 ----
const core = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const card=await import('/src/system/ai/tasks/card.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const out=await card.makeCore('林晓，二十二岁，美术学院三年级。说话略带漫不经心，熟悉后会突然认真。');
  ok('压出了核心设定', out.includes('说话简短'), out);
  ok('空人设不调接口', (await card.makeCore(''))==='');
  return R;
});
core.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 抽取模板里的 S 级定义 ----
const tpl = await page.evaluate(async () => {
  const t=(await import('/src/system/ai/templates.js')).DEFAULT_TEMPLATES;
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const ex=t['task.memory-extract'];
  ok('S 级定义收紧成关系转折',
    ex.includes('S is only for major turning points in the relationship'), ex.slice(0,80));
  ok('明说了日常事实不给 S',
    ex.includes('Everyday facts, preferences, and habits never take S'), '');
  ok('B 级仍然要求关键词', ex.includes('A B entry must have keywords'));
  ok('底色模板要求写现状而非复述',
    t['task.bond'].includes('Describe the present state rather than retelling'), '');
  ok('底色模板限了行数', t['task.bond'].includes('Three to five lines'));
  ok('核心设定模板只留影响说话的内容',
    t['task.core'].includes('directly shapes how they speak'), '');
  return R;
});
tpl.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async ({chatId}) => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat',`/bond/${chatId}`);
}, b);
await page.waitForTimeout(700);
const ui = await page.locator('.app-layer').innerText();
ok('关系底色页打得开', ui.includes('关系底色'), ui.slice(0,100));
ok('说明写了它每轮都注入', ui.includes('每轮都会注入'), ui.slice(0,300));
ok('说明写了 S 级不再逐条注入', ui.includes('不再逐条注入'), ui.slice(0,400));
ok('列出了来源记忆', ui.includes('来源'), ui.slice(0,600));
ok('有重新生成', ui.includes('重新生成'));
await page.screenshot({path:`${OUT}/bond-page.png`});

await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('settings','/limits');
});
await page.waitForTimeout(600);
const lim = await page.locator('.app-layer').innerText();
ok('用量页有自动生成底色的开关', lim.includes('自动生成关系底色'), lim.slice(0,400));
ok('用量页有核心设定的开关', lim.includes('导入角色卡时生成核心设定'));
ok('用量页有注入深度', lim.includes('本轮相关记忆的注入深度'));
ok('说明写清了填 0 的代价', lim.includes('缓存会在每轮失效'), lim.slice(0,900));

await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('memory','/');
});
await page.waitForTimeout(600);
const memUi = await page.locator('.app-layer').innerText();
ok('记忆页说明改了', memUi.includes('关系底色'), memUi.slice(0,400));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
