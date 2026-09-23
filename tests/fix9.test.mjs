// 模板不再整套落库、时区写清楚、时差不用早晚、间隔量到上一轮、示例不填真名
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,
  deviceScaleFactor:2, timezoneId:'Asia/Shanghai'});
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 模板：settings 里只存改过的那几条 ----
const t = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const tpl=await import('/src/system/ai/templates.js');
  const { MIGRATIONS } = await import('/src/system/db/schema.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  // 模拟老库：整套模板被抄进 settings，而且是**旧版**的正文
  db.settings.set({ promptTemplates: {
    'skeleton.opening': '你不是AI助手。你不是在扮演角色。你就是{{charName}}。',
    'skeleton.rules': '旧版的消息规则',
    'task.bond': tpl.DEFAULT_TEMPLATES['task.bond'],
  }, promptTemplatesLegacy: undefined });
  ok('老库里读到的是旧的那份', tpl.template('skeleton.opening').includes('你不是AI助手'));

  MIGRATIONS[6]({ settings: db.settings });
  // 骨架正文已经全部改成英文（第 14 条）
  ok('迁移之后读到的是新的',
    tpl.template('skeleton.opening')==='You are {{charName}}. You are texting {{userName}} on a phone.',
    tpl.template('skeleton.opening'));
  ok('「你不是AI助手」彻底没了', !tpl.template('skeleton.opening').includes('你不是AI'));
  ok('消息规则也回到新版',
    tpl.template('skeleton.rules').includes('Write each reply as 3 to 5 separate messages'),
    tpl.template('skeleton.rules'));
  ok('settings 里清空了', Object.keys(db.settings.get().promptTemplates||{}).length===0);
  ok('旧文本没丢，挪进了 legacy',
    db.settings.get().promptTemplatesLegacy['skeleton.opening'].includes('你不是AI助手'));

  // 迁移是幂等的：再跑一遍不会把刚存的自定义又挪走
  db.settings.set({ promptTemplates: { 'skeleton.opening': '我自己写的' } });
  MIGRATIONS[6]({ settings: db.settings });
  ok('再跑一遍会把新写的也收走（这是它该做的）',
    Object.keys(db.settings.get().promptTemplates).length===0);
  ok('收走的进了 legacy', db.settings.get().promptTemplatesLegacy['skeleton.opening']==='我自己写的');

  // 空的时候不动
  const before=JSON.stringify(db.settings.get().promptTemplatesLegacy);
  MIGRATIONS[6]({ settings: db.settings });
  ok('已经空了就不再动 legacy', JSON.stringify(db.settings.get().promptTemplatesLegacy)===before);

  // 改过的仍然生效
  db.settings.set({ promptTemplates: { 'skeleton.opening': '我改的开场' } });
  ok('改过的照样优先', tpl.template('skeleton.opening')==='我改的开场');
  const next={...db.settings.get().promptTemplates}; delete next['skeleton.opening'];
  db.settings.replace({ ...db.settings.get(), promptTemplates: next });
  ok('删掉就回落到内置', tpl.template('skeleton.opening').startsWith('You are {{charName}}'));
  return R;
});
t.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 时间 ----
const tm = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const clock=await import('/src/system/time.js');
  const eng=await import('/src/system/ai/engine.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  // 跟随设备时要解析成真实时区，不能写「本地」
  ok('跟随设备解析成了真实时区', clock.resolveZone('local')==='Asia/Shanghai', clock.resolveZone('local'));
  ok('标签写的是地名不是「本地」',
    clock.zoneLabel('local')==='中国 · 北京、上海', clock.zoneLabel('local'));
  ok('显式填的照旧', clock.zoneLabel('Europe/London')==='英国 · 伦敦');
  ok('表里没有的直接写 IANA 名', clock.zoneLabel('Antarctica/Troll')==='Antarctica/Troll');

  // 一边跟随设备一边显式填同一个时区，不该算出时差
  ok('同一个时区不算时差', clock.zoneDiff('local','Asia/Shanghai')===0, clock.zoneDiff('local','Asia/Shanghai'));
  ok('不同就算得出', clock.zoneDiff('Europe/London','Asia/Shanghai')!==0);

  const me=acc.current();
  db.personas.update(me.id,{name:'阿园'});
  const c=db.characters.create({ name:'阿岚', persona:'x', timezone:'Europe/London' });
  const chat=db.chats.create({ characterIds:[c.id], personaId:me.id });
  const long=Date.now()-3*86400000;
  db.messages.create({ chatId:chat.id, role:'char', authorId:c.id, kind:'text',
    content:'那明天见', status:'done', createdAt:long });
  db.messages.create({ chatId:chat.id, role:'user', authorId:'me', kind:'text',
    content:'在吗', status:'done' });
  db.messages.create({ chatId:chat.id, role:'user', authorId:'me', kind:'text',
    content:'好久没聊了', status:'done' });

  // 时间这一块每分钟都变，已经从设定区搬到对话末尾去了（context/index.js
  // 的 VOLATILE），所以现在要从 volatile 那一段里取
  const sys=eng.buildChatSystem(chat,c,db.messagesOf(chat.id)).volatile;
  const block=sys.slice(sys.indexOf('[现在几点]'), sys.indexOf('[现在几点]')+220);

  // 注进去的句子是英文，地名仍是中文（那是数据，不是指令）
  ok('写了角色在哪个时区', block.includes('You are in 英国 · 伦敦'), block.slice(0,80));
  ok('写了对方在哪个时区',
    block.includes('The other party is in 中国 · 北京、上海'), block.slice(0,160));
  ok('不再出现「本地」', !block.includes('本地'), block.slice(0,160));
  ok('时差不用早晚两个字', !/[早晚]|earlier|later/.test(block), block);
  ok('改成了相差多少', /\d+ hours? from your own clock/.test(block), block);
  ok('两边的钟点都写出来了', /where it is now \d\d:\d\d/.test(block), block);

  // 关键：刚发完两条也不能说「刚刚还在聊」，上一轮是三天前
  ok('间隔量到上一轮，不是最后一条', /3 days have passed/.test(block), block);
  ok('没有误报「刚刚」', !/mid-conversation/.test(block), block);

  // 真的刚聊过就该说正在聊
  db.messages.create({ chatId:chat.id, role:'char', authorId:c.id, kind:'text',
    content:'在的', status:'done' });
  db.messages.create({ chatId:chat.id, role:'user', authorId:'me', kind:'text',
    content:'嗯', status:'done' });
  const sys2=eng.buildChatSystem(chat,c,db.messagesOf(chat.id)).volatile;
  ok('真的刚聊过就说正在聊', sys2.includes('The two of you are mid-conversation'),
    sys2.slice(sys2.indexOf('[现在几点]'), sys2.indexOf('[现在几点]')+220));

  ok('gapText 五分钟内算正在聊',
    clock.gapText(Date.now()-60000)==='The two of you are mid-conversation.');
  ok('超过五分钟就报分钟数', clock.gapText(Date.now()-30*60000).includes('30 minutes'));
  ok('措辞是「上一次说话」',
    clock.gapText(Date.now()-30*60000).includes('since either of you last spoke'));
  return R;
});
tm.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 示例那一段整个删掉了 ----
//
// 从前这里有两段示例对话，为了不让模型把示例里的名字当成真人，还专门
// 改成了代称。整段连同「冲突时的取舍」一起删了（CLAUDE.md 第 16 条）：
// 示例演示的是「该怎么说话」，那是角色卡的事。
const ex = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const eng=await import('/src/system/ai/engine.js');
  const tpl=await import('/src/system/ai/templates.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const c=db.characters.create({ name:'阿岚', persona:'x' });
  const chat=db.chats.create({ characterIds:[c.id] });
  const sys=eng.buildChatSystem(chat,c,[]).system;

  ok('骨架里没有示例那一段', !sys.includes('[示例]'), sys.slice(0,200));
  ok('取舍顺序那一段也没有', !sys.includes('[冲突时的取舍]'));
  ok('示例模板本身也删掉了', !tpl.DEFAULT_TEMPLATES['skeleton.examples'],
    String(tpl.DEFAULT_TEMPLATES['skeleton.examples']).slice(0,60));
  ok('两段示例的正文一句都不剩',
    !sys.includes('我们去哪吃火锅') && !sys.includes('就是秤的问题！'));
  return R;
});
ex.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面：找回升级前的文本 ----
await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  db.settings.set({ promptTemplatesLegacy: { 'skeleton.opening': '升级前的那一版开场' } });
  const nav=await import('/src/system/nav.js'); nav.openApp('chat','/templates');
});
await page.waitForTimeout(700);
await page.locator('.list-item').filter({ hasText:'身份开场' }).first().click();
await page.waitForTimeout(500);
const ui = await page.locator('.app-layer').innerText();
ok('编辑页有「载入升级前的版本」', ui.includes('载入升级前的版本'), ui.slice(0,300));
ok('并说明了它是什么', ui.includes('保留了替换前的文本'), ui.slice(0,400));
await page.locator('button', { hasText:'载入升级前的版本' }).click();
await page.waitForTimeout(400);
const val = await page.locator('textarea').first().inputValue();
ok('点了就载进编辑框', val==='升级前的那一版开场', val.slice(0,40));
await page.screenshot({path:`${OUT}/tpl-legacy.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
