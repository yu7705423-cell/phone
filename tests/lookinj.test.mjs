// 画面描述里点了谁的名字，就把谁的外貌一并发过去 —— 不调接口，默认就开着
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const sent=[];
await ctx.route('**/relay.example.com/**', async r => {
  const u=r.request().url(); const b=r.request().postData()||'';
  sent.push({ u, b });
  if (u.includes('/images/generations')) return r.fulfill({status:200,contentType:'application/json',
    body: JSON.stringify({ data:[{ b64_json: PNG }] })});
  if (u.includes('/v2/video_generation')) return r.fulfill({status:200,contentType:'application/json',
    body: JSON.stringify({ task_id:'t1' })});
  if (u.includes('/chat/completions')) return r.fulfill({status:200,contentType:'application/json',
    body: JSON.stringify({ choices:[{ message:{ content: JSON.stringify({
      name:'乃木绿实', age:'22', gender:'女', birthday:'', signature:'画画的',
      persona:'美院三年级，话少。', appearance:'及肩黑发，眼角有痣。',
      scenario:'', firstMessage:'', exampleDialogue:'' }) } }] })});
  return r.fulfill({status:200,contentType:'application/json',body:'{"task":{"status":"running"}}'});
});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const svc=(await import('/src/system/ai/services.js'));
  const i = svc.newImagePreset({ name:'图' });
  svc.updateImagePreset(i.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'gpt-image-1' });
  svc.setActiveImage(i.id);
  const v = svc.newVideoPreset({ name:'视频' });
  svc.updateVideoPreset(v.id, { baseUrl:'https://relay.example.com', apiKey:'k',
    model:'MiniMax-H3', pollEvery:2, maxWait:20 });
  svc.setActiveVideo(v.id);
  // 主角写了外貌；宠物是另一张卡，也写了外貌
  const her = db.characters.create({ name:'乃木绿实', persona:'一个画画的人。',
    appearance:'及肩黑发，眼角有痣，身形偏瘦，常穿宽大的深色毛衣。' });
  const cat = db.characters.create({ name:'乃木喵',
    appearance:'一只橘白相间的短毛猫，左耳有缺口，眼睛是琥珀色。' });
  const chat = db.chats.create({ characterIds:[her.id], personaId:'me', title:'乃木绿实' });
  return { her: her.id, cat: cat.id, chat: chat.id };
});

// ---- 拼出来的东西 ----
const built = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const ip=(await import('/src/system/ai/imageprompt.js'));
  const her = db.characters.get(o.her);
  return {
    one: ip.compose({ prompt:'乃木绿实在窗边画画', char: her }),
    two: ip.compose({ prompt:'乃木绿实抱着乃木喵', char: her }),
    none: ip.compose({ prompt:'一条空荡荡的街', char: her }),
    explain: ip.explain({ prompt:'乃木绿实抱着乃木喵', char: her }),
  };
}, ids);
ok('点了名的角色，外貌接在后面',
  /及肩黑发/.test(built.one) && built.one.startsWith('乃木绿实在窗边画画'), built.one.slice(0,90));
ok('别的卡（宠物）点到名字也带上',
  /橘白相间/.test(built.two) && /及肩黑发/.test(built.two), built.two.slice(0,140));
ok('没点到名字的一个都不带', !/及肩黑发|橘白相间/.test(built.none), built.none);
ok('抓包里逐段标出来是谁的外貌',
  /「乃木绿实」的外貌/.test(built.explain) && /「乃木喵」的外貌/.test(built.explain),
  built.explain.slice(0,160));
ok('用户写的那句原样保留在最前面，没有被改写',
  built.two.startsWith('乃木绿实抱着乃木喵'), built.two.slice(0,40));

// ---- 真发一张图 ----
await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const r=(await import('/src/system/ai/reply.js'));
  r.materialize({ type:'image', prompt:'乃木绿实抱着乃木喵' },
    { chatId:o.chat, role:'char', authorId:o.her, status:'done' }, db.characters.get(o.her));
}, ids);
await page.waitForTimeout(2200);
const img = sent.find(x => x.u.includes('/images/generations'));
ok('生图那一路：发出去的提示词里有外貌，不只是名字',
  /及肩黑发/.test(img?.b || '') && /橘白相间/.test(img?.b || ''), (img?.b || '').slice(0,200));

// ---- 真发一段视频 ----
await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  db.settings.set({ videoOn: true });
  const r=(await import('/src/system/ai/reply.js'));
  r.materialize({ type:'clip', prompt:'乃木绿实抱着乃木喵走过走廊' },
    { chatId:o.chat, role:'char', authorId:o.her, status:'done' }, db.characters.get(o.her));
}, ids);
await page.waitForTimeout(2500);
const vid = sent.find(x => x.u.includes('/v2/video_generation'));
ok('视频那一路也拼了，不再是原样一句话',
  /及肩黑发/.test(vid?.b || '') && /橘白相间/.test(vid?.b || ''), (vid?.b || '').slice(0,240));
ok('视频那一路也带上了全局与世界书那几段（走的是同一套拼装）',
  (vid?.b || '').includes('乃木绿实抱着乃木喵走过走廊'), (vid?.b || '').slice(0,120));

// ---- 一个字的名字不参与匹配 ----
const short = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const ip=(await import('/src/system/ai/imageprompt.js'));
  db.characters.create({ name:'猫', appearance:'不该被带进来的一段话' });
  return ip.compose({ prompt:'一只猫走过屋顶' });
});
ok('一个字的名字不参与匹配（不然任何一句话都撞得上）',
  !/不该被带进来/.test(short), short);

// ---- 没填外貌的退回锁脸读出来的那段 ----
const fb = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const ip=(await import('/src/system/ai/imageprompt.js'));
  const c = db.characters.create({ name:'阿岚', faceDesc:'短发，圆脸，戴细框眼镜。' });
  return ip.compose({ prompt:'阿岚在看书', char: c });
});
ok('没手写外貌时，退回锁脸读出来的那一段', /细框眼镜/.test(fb), fb);

// ---- 导入角色卡时把外貌也抽出来 ----
const imported = await page.evaluate(async () => {
  const svc=(await import('/src/system/ai/services.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k',
    model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
  const card=(await import('/src/system/ai/tasks/card.js'));
  const t=(await import('/src/system/ai/templates.js'));
  const got = await card.parseCard(new File(['乃木绿实，美院三年级，及肩黑发。'],
    'a.txt', { type:'text/plain' }));
  return { appearance: got.appearance, tpl: t.template('task.card-import') };
});
ok('导入角色卡时把外貌单独抽出来', imported.appearance === '及肩黑发，眼角有痣。',
  JSON.stringify(imported.appearance));
ok('那份任务规格里写明了外貌发给的是收不到对话的模型',
  /never sees the conversation/.test(imported.tpl) && /"appearance":""/.test(imported.tpl),
  imported.tpl.slice(-200));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
