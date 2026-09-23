// 角色自己往相册存照片：默认关、到点才存、存完是谁的、删角色要清干净
import { BASE, OUT, EXE, chromium, PNG_PATH } from './_env.mjs';
const PNG=(await import('node:fs')).readFileSync(PNG_PATH,'utf-8').trim();
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
let chatCalls=0, imgCalls=0;
await page.route('**/*', async r => {
  const u=r.request().url();
  if (/chat\/completions/.test(u)) { chatCalls++;
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      choices:[{message:{content:'{"imagePrompt":"a cat on the windowsill, evening light","note":"窗台上的猫"}'}}]})}); }
  if (/images\/generations/.test(u)) { imgCalls++;
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:PNG}]})}); }
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  svc.newChatPreset({ name:'主', provider:'openai', baseUrl:`${BASE}/v1`,
    apiKey:'sk-t', model:'gpt-4o' });
  const p=svc.newImagePreset({ kind:'relay', name:'图' });
  svc.updateImagePreset(p.id, { baseUrl:`${BASE}/v1`, apiKey:'sk-t', model:'gpt-image-1' });
  svc.setActiveImage(p.id);
  db.settings.set({ imagePrompt:'soft film grain' });
  const c=db.characters.create({ name:'阿岚', persona:'摄影系学生' });
  return { charId:c.id };
});

// ---- 一、默认是关的 ----
let st = await page.evaluate(async ({charId}) => {
  const db=await import('/src/system/db/index.js');
  const snap=await import('/src/system/ai/tasks/snap.js');
  const cost=await import('/src/system/ai/cost.js');
  const c=db.characters.get(charId);
  return { cfg: snap.configOf(c), due: snap.due(c),
    inCost: cost.EXTRA_CALLS.some(x=>x.id==='snap'),
    active: cost.active().some(x=>x.id==='snap') };
}, ids);
ok('新角色默认不开', st.cfg.snap===false && st.due===false, JSON.stringify(st.cfg));
ok('登记在 EXTRA_CALLS 里', st.inCost);
ok('关着的时候不算在「现在开着的」里', st.active===false);

// ---- 二、打开之后到点就该存 ----
st = await page.evaluate(async ({charId}) => {
  const db=await import('/src/system/db/index.js');
  const snap=await import('/src/system/ai/tasks/snap.js');
  const cost=await import('/src/system/ai/cost.js');
  db.characters.update(charId, { snap:true, snapDays:2 });
  const c=db.characters.get(charId);
  const a = snap.due(c);                       // 没存过 -> 该存
  snap.setLastAt(charId, Date.now());          // 刚存过
  const b = snap.due(db.characters.get(charId));
  snap.setLastAt(charId, Date.now() - 3*86400000);  // 三天前
  const c2 = snap.due(db.characters.get(charId));
  return { 没存过:a, 刚存过:b, 三天前:c2, active: cost.active().some(x=>x.id==='snap') };
}, ids);
ok('没存过 -> 该存', st.没存过===true);
ok('刚存过 -> 不该存（不会变成每小时一张）', st.刚存过===false);
ok('隔了三天 -> 又该存', st.三天前===true);
ok('开着的时候用量页数得到它', st.active===true);

// ---- 三、真存一张 ----
chatCalls=0; imgCalls=0;
const got = await page.evaluate(async ({charId}) => {
  const snap=await import('/src/system/ai/tasks/snap.js');
  const album=await import('/src/system/album.js');
  const before = album.allPhotos().length;
  const photo = await snap.takeSnap(charId);
  return { before, after: album.allPhotos().length,
    photo: photo && { kind:photo.kind, note:photo.note, from:photo.from, hasImg:!!photo.imageId } };
}, ids);
ok('相册里多了一张', got.after===got.before+1, JSON.stringify(got));
ok('存的是一张图，不是卡片', got.photo?.kind==='image', JSON.stringify(got.photo));
ok('真带着图片', got.photo?.hasImg===true);
ok('备注是角色写的那句', got.photo?.note==='窗台上的猫', got.photo?.note);
ok('「来自」写清楚是谁',
  got.photo?.from?.name==='阿岚' && got.photo?.from?.charId===ids.charId,
  JSON.stringify(got.photo?.from));
ok('一次两个调用：想拍什么一次、画一次', chatCalls===1 && imgCalls===1, `文字${chatCalls} 生图${imgCalls}`);

// ---- 四、全局生图提示词有没有拼进去 ----
let sentPrompt='';
await page.route('**/images/generations', async r => {
  sentPrompt = JSON.parse(r.request().postData()||'{}').prompt || '';
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:PNG}]})});
});
await page.evaluate(async ({charId}) => {
  const snap=await import('/src/system/ai/tasks/snap.js');
  await snap.takeSnap(charId);
}, ids);
ok('画面描述在最前面', /^a cat on the windowsill/.test(sentPrompt), sentPrompt.slice(0,80));
ok('全局生图提示词也拼上了', /soft film grain/.test(sentPrompt), sentPrompt.slice(0,120));

// ---- 五、模型说「这会儿没什么可拍」就不存 ----
await page.route('**/chat/completions', r => r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({choices:[{message:{content:'{"imagePrompt":null}'}}]})}));
const none = await page.evaluate(async ({charId}) => {
  const snap=await import('/src/system/ai/tasks/snap.js');
  const album=await import('/src/system/album.js');
  const before=album.allPhotos().length;
  const p=await snap.takeSnap(charId);
  return { p, same: album.allPhotos().length===before };
}, ids);
ok('模型说没什么可拍：不存，也不报错', none.p===null && none.same, JSON.stringify(none));

// ---- 六、调度：不跟着「主动消息」的开关走 ----
const sched = await page.evaluate(async ({charId}) => {
  const db=await import('/src/system/db/index.js');
  const pro=await import('/src/system/ai/proactive.js');
  const snap=await import('/src/system/ai/tasks/snap.js');
  // 主动消息明确关着，只开存照片
  db.characters.update(charId, { proactive:false, snap:true, snapDays:0 });
  snap.setLastAt(charId, 0);
  return { proOff: pro.configOf(db.characters.get(charId)).proactive===false,
    due: snap.due(db.characters.get(charId)) };
}, ids);
ok('主动消息关着时，存照片仍然算「到点」', sched.proOff && sched.due, JSON.stringify(sched));

// ---- 七、删角色要把落点一并清掉 ----
const cleaned = await page.evaluate(async ({charId}) => {
  const snap=await import('/src/system/ai/tasks/snap.js');
  const purge=await import('/src/system/purge.js');
  snap.setLastAt(charId, Date.now());
  const before = snap.lastAt(charId);
  purge.dropCharacter(charId);
  return { before, after: snap.lastAt(charId) };
}, ids);
ok('删角色之后那条记号没了', cleaned.before>0 && cleaned.after===0, JSON.stringify(cleaned));

// ---- 八、界面 ----
const c2 = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const c=db.characters.create({ name:'小雨' });
  const chat=db.chats.create({ characterIds:[c.id], title:'小雨' });
  return { charId:c.id, chatId:chat.id };
});
await page.evaluate(async ({charId}) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/proactive/${charId}`);
}, c2);
await page.waitForSelector('.page'); await page.waitForTimeout(700);
let body = await page.locator('.page').innerText();
ok('角色页上有这个开关', /角色自己往相册里存照片/.test(body), body.slice(0,300));
ok('关着的时候说清楚开了会花什么', /一次文字接口与一次生图接口/.test(body), body.slice(0,600));
ok('关着的时候不显示间隔那一栏', !/至少间隔/.test(body));
await page.locator('.list-item').filter({hasText:'角色自己往相册里存照片'}).locator('.switch').click();
await page.waitForTimeout(500);
body = await page.locator('.page').innerText();
ok('打开之后出现间隔设置', /至少间隔/.test(body), body.slice(0,400));
ok('并且说明不经过会话、要自己去翻', /不经过会话/.test(body) && /翻阅相册/.test(body), body.slice(0,600));
await page.screenshot({path:`${OUT}/snap.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
