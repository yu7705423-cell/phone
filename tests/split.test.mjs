// 兜底分条、角色自带示例时让位、自检里的格式那一问
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const sp = await page.evaluate(async () => {
  const reply=await import('/src/system/ai/reply.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const A=reply.autoSplit;

  ok('短的不动', A('就这样',40).join('|')==='就这样');
  ok('填 0 不动', A('一'.repeat(100),0).join('|')==='一'.repeat(100));

  let r=A('我今天去面试了。感觉一般般。晚上想吃火锅吗？',12);
  ok('按句末标点断', r.length===3, JSON.stringify(r));
  ok('句号断完去掉', r[0]==='我今天去面试了', r[0]);
  ok('问号留着', r[2]==='晚上想吃火锅吗？', r[2]);

  r=A('这件事我想了很久其实一直没跟你说，主要是怕你担心，也怕说出来就变味了',20);
  ok('没有句号就按逗号断', r.length>1, JSON.stringify(r));
  ok('断完每条都不算太长', r.every(x=>x.length<=25), JSON.stringify(r.map(x=>x.length)));
  ok('逗号断完也去掉逗号', !r.some(x=>/[，,]$/.test(x)), JSON.stringify(r));

  ok('带标记的整条不碰',
    A('[图片：一只猫] 你看这个真的很像上次那只，那天我们还说过它，记得吗',20).length===1, '');

  ok('一个字都没丢', A('甲乙丙。丁戊己。庚辛壬',6).join('')==='甲乙丙丁戊己庚辛壬', A('甲乙丙。丁戊己。庚辛壬',6).join('|'));

  // 在 splitReply 里生效
  const db=await import('/src/system/db/index.js');
  db.settings.set({ autoSplitAt: 12 });
  let parts=reply.splitReply('我今天去面试了。感觉一般般。晚上想吃火锅吗？');
  ok('splitReply 里也拆开了', parts.length===3, JSON.stringify(parts.map(p=>p.text)));

  // 模型自己分好条的不碰
  parts=reply.splitReply('这一条很长很长很长很长很长很长\n这是第二条');
  ok('已经分好条的不动', parts.length===2, JSON.stringify(parts.map(p=>p.text)));
  ok('分好的那条哪怕超长也不切', parts[0].text==='这一条很长很长很长很长很长很长', parts[0].text);

  db.settings.set({ autoSplitAt: 0 });
  parts=reply.splitReply('我今天去面试了。感觉一般般。晚上想吃火锅吗？');
  ok('填 0 就原样落库', parts.length===1);
  db.settings.set({ autoSplitAt: 40 });
  return R;
});
sp.forEach(r=>ok(r.name,r.pass,r.extra));

// 内置示例与自检那两段已经整个删掉（CLAUDE.md 第 16 条）：示例演示的是
// 「该怎么说话」，自检是逐条的自我要求，两样都在替角色作判断。
// 于是「角色自带示例时内置的让位」这件事也不存在了 —— 没有内置的那一份。
const ex = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const eng=await import('/src/system/ai/engine.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const a=db.characters.create({ name:'没示例', persona:'x' });
  const ca=db.chats.create({ characterIds:[a.id] });
  ok('角色没写示例时，骨架里也没有示例那一段',
    !eng.buildChatSystem(ca,a,[]).system.includes('[示例]'));

  const b=db.characters.create({ name:'有示例', persona:'x',
    exampleDialogue:'「随便吧」「你说了算」' });
  const cb=db.chats.create({ characterIds:[b.id] });
  const sb=eng.buildChatSystem(cb,b,[]).system;
  ok('角色自己写的示例照常注入', sb.includes('你说了算'), sb.slice(0,200));
  ok('内置示例里那两个例子一个都没出现', !sb.includes('吃火锅') && !sb.includes('秤有问题'), '');
  ok('自检那一段也不在了', !sb.includes('[输出前的自检]'), '');
  ok('自检里那几问一句都不剩',
    !/本次回复分成几条发出|写出每一条的首尾|换成另一个角色说是否同样成立|按第 5 条的结论逐条输出/.test(sb), '');
  return R;
});
ex.forEach(r=>ok(r.name,r.pass,r.extra));

// 界面
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat','/context');
});
await page.waitForTimeout(700);
const ui = await page.locator('.app-layer').innerText();
ok('上下文页有兜底分条', ui.includes('兜底分条的长度'), ui.slice(0,600));
ok('说明写了已分好条的不动', ui.includes('已经分好条的不作改动'), ui.slice(0,1000));
ok('说明写了填 0 的含义', ui.includes('模型回什么就显示什么'));
ok('说明写了消息规则只管分条', ui.includes('只规定消息如何分条'), ui.slice(0,1200));
await page.screenshot({path:`${OUT}/split-ctx.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
