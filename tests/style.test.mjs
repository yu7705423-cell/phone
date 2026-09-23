import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const engine=await import('/src/system/ai/engine.js');
  const tpl=await import('/src/system/ai/templates.js');
  const tok=await import('/src/system/ai/tokens.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'嗨',status:'done'});
  const sys = () => engine.buildChatSystem(db.chats.get(chat.id), db.characters.get(c.id), db.messagesOf(chat.id));

  const on = sys().system;
  ok('默认注入了消息规则', on.includes('[消息规则]'));

  // ---- 九章消息规则已经全部删掉 ----
  //
  // 从前这一节分九节（分条、理解与回应、不要整轮都在反驳、关系、语气、
  // 避免固定化、情绪、留白、执行），连同示例与自检一起删了：那些是在替
  // 角色决定怎么做人，不是机器需要的格式规则（CLAUDE.md 第 16 条）。
  // 这几条断言守的是「不要再长回来」—— 已经删过两次。
  ok('九章一节都没剩下',
    !['一、分条','二、理解与回应','三、不要整轮都在反驳','四、关系','五、语气',
      '六、避免固定化','七、情绪','八、留白','九、执行'].some(k => on.includes(k)),
    ['一、分条','二、理解与回应','三、不要整轮都在反驳','四、关系','五、语气',
     '六、避免固定化','七、情绪','八、留白','九、执行'].filter(k => on.includes(k)).join(','));
  ok('旧的自然表达协议整段没了', !on.includes('自然表达协议') && !on.includes('指令一'), '');
  ok('九条指令的正文也一条都不剩',
    !['相同的句式结构','不保持相近的字数','连续以反问开头','不必符合对方的期待',
      '本轮围绕影响最大的那一件展开','换成陌生人说出效果相同','不作总结，不作升华',
      '整体理解','该条暂缓执行'].some(k => on.includes(k)),
    ['相同的句式结构','不保持相近的字数','连续以反问开头','不必符合对方的期待',
     '本轮围绕影响最大的那一件展开','换成陌生人说出效果相同','不作总结，不作升华',
     '整体理解','该条暂缓执行'].filter(k=>on.includes(k)).join(','));

  // 线上聊天的全部规则只剩一条：每轮分 3 到 5 条发出
  const RULES = tpl.DEFAULT_TEMPLATES['skeleton.rules'];
  ok('只剩分几条发这一条',
    RULES.includes('Write each reply as 3 to 5 separate messages'), RULES);
  // 字数预算。check-prompt-tone.mjs 给 skeleton.rules 定的上限是 200 字：
  // 一条格式规则用不了那么多字，超了就说明混进了不是规则的东西
  ok('规则短到装不下判断', RULES.length < 200, `${RULES.length} 字`);
  ok('比原来那一千多少了一个数量级', tok.estimate(RULES) < 60, tok.estimate(RULES));

  // 规则文本不带口语。这一条是用户明确要求的：规则要书面、命令式
  const spoken = ['省得','干脆','反正','本来','那一条','不就是','呗','啦','哦','咯'];
  ok('规则里没有口语词', !spoken.some(w => RULES.includes(w)),
    spoken.filter(w => RULES.includes(w)).join(','));
  ok('规则里没有破折号插入语', !RULES.includes('——'), '');

  // 示例与自检两段连同它们的开关一起删了，消息规则关不掉
  ok('示例整段不在了', !on.includes('[示例]'));
  ok('输出前的自检整段不在了', !on.includes('[输出前的自检]'));
  ok('消息规则始终在', sys().system.includes('[消息规则]'));

  // 用户改过正文之后走改过的那份
  db.settings.set({ promptTemplates: { ...db.settings.get().promptTemplates, 'skeleton.rules': '我自己写的一句' } });
  ok('改过就用改过的',
    sys().system.includes('我自己写的一句') && !sys().system.includes('3 to 5 separate messages'));
  const next = { ...db.settings.get().promptTemplates };
  delete next['skeleton.rules'];
  db.settings.replace({ ...db.settings.get(), promptTemplates: next });
  ok('删掉自定义就回落到内置', sys().system.includes('3 to 5 separate messages'));

  return R;
});

// 界面
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('chat','/context');
});
await page.waitForTimeout(700);
const ctxText = await page.locator('.app-layer').innerText();
out.push({ name:'上下文页说明了三段的分工',
  pass: /消息规则.*不可关闭|不可关闭/.test(ctxText), extra: ctxText.slice(0,200) });
out.push({ name:'上下文页写出了内置规则占多少 token',
  pass: !/输出前的自检/.test(ctxText) && /约 \d{1,4} token/.test(ctxText),
  extra: ctxText.split('\n').slice(0,14).join(' / ') });
await page.screenshot({path:`${OUT}/p1-context.png`});

await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat','/templates');
});
await page.waitForTimeout(700);
const tplText = await page.locator('.app-layer').innerText();
out.push({ name:'模板页里列出了现在这几段',
  pass: ['骨架 · 消息规则','骨架 · 身份开场','骨架 · 性别锚点','骨架 · 核心设定']
    .every(k => tplText.includes(k)),
  extra: ['骨架 · 消息规则','骨架 · 身份开场','骨架 · 性别锚点','骨架 · 核心设定']
    .filter(k => !tplText.includes(k)).join(',') });
out.push({ name:'删掉的那两段不再列在模板页上',
  pass: !tplText.includes('骨架 · 示例') && !tplText.includes('骨架 · 输出前的自检'),
  extra: tplText.slice(0,200) });
out.push({ name:'模板页没有裸露的英文 id', pass: !/skeleton\.|task\./.test(tplText), extra: tplText.match(/(skeleton|task)\.[\w-]+/g)?.join(' ') });
await page.screenshot({path:`${OUT}/p2-templates.png`});

await browser.close();
let bad=0;
for (const r of out) { if(!r.pass) bad++; console.log(`${r.pass?'  ok  ':'  FAIL'} ${r.name}${r.pass?'':'   << '+(r.extra??'')}`); }
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${out.length-bad}/${out.length} 通过`);
process.exit(bad||errs.length?1:0);
